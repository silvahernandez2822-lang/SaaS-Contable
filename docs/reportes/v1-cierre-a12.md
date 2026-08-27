# V-1 cerrada — `app.resolver_empresa_por_buzon` deja de ser ejecutable por la aplicación

Agente A12. Tarea acotada de seguridad (D-042 la asignaba a **A12 + A4**). No es una ola.

## 1. El hallazgo, y por qué el argumento original era falso

La migración `032_ingest_resolver_buzon.sql` (A4, Ola 1) concedió
`EXECUTE ON FUNCTION app.resolver_empresa_por_buzon(text) TO app_user`, justificándolo así:

> «No cruza firmas: no acepta ningún parámetro que identifique un tenant u otra empresa,
> así que no hay firma que falsificar.»

Es falso, y A14 lo midió: **el parámetro que identifica al tenant es el buzón**. Desde una
sesión ya abierta de la firma B, pasando el `buzon_email` de una empresa de la firma A, la
función devolvía el `tenant_id` y el `company_id` de A.

Daño real medido: **cero**. Con esos identificadores en la mano, desde la sesión de B no se
lee una sola fila de `company`, `source_document`, `journal_entry` ni `third_party`, y todo
intento de escritura muere con `42501`. La RLS —la segunda capa— aguantó. Por eso la
severidad fue baja y no bloqueó ninguna ola. Pero era un **oráculo de identificadores
ajenos** que no le hacía falta a nadie.

La lección es reutilizable y por eso queda escrita también en `tests/adversarial/evasion.test.ts`:
*"no recibe el tenant como parámetro" NO equivale a "no cruza firmas"*. Hay que preguntarse
qué otra cosa del parámetro identifica al tenant.

## 2. Verificado antes de tocar nada: la función estaba muerta en producción

Cuando A14 levantó V-1 no se podía cerrar, porque el camino de ingest de A4 llamaba a la
función y quitarle el `GRANT` habría roto la ingesta. Eso ya no es cierto, y se comprobó
sobre el código, no sobre el informe de nadie:

- `resolverEmpresaPorBuzon` aparece en `src/` y `app/` **solo** en su propia definición
  (`src/ingest/persistencia.ts`) y en un re-export (`src/ingest/index.ts`). **Ningún llamador.**
- El canal de correo vivo es `src/integraciones/ingest-correo.ts` (A13, migración 090) y
  **no la usa**. Su cabecera lo dice y el código lo confirma: el token de integración
  autentica el tenant, se abre sesión real por `app.abrir_sesion`, y resolver qué empresa de
  esa firma es dueña del buzón pasa a ser un `SELECT` corriente sobre `company`, bajo su RLS
  de tenant.
- `tests/integraciones/webhook-correo.test.ts` ya afirmaba esa sustitución en el nombre de
  uno de sus casos: «resuelve la empresa por el buzón (sin `app.resolver_empresa_por_buzon`)».

Es decir, la pregunta que A14 dejó abierta —«¿se retira ese camino o se le da su propia
autenticación?»— se responde sola: **se retira, porque A13 ya lo sustituyó**, y de paso la
seguridad del canal dejó de depender de que un buzón sea secreto.

## 3. La decisión: de las tres opciones, la (b)

D-042 dejaba tres salidas. Se eligió la de menor superficie **que no rompe nada**:

- **(a) Borrar la función — descartada.** Es la superficie mínima absoluta, pero rompe: el
  helper de A4 pasaría a fallar con `42883` en vez de con un `42501` explicable, y las
  pruebas de compuerta de A4 dejarían de poder verificar el patrón `SECURITY DEFINER` que
  D-023 estableció. Rompe cosas para ganar poco.
- **(c) Concederla al rol de sistema `sistema_ingesta` — NO ES IMPLEMENTABLE.** Conviene
  dejarlo escrito para que nadie lo reintente: **`sistema_ingesta` es un rol de NEGOCIO**
  (una fila en `role`, resuelta por `app.tiene_permiso`), **no un rol de PostgreSQL**. En el
  motor solo existen `app_user` y `app_auth`. Concederla a `app_auth` sería *peor* que el
  estado de partida: le daría el oráculo al único rol capaz de emitir sesiones, y el canal de
  correo no la llama de todas formas.
- **(b) ELEGIDA: la función se queda, sin `EXECUTE` para ningún rol de aplicación.** Tras la
  migración su ACL solo conserva al dueño del esquema, o sea el rol de migraciones, seeds y
  tareas de plataforma (`withAdminContext`, sin `SET ROLE`), que nunca sirve una petición de
  usuario (D-004). La aplicación no puede ni llamarla, y el patrón queda documentado y
  auditable por si algún día vuelve a hacer falta un resolver previo a la sesión.

## 4. Qué se cambió

**`db/migrations/100_a12_v1_revocar_grant_resolver_buzon.sql`** (rango 100–109, nuevo). No se
editó la 032: ya está aplicada y el runner aborta si cambia su checksum; el estado final se
alcanza sumando. Hace el `REVOKE` a `app_user`, y también a `PUBLIC` y `app_auth` de forma
explícita —porque `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO
app_user` (001) concede EXECUTE automáticamente a toda función nueva del esquema `app`, así
que el objetivo es *ACL vacía de roles de aplicación*, no *"sin el GRANT que escribió A4"*.
Reescribe el `COMMENT` de la función para que diga la verdad.

La migración **se verifica a sí misma** con un bloque `DO` sobre `aclexplode(proacl)`: si
algún grantee distinto del dueño conserva `EXECUTE`, la migración falla y no se aplica.
Trata además la **ACL nula como fallo**, que es el falso PASS peligroso de este caso: en
PostgreSQL una ACL nula no significa "sin permisos", significa *privilegios por defecto*, y
el defecto de una función es `EXECUTE` para `PUBLIC`.

**`tests/helpers/db.ts` — el espejo obligatorio (D-034).** Aquí estuvo la única sorpresa del
trabajo. La migración por sí sola **no cerraba nada en las pruebas**: `asegurarRolesAplicacion`
corre *después* de las migraciones y hace `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO
app_user`, que devolvía el privilegio recién revocado. Sin el espejo, el banco de pruebas
habría seguido demostrando una fuga que producción ya no tiene — exactamente lo que D-034
advierte. Añadido el `REVOKE` correspondiente.

## 5. Las pruebas: convertidas, no borradas

**`tests/adversarial/compuerta-ola1.test.ts` (A14) — el mismo caso con el veredicto invertido.**
Antes se llamaba «MEDIDO: desde la sesión de la firma B, la función devuelve el company_id y
el tenant_id de la firma A» y fijaba la fuga en positivo (`expect(visto).toEqual({...de A})`).
Ahora se llama «V-1 CERRADA: desde la sesión de la firma B, la función ya no se puede ni
llamar (42501)» y el mismo intento se envuelve en `esperarErrorPg(..., '42501', ...)`. Se
conserva, a continuación, la aserción de segunda capa (cero filas de A legibles desde B), que
es lo que mantuvo la severidad baja mientras la primera capa estuvo abierta. El comentario
del caso guarda la historia completa, para que se entienda por qué cambió de signo.

**Los dos inventarios de funciones `SECURITY DEFINER` ejecutables por `app_user`**
(`compuerta-ola1.test.ts` y `evasion.test.ts`, duplicados a propósito): `app.resolver_empresa_por_buzon`
**sale** de ambas listas. Se deja anotado que es una **baja**, y que si vuelve a aparecer es
que alguien reabrió V-1. En `evasion.test.ts` se reescribió además el párrafo de A4 que
contenía la afirmación falsa.

**`tests/gates/ingest.test.ts` (A4) — sí había que tocarla.** El encargo suponía que
«probablemente siga válida»; no era el caso. Su primer caso hacía `SET LOCAL ROLE app_user` y
exigía que la llamada funcionara, así que el `REVOKE` lo rompía. Se partió en dos:
la aplicación (`app_user`) ahora falla con `42501` —conservando el control original de que sin
sesión un `SELECT` directo a `company` ve cero filas, hecho que sigue siendo cierto: lo que
cambió no es ese hecho, sino quién tiene derecho a esquivarlo— y un caso nuevo verifica que la
función **sigue existiendo y resolviendo para el dueño**, con lo que no se pierde cobertura de
comportamiento. Los otros dos casos, que ya usaban `asAdmin`, quedaron intactos.

## 6. Otros ajustes menores, sin cambio de comportamiento

- `src/ingest/persistencia.ts`: **solo el comentario** del helper. Advierte que desde la
  migración 100 solo funciona bajo `withAdminContext`, para que nadie recablee código muerto
  a un camino de petición y se lleve un `42501` sin explicación.
- `docs/ingest-correo.md`, sección 8: decía que la función es el mecanismo del canal de
  correo. Quedó desactualizada con A13 y falsa con la migración 100.

No se tocó nada más de A4 ni de A13.

## 7. Compuertas

| Compuerta | Resultado |
|---|---|
| `npm test` | **612 pasan**, 33 archivos, 0 fallos (eran 611; el caso nuevo de `ingest.test.ts` suma uno) |
| `npm run typecheck` | limpio, sin salida |
| `npx next build` | **compila**, 11 rutas generadas, 0 errores |

## 8. Para A0, al consolidar `ESTADO_PROYECTO.md`

No se editó `ESTADO_PROYECTO.md` ni se hizo commit, según el encargo. Lo que hay que reflejar:

- **V-1: CERRADA.** `app.resolver_empresa_por_buzon` sin `EXECUTE` para ningún rol de
  aplicación (migración 100 + espejo en `tests/helpers/db.ts`), verificado por prueba que
  exige `42501` desde una sesión de otra firma, y por el bloque de verificación de la propia
  migración.
- **D-042 queda resuelto por la opción (b)**, no por la (c). Conviene anotar el motivo, porque
  la (c) figura en las notas como si fuera posible: `sistema_ingesta` es un rol de negocio, no
  un rol de PostgreSQL, y no existe ningún rol de motor al que concedérsela sin empeorar la
  postura.
- **Rango de migraciones 100–109 abierto**, 100 consumida.
- **Aviso de proceso, más allá de V-1:** un `REVOKE` en una migración **no se refleja en las
  pruebas** hasta que se espeja en `asegurarRolesAplicacion` (`tests/helpers/db.ts`), por el
  `GRANT ... ON ALL FUNCTIONS IN SCHEMA app` que corre después de migrar. Es D-034 y ya
  mordió aquí. Vale la pena que la próxima revisión de A14 lo verifique como invariante
  —comparar la ACL real tras migrar contra la ACL tras el harness— en lugar de confiar en que
  cada agente se acuerde de espejar.

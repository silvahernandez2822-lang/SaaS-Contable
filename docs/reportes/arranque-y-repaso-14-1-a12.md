# A12 — Arranque del sistema y repaso de seguridad de la sección 14.1

Dos encargos, separados. El A es producto (que el sistema se pueda usar por primera vez); el B es el
repaso de seguridad que el rol de A12 exige **antes de cualquier lanzamiento a producción**, hecho
contra el sistema real de hoy y no contra el de la Ola 0.

Compuertas verificadas al cerrar (resultado literal al final del documento):
`npm test` **902 pruebas en verde**, `npm run typecheck` limpio, `npx next build` sin errores.

---

# ENCARGO A — Flujo de arranque

## A.1 El problema

Hasta hoy no existía forma de crear la primera firma, su primera empresa-cliente ni su usuario
administrador sin escribir SQL a mano, y **tampoco existía pantalla de inicio de sesión**: las cuatro
pantallas del producto (`/bandeja`, `/parametros`, `/terceros`, `/reportes`) leían una cookie
`session_token` que nadie escribía nunca. El producto era literalmente inarrancable.

## A.2 Mecanismo elegido, y por qué es el de menor superficie

**Un comando de línea de órdenes ejecutado por el operador, que corre con la misma credencial
privilegiada que ya exigen `npm run migrate` y `npm run seed`** (superusuario / dueño del esquema /
BYPASSRLS, D-015), dentro de `withAdminContext`.

El argumento de seguridad, en una frase: **no crea ninguna vía de confianza nueva**. Quien puede
ejecutarlo ya podía hacer exactamente lo mismo con tres `INSERT` sobre la base. Lo único que aporta es
que esos tres `INSERT` queden bien hechos —derivación scrypt correcta, `password_algoritmo` correcto,
rol `admin_firma` correcto, `user_company_access` correcto— en vez de a mano. **Superficie de red
añadida: cero.**

Y lo más importante para D-020/D-021: **el arranque no emite sesión ni cookie**. Deja un usuario con
contraseña, y ese usuario entra por `/entrar` pasando por `iniciarSesion` → `app.abrir_sesion` con el
rol `app_auth`, igual que cualquier otro. `withSessionContext` no se entera de que este código existe.
Hay una prueba que lo comprueba de punta a punta: tras el arranque se inicia sesión de verdad y se
verifica que `app.current_tenant_id()` devuelve el tenant **derivado del token**, no uno afirmado por
el arranque.

### Alternativas descartadas, con su motivo

| Alternativa | Por qué se descarta |
|---|---|
| **Endpoint público que cree tenants** | Un escritor anónimo sobre la raíz del aislamiento. Es exactamente la clase de agujero que D-021 cerró. Además el mega-prompt no pide registro autoservicio en ninguna parte |
| **Ruta protegida por un secreto de despliegue** (`ARRANQUE_SECRET`) | Deja una puerta HTTP viva **para siempre** cuya única defensa es una cadena en una variable de entorno: se filtra por logs, por un proxy, por un volcado de configuración. Y obligaría al proceso web a ejecutar `withAdminContext`, prohibido de forma explícita por D-004 y documentado en `app/lib/db.ts`. Sería romper un invariante que ha aguantado todo el proyecto para ganar comodidad **una sola vez** |
| **Arranque que solo funcione con la base vacía** | La comprobación de "vacío" es una condición de carrera, y es un control que se auto-desactiva en cuanto se usa. Sobrevive como guarda **adicional** (`--solo-si-vacio`), nunca como el mecanismo |

### Qué pasa si se invoca dos veces, o cuando ya hay datos

Es **idempotente por clave de negocio, no por "base vacía"**: busca la firma por NIT, la empresa por
(firma, NIT) y el usuario por correo. Lo que ya existe se reporta y **no se modifica**.

Tres decisiones concretas, todas con prueba:

1. **Jamás reescribe la contraseña de un usuario que ya existe.** Si lo hiciera, reejecutar el arranque
   sería una primitiva de toma de control de la cuenta administradora de una firma viva: bastaría con
   volver a correrlo con `--password=loquesea`. La prueba
   *«invocarlo dos veces no duplica nada y NO reescribe la contraseña del administrador»* corre el
   arranque una segunda vez con una contraseña intrusa y comprueba que **la original sigue siendo la
   única válida**.
2. **Rotar la contraseña es un acto explícito y ruidoso.** `--rotar-password` sí la cambia, pone a cero
   los intentos fallidos y **revoca todas las sesiones vivas** del usuario (probado: el token emitido
   antes de rotar queda muerto). Queda además en `audit_log` como el `UPDATE` sobre `"user"` que es, con
   la credencial redactada (D-029).
3. **Se niega a adoptar un correo que ya pertenece a otra firma.** `user.email` es único globalmente
   (002); adoptarlo sería mover un usuario entre tenants. Aborta sin tocar nada.

Además valida NIT, correo, nombre y longitud de contraseña **antes de escribir una sola fila**: no se
crea media firma para luego morir por una contraseña corta. Todo corre en **una sola transacción**.

## A.3 El comando exacto

```bash
npm run arranque -- \
  --firma-nit=901234567 \
  --firma="Mi Firma Contable SAS" \
  --empresa-nit=800111222 \
  --empresa="Comercializadora del Norte SAS" \
  --admin-email=david@mifirma.com \
  --admin-nombre="David Silva"
```

En PowerShell, en una sola línea:

```powershell
npm run arranque -- --firma-nit=901234567 --firma="Mi Firma Contable SAS" --empresa-nit=800111222 --empresa="Comercializadora del Norte SAS" --admin-email=david@mifirma.com --admin-nombre="David Silva"
```

Sin `--password`, genera una contraseña de 192 bits y **la imprime una sola vez**. La guía completa,
escrita para alguien que no programa, está en **`docs/arranque-primer-uso.md`**.

Si la base todavía no tiene esquema, añada `--migrar` y aplica migraciones y seeds antes de arrancar.
Sin `DATABASE_URL` corre contra PGlite en memoria y lo avisa por pantalla: sirve para practicar, no
para trabajar.

## A.4 Lo que se construyó para poder entrar

| Ruta | Qué hace |
|---|---|
| `/entrar` | Formulario de inicio de sesión. No inventa autenticación: llama a `iniciarSesion`. Devuelve **siempre el mismo mensaje** pase lo que pase; el motivo real queda en `audit_log`. El campo de segundo factor está **siempre visible**: si apareciera en un segundo paso, el formulario sería un oráculo de quién tiene MFA |
| `/` (portada) | Selector de empresa + enlaces a las cuatro pantallas + cerrar sesión. Sin sesión redirige a `/entrar` |

Dos notas de seguridad sobre la portada:

- La cookie de sesión se escribe con `HttpOnly; SameSite=Lax`, `Secure` fuera de desarrollo, y **con la
  fecha de vencimiento que devolvió la base de datos**, no con una constante de la capa web: la
  autoridad sobre el vencimiento es `app.session_context.expira_en` (015), con su tope duro de 24 h.
- El `company_id` del selector **no es una afirmación de acceso, es una petición** (D-022). La acción
  puede escribir la cookie sin comprobar nada porque escribirla no autoriza: si la sesión no tiene
  acceso vigente, `app.current_company_id()` devuelve NULL, la RLS no deja ver nada y el intento queda
  como `ACCESO_DENEGADO`. Solo se valida la **forma** (UUID), para que una cookie basura falle con un
  mensaje claro.
- Al entrar se **borra** la cookie `company_id`: nunca se arrastra la empresa elegida por el usuario
  anterior.

## A.5 Alcance que NO se tomó

Nada de registro autoservicio, nada de facturación de suscripciones, nada de invitaciones por correo,
nada de recuperación de contraseña por correo. El mega-prompt no lo pide y cada uno de ellos es
superficie nueva.

---

# ENCARGO B — Repaso de la sección 14.1 contra el sistema de HOY

Cuatro estados, sin ambigüedad: **implementado** (está en código y hay una prueba que lo demuestra),
**configuración de despliegue** (no es código; hay que hacerlo al desplegar y dejar constancia),
**documentado** (existe el documento, falta revisión jurídica y datos de la sociedad),
**pendiente** (no está).

Lo que cambió de superficie desde la Ola 0: la clasificación por LLM (A5), la bandeja (A7), la
parametrización y el maestro de terceros (A8), las integraciones y tokens (A13), la reportería (A9/A10/A11)
y **una ruta HTTP que sirve archivos Excel**. El recorrido se hizo contra eso, no contra el de la Ola 0.

## B.1 Recorrido punto por punto

| # | Punto de la 14.1 | Estado real | Verificación de hoy / qué falta |
|---|---|---|---|
| 1 | **RLS activa en todas las tablas de datos, doble nivel tenant/company** | **implementado** | **Reverificado por catálogo sobre las 45 tablas de hoy** (eran ~31 en la Ola 0). `pg_class`: RLS habilitada **y forzada** en todas salvo `schema_migration`. `pg_policies`: ninguna tabla con RLS se quedó sin política; **toda** tabla con `tenant_id` tiene una política que llama a `app.current_tenant_id()` y **toda** tabla con `company_id` una que llama a `app.current_company_id()` — barrido por catálogo, cero excepciones. Las tablas nuevas de A5, A7, A8, A11 y A13 (`clasificacion_pendiente`, `prompt_clasificacion`, `parametro_clasificacion`, `document_correction`, `document_processing_job`, `company_setting`, `exogena_account_mapping`, `email_ingest_log`, `email_ingest_attachment`, `integration_call_log`…) **entran todas**. `tests/gates/arranque.test.ts` §B, además del barrido de comportamiento que ya existía en `tests/gates/seguridad.test.ts` |
| 1b | **El contexto de aislamiento no lo elige la sesión** (cierre de D-020) | **implementado, y sigue en pie tras cuatro olas** | `015`. Lo confirma el arranque: el usuario recién creado obtiene su tenant del **token**, no del comando que lo creó. Ninguna de las superficies nuevas (bandeja multi-empresa, ruta de reportes, tokens de A13) abrió un camino alterno: `app.empresas_accesibles()` y `app.autenticar_token_integracion` filtran por la sesión ya verificada, nunca por un tenant de parámetro |
| 2 | **Cifrado en tránsito (TLS)** | **configuración de despliegue** | Sin cambio. Exigencias en `docs/cifrado-y-proteccion-de-datos.md` §1: TLS 1.2+, HSTS, cookies `Secure/HttpOnly/SameSite` y `sslmode=verify-full` en `DATABASE_URL`. **Nuevo desde hoy:** la cookie de sesión que escribe `/entrar` ya lleva `HttpOnly; SameSite=Lax` y `Secure` cuando `NODE_ENV=production` — la mitad de aplicación de este punto **ya está en código**. La otra mitad la ejecuta **A15** y archiva la constancia |
| 3 | **Cifrado en reposo** | **configuración de despliegue** (volumen y respaldos) + **implementado** (sobre de aplicación) | Sin cambio de superficie. Secreto TOTP en AES-256-GCM con clave fuera de la base (D-028); contraseñas con scrypt; del token de sesión y del token de integración solo se guarda su `sha256`. **Verificado hoy que A13 no introdujo un secreto en claro:** `app.integration_credential` guarda `token_hash`, nunca el token |
| 4 | **Autenticación con MFA disponible** | **implementado en el motor; la interfaz de activación es lo único PENDIENTE** | TOTP RFC 6238 verificado contra los vectores de RFC 4226 y RFC 6238; secreto cifrado; sesiones con vencimiento y tope duro de 24 h; revocación individual y masiva; bloqueo tras 5 intentos; respuesta de tiempo constante ante correo inexistente. **Nuevo hoy:** `/entrar` ya acepta el código TOTP, así que un usuario con MFA **puede entrar por la interfaz** (antes no había interfaz). **Sigue pendiente y se declara como tal:** no hay pantalla de *inscripción* de MFA — hoy el secreto lo tiene que sembrar un operador. Es decir, MFA está *disponible* en el sentido de la 14.1 pero un usuario **no puede activárselo solo**. **MFA obligatorio por rol: pendiente** |
| 5 | **Roles y permisos granulares (5 roles mínimos)** | **implementado, y CORREGIDO hoy** | Los cinco roles siguen siendo restricción del motor (`016`, D-025): trigger `BEFORE` que rechaza con `SE002`, hoy sobre **37 tablas**. A13 añadió un sexto rol *técnico* (`sistema_ingesta`) con alcance mínimo, que no toca los cinco mínimos. **Cambio de hoy:** el reparto de `tercero.editar` se adjudicó y se corrigió — ver §B.3. El catálogo pasa de 25 a **26 permisos** |
| 6 | **`audit_log` de toda acción sensible** | **implementado, con DOS HUECOS ENCONTRADOS Y CERRADOS HOY** | Ver §B.2 |
| 7 | **Política de tratamiento y aviso de privacidad** | **documentado** | Sin cambio. `docs/politica-tratamiento-datos-personales.md`, `docs/aviso-privacidad.md`. **Falta:** revisión jurídica, datos de la sociedad y publicación. **Nuevo riesgo a declarar por A5:** la clasificación por LLM envía descripciones de factura a un proveedor externo; la política debe nombrar ese encargado y su país (§9) |
| 8 | **Contrato de transmisión con el cliente** | **documentado** | Sin cambio. `docs/contrato-encargado-tratamiento.md`. **Falta:** revisión jurídica y firma |
| 9 | **Cláusulas de transferencia internacional** | **documentado** | Sin cambio. `docs/clausulas-transferencia-internacional.md`. **Falta:** verificar la numeración vigente de la circular de la SIC y firmar el clausulado **con cada proveedor** — y ese "cada proveedor" hoy incluye al **proveedor del LLM de A5**, que no existía cuando se redactó |
| 10 | **Términos con limitación de responsabilidad por cálculo tributario** | **documentado** | Sin cambio. `docs/terminos-y-condiciones.md` §7. El control técnico que lo sostiene (aprobación humana obligatoria) **se reforzó**: la bandeja de A7 aprueba en lote pero cada aprobación sigue siendo una fila en `approval` con su auditoría |
| 11 | **Procedimiento de consultas y reclamos de titulares** | **documentado** | Sin cambio. **Falta:** designar el área responsable y abrir el buzón |
| 12 | **Procedimiento de incidentes a la SIC (15 días hábiles)** | **documentado, con dos puntos abiertos** | Sin cambio. Sigue abierto: (a) confirmar el canal correcto de reporte estando fuera del RNBD; (b) citar la instrucción vigente que fija los 15 días. **El procedimiento nunca se ha ejercitado con un simulacro** |
| 13 | **Retención de datos por 10 años con reproducción exacta** | **documentado + parcialmente implementado; la prueba sigue faltando** | `docs/politica-retencion-datos.md`. Lo sustentan: ledger inmutable, parámetros versionados, `audit_log` inalterable, XML original con hash, y desde A4 el **archivado en frío** (`031`). **Pendiente real, sin cambio:** no hay rutina automática de supresión al vencimiento, no hay archivo histórico de bajo costo, y **no se ha hecho un ejercicio de restauración que verifique la reproducción exacta** |
| 14 | **Respaldos automáticos con prueba de restauración** | **configuración de despliegue + PENDIENTE la prueba** | Sin cambio. **La prueba de restauración NO se ha ejecutado.** Corresponde a **A15**. Mientras no se haga, la reproducción exacta del punto 13 está *afirmada*, no *verificada* |

**Lo de la 14.2 que efectivamente NO se hizo, y sigue sin hacerse a propósito:** RNBD (no aplica hasta
100.000 UVT en activos, ~$5.237.400.000 para 2026, Decreto 090 de 2018 art. 1), certificaciones
ISO 27001 / SOC 2, y habilitación DIAN. Declarados como no hechos en `docs/README.md`.

## B.2 Auditoría: dos huecos reales, encontrados hoy y cerrados

Se revisó por catálogo qué tablas tienen trigger de auditoría y se contrastó con las acciones nuevas.

**Lo que ya estaba cubierto y se confirmó:**

- **Aprobar en lote** (A7): cada aprobación es una fila en `approval`, que tiene trigger de auditoría.
  Un lote de 40 documentos deja 40 rastros, no uno.
- **Emitir y revocar un token de integración** (A13): `app.crear_token_integracion` y su par de revocación
  escriben `TOKEN_INTEGRACION_EMITIDO` / `TOKEN_INTEGRACION_REVOCADO` directamente en `audit_log`, y la
  emisión exige `usuario.administrar`. Cubierto.
- **Editar los atributos fiscales y la actividad de un tercero** (A8): `third_party_fiscal_attribute` y
  `third_party_activity` ya tenían trigger.
- Publicación y reversa de asientos, cierre de período, cambios de usuarios y accesos, parámetros, PUC,
  mapeo NIIF, conceptos, accesos denegados a otra empresa e inicios de sesión fallidos: cubiertos desde
  la Ola 0.

**Hueco 1 — el maestro de terceros no se auditaba.** `third_party_fiscal_attribute` y
`third_party_activity` sí; **`third_party` no**. Y `third_party.municipality_id` **decide el municipio de
ReteICA**: cambiarlo cambia el impuesto y no dejaba rastro de ninguna clase. Cerrado con
`SELECT app.instalar_trigger_auditoria('third_party')` en la migración 140, con prueba.

**Hueco 2 — la descarga de reportes no se auditaba.** `audit_log.accion` contempla `'EXPORT'` desde la
migración 009 y **nadie lo escribía nunca**. La ruta de A9 (`/api/reportes/[libro]`) sirve el libro
mayor completo, el libro auxiliar, los certificados de retención y la exógena de una empresa en `.xlsx`
sin dejar huella. Extraer en bloque la contabilidad de una empresa es una acción sensible en el sentido
literal de la 14.1. Cerrado con `app.registrar_exportacion(reporte, detalle)`, que:

- se invoca **dentro de la misma transacción y de la misma sesión verificada** que autorizó la lectura:
  si el rastro no se puede escribir, el archivo no se entrega;
- **exige `reporte.exportar` dentro de la propia función**, no solo en la ruta, para que no exista
  ningún camino futuro que "exporte sin auditar";
- registra reporte, empresa, usuario, IP, agente, petición y los parámetros del reporte (rango de
  fechas, tercero, cuenta).

## B.3 Adjudicación sobre `tercero.editar`

**A8 dejó anotado, sin reabrirlo, que `tercero.editar` lo tienen también `contador` y
`auxiliar_causacion`. La adjudicación es: estaba MAL, y se corrigió.**

### El hallazgo concreto

`tercero.editar` autorizaba con **un mismo código** dos cosas de riesgo muy distinto:

1. el maestro del tercero (`third_party`: NIT, razón social, dirección, municipio);
2. sus vigencias fiscales (`third_party_fiscal_attribute`) y su actividad económica
   (`third_party_activity`), que **entran en el cálculo** de la retención.

El caso extremo no es discutible: **`third_party_activity.tarifa_ica_override` es una columna
`numeric(9,6)` que contiene una TARIFA**. Un `auxiliar_causacion` podía fijarla y con ello cambiar el
ReteICA que el motor calcula para ese proveedor, **sin tener `parametro.editar`**. La descripción
literal de ese rol en la migración 014 es *«Prepara borradores de causación. No aprueba, no publica y
no edita parámetros»*. Fijar una tarifa es editar un parámetro; la sección 6.2 punto 5 y la Regla de
Oro 2 no admiten lectura distinta por el hecho de que la tarifa viva en la ficha de un tercero en vez
de en `tax_rule`.

### La corrección (migración `140_a12_arranque_y_repaso_141.sql`)

Se parte el permiso **en el punto donde cambia el riesgo**, no en el punto donde cambia la tabla:

| Permiso | Qué autoriza | Quién lo tiene |
|---|---|---|
| `tercero.editar` | El maestro `third_party` | admin_firma, admin_tributario, **contador**, **auxiliar_causacion** (sin cambio) |
| `tercero.atributos_fiscales` *(nuevo)* | `third_party_fiscal_attribute` y `third_party_activity` | admin_firma, admin_tributario, **contador**. **El auxiliar lo PIERDE** |
| `parametro.editar` | **Además**, para fijar un `tarifa_ica_override` no nulo | admin_firma, admin_tributario |

Los tres razonamientos, explícitos:

- **Por qué el auxiliar conserva `tercero.editar`:** sin él no puede dar de alta al proveedor nuevo de
  una factura que acaba de llegar, que es exactamente su trabajo diario. Quitárselo rompería el flujo
  sin ganar nada: el maestro no cambia ninguna tarifa. Hay prueba de que sigue pudiendo crear terceros.
- **Por qué el auxiliar pierde los atributos fiscales:** él no aprueba nada. Darle la capacidad de
  cambiar la tarifa efectiva de un tercero era una elevación real de privilegio: el mismo usuario que
  prepara el borrador podía mover el número que el motor va a calcular, y la aprobación posterior del
  contador vería un resultado ya sesgado sin saberlo. Quitárselo **reduce exposición de verdad**.
- **Por qué el contador SÍ los conserva:** ya tiene `causacion.aprobar`, `asiento.publicar` y
  `periodo.cerrar` — es quien responde por el resultado y quien lo firma. Quitárselo movería el trabajo
  de sitio sin reducir ninguna exposición. Pero **no** se le da `parametro.editar` por la puerta de
  atrás: para poner una tarifa de ICA propia sigue necesitando al administrador tributario, que es lo
  que la sección 6.2 punto 5 dice.

**Se impone en el motor, no en la aplicación:** un trigger `BEFORE` sobre `third_party_activity`
comprueba la fila resultante (`NEW.tarifa_ica_override IS NOT NULL`), no el verbo, así que da igual si
llega por `INSERT` o por `UPDATE`. Los nombres de los triggers de permiso no cambiaron, de modo que el
orden de disparo alfabético que la migración 016 razonó se conserva intacto.

**Probado, con `SE002` del motor y no con un `throw` de TypeScript:** el auxiliar es rechazado al
registrar atributos fiscales; sigue pudiendo crear el tercero; contador y administrador tributario sí
los registran; solo lectura sigue sin poder; y el contador es rechazado al fijar `tarifa_ica_override`
mientras el administrador tributario pasa.

**Se actualizó en consecuencia** el espejo `PERMISOS` de `src/auth/permisos.ts` (que una prueba de
compuerta obliga a coincidir exactamente con la tabla `permission`), el servicio de terceros con
`puedeEditarAtributosFiscales`, y los mensajes de las cuatro pantallas de A8, que ahora nombran el
permiso correcto.

## B.4 Lo que este repaso NO cerró, y se declara

- **No hay pantalla de inscripción de MFA.** El motor está completo y `/entrar` ya acepta el código;
  lo que falta es que un usuario pueda activárselo por sí mismo. Es trabajo de interfaz.
- **La prueba de restauración de respaldos sigue sin ejecutarse** (A15). Es el punto más débil del
  bloque, porque de ella depende la afirmación de "reproducción exacta" del punto 13.
- **El simulacro de incidente nunca se ha hecho.**
- **Los documentos jurídicos siguen sin revisión de abogado**, y ahora además hay que añadirles el
  proveedor del LLM de A5 como encargado con transferencia internacional.
- **`app.integration_credential`, `app.session_context` y `app.usuario` no tienen RLS a propósito**
  (viven en el esquema `app`, sin GRANTs para ningún rol de aplicación): ahí el aislamiento es por
  privilegio, no por política, y es la decisión de D-021. El barrido de RLS cubre `public`, que es donde
  la 14.1 lo exige.
- **V-1** (`app.resolver_empresa_por_buzon`) quedó cerrada en la migración 100; no se reabrió nada.
- No se implementó RNBD, ni certificaciones formales, ni habilitación DIAN, según lo indicado.

---

# Compuertas — resultado literal

```
npm test
  Test Files  45 passed (45)
       Tests  902 passed (902)

npm run typecheck
  > tsc --noEmit
  (sin salida: limpio)

npx next build
  ✓ Generating static pages using 3 workers (7/7)
  Route (app)
  ┌ ƒ /
  ├ ƒ /entrar
  ├ ƒ /bandeja
  ├ ƒ /parametros
  ├ ƒ /terceros
  ├ ƒ /reportes
  ...
  (exit 0)
```

Las 880 anteriores siguen en verde; las 22 nuevas son `tests/gates/arranque.test.ts`.

---

# Archivos

**Encargo A**
- `db/migrations/140_a12_arranque_y_repaso_141.sql` (compartida con el B)
- `src/bootstrap/arranque.ts` — la justificación de seguridad completa está en su cabecera
- `src/bootstrap/arranque-cli.ts` — el comando `npm run arranque`
- `app/entrar/page.tsx`, `app/entrar/acciones.ts` — inicio y cierre de sesión
- `app/page.tsx`, `app/acciones.ts` — portada y selector de empresa
- `docs/arranque-primer-uso.md` — guía para el operador, sin jerga
- `package.json` — script `arranque`

**Encargo B**
- `db/migrations/140_a12_arranque_y_repaso_141.sql` — permiso nuevo, retarget de triggers, guardia de
  tarifa, auditoría de `third_party`, `app.registrar_exportacion`
- `app/api/reportes/[libro]/route.ts` — rastro `EXPORT`
- `src/auth/permisos.ts`, `src/services/terceros.ts`, `app/terceros/**` — espejo y mensajes
- `tests/gates/arranque.test.ts` — 22 pruebas, los dos encargos
- `tests/adversarial/casos-dorados.test.ts` — `src/bootstrap` declarado en el inventario cerrado de A14

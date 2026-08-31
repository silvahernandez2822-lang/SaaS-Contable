# V-17 — A8: maestro de terceros (cierre del bloqueador)

## El problema que cerraba esto

No existía **ni un solo** `INSERT INTO third_party` en `src/`, `app/` ni en las migraciones: el único
vivía en `tests/helpers/fixtures.ts`, y omite `direccion`. Consecuencia real: **no se podía causar la
factura de un proveedor nuevo** (`resolverTerceroPorNit` en `src/services/ingest.ts` resuelve por NIT
pero explícitamente no crea el tercero — "eso es maestro de datos, fuera de este servicio"), y el
Formato 1001 de exógena no podía llevar dirección ni código DANE del informado porque no había dónde
capturarlos.

## Qué queda creable y editable desde la interfaz

Nuevo módulo `/terceros`:

- **`/terceros`** — buscar por NIT o razón social, ver si cada tercero tiene atributos fiscales
  vigentes hoy (con advertencia visible si no).
- **`/terceros/nuevo`** — crear tercero: NIT (con tipo de persona, dígito de verificación opcional),
  razón social, **dirección y municipio obligatorios salvo "del exterior"** (Res. 000227/2025, art.
  1.3.5.2.1, Formato 1001). Si el esquema permite `direccion`/`municipality_id` nulos (los permite,
  para el caso del exterior), la interfaz igual los exige con el texto de la norma que lo justifica.
- **`/terceros/[id]`** — editar los datos generales (NO versionados: razón social, dirección,
  municipio, contacto — es maestro de datos mutable, igual que `company`), con resumen de atributos
  fiscales vigentes y actividades económicas vigentes, y enlaces a los dos módulos versionados.
- **`/terceros/[id]/atributos-fiscales`** — registrar una vigencia nueva de: declarante de renta,
  autorretenedor de renta, gran contribuyente, régimen SIMPLE, responsable de IVA, agente de retención
  de renta/IVA/ICA, autorretenedor de ICA, y régimen tributario. Historial completo visible (nunca se
  sobrescribe).
- **`/terceros/[id]/actividades`** — registrar actividad económica (municipio × CIIU × principal/
  secundaria) para ReteICA multimunicipio.

Editables desde YA: creación y datos generales del tercero, sus nueve atributos fiscales versionados,
y su actividad económica por municipio. **Todavía NO editables desde esta interfaz** (fuera del
alcance de V-17): el catálogo CIIU y el catálogo de municipios en sí mismos (alta de una identidad
nueva de municipio/CIIU — solo se **usan** aquí, vía selector, no se **crean**); eso sigue siendo
`/parametros` de otra ola, según A1/A8 lo dejaron documentado en `app/parametros/page.tsx`, que
actualicé para enlazar `/terceros` como ya construido.

## Cómo se obliga a declarar los atributos fiscales sin asumirlos (D-014 de A2)

Este es el punto más delicado del mandato y lo até en tres capas independientes, cada una capaz de
bloquear sola:

1. **Tipo en TypeScript**: `AtributosFiscalesInput` declara las nueve banderas como
   `boolean | null | undefined`, no `boolean` — así el compilador no puede fingir que siempre hay un
   valor.
2. **Runtime en el servicio**: `registrarAtributosFiscales` llama `requerirBooleano(valor, nombre)`
   sobre cada una de las nueve; si cualquiera no es literalmente `true`/`false`, lanza
   `AtributoFiscalIncompletoError` con el nombre exacto de la que falta. **No hay ninguna rama que
   traduzca "ausente" a `false`.**
3. **HTML**: `RadioSiNo` (`app/terceros/_componentes.tsx`) renderiza cada bandera como un par de radios
   "Sí"/"No" **sin `defaultChecked`** y con `required` en los dos — el navegador no deja enviar el
   formulario con una bandera sin tocar, y aunque alguien la sortee (curl, JS deshabilitado), la capa 2
   la vuelve a exigir.

Si un tercero no tiene ninguna vigencia a la fecha del hecho económico, `src/domain/repositorio.ts`
(A3) ya devuelve `null` y el motor manda a revisión manual — este módulo no cambia ni tapa ese
comportamiento; solo se asegura de que la interfaz nunca guarde un `false` que el contador no dijo.

## Cómo se manejan las actividades por municipio (multimunicipio, casos dorados 9 y 10)

`third_party_activity` versiona por la terna **tercero × municipio × CIIU** (columna generada
`clave_vigencia`, ya en 005). `registrarActividad` cierra la vigencia anterior **solo si existe una
fila abierta con la MISMA terna**; una terna distinta (otro municipio, u otra actividad en el mismo
municipio) es una fila independiente. Verificado con una prueba explícita: un tercero con actividad
principal en un municipio y secundaria en otro simultáneamente, sin que registrar la segunda cierre la
primera (`tests/services/terceros.test.ts`, "un proveedor puede tener actividad vigente en dos
municipios a la vez").

## Las seis conductas de la sección 6.2, en lo que aplica a un tercero

A diferencia de `parametrizacion.ts`, aquí **nunca** hay alcance compartido entre empresas:
`third_party.company_id` es `NOT NULL` (005) — cada proveedor es de una empresa concreta, así que no
hace falta el mecanismo firma/empresa de D-015.

1. **Nunca UPDATE de una vigencia ya vigente** — el trigger `PR001` (`app.trg_vigencia_append_only`,
   ya instalado sobre `third_party_fiscal_attribute` y `third_party_activity` en 005) lo impone; el
   servicio solo `UPDATE ... SET vigente_hasta` para cerrar, nunca toca los valores. Probado
   directamente: un `UPDATE` manual de un atributo fiscal falla con `PR001`
   (`VIGENCIA_INMUTABLE`).
2. **Fecha de vigencia obligatoria** — `requerirFechaIso` antes de tocar la base.
3. **Nunca retroactivo sobre lo publicado** — dos funciones SQL nuevas
   (`app.fecha_minima_vigencia_tercero_fiscal` / `..._tercero_actividad`, migración 081) devuelven el
   último `fecha_hecho_economico` **publicado** de ESE tercero (y, para actividad, en ESE municipio);
   el servicio lo hace cumplir con `EdicionRetroactivaError` antes de escribir. Probado con un asiento
   publicado real vía `crearAsientoBorrador` + `publicarAsiento` + `retention_applied`.
4. **Auditoría con norma de respaldo** — `app.trg_audit` ya está instalado sobre las dos tablas (009);
   el servicio exige la norma (`requerirNorma`) antes de intentar el `INSERT`.
5. **Permiso restringido** — el trigger `third_party*_permiso` (`tercero.editar`, migración 016) ya
   existe. **Nota de diseño heredada de A1/A2** (no reabierta aquí): `tercero.editar` está asignado no
   solo a `admin_tributario` sino también a `contador` y `auxiliar_causacion` (`014_roles_permisos_
   base.sql`) — a propósito, porque dar de alta un proveedor es trabajo cotidiano de causación, no un
   cambio de tarifa. La restricción a *solo* administrador tributario que pedía el mandato original de
   parametrización aplica a `tax_rule`/`uvt_value`/etc., no a este catálogo; no toqué esa matriz de
   permisos porque es una decisión ya cerrada de A2, y probé que `solo_lectura` sigue sin poder
   escribir (`SE002`).
6. **Simulador de impacto** — `simularImpactoAtributosFiscales` / `simularImpactoActividad` (sobre
   `app.simular_impacto_tercero_*`, migración 081): para UN tercero, "esto afecta N documentos suyos
   pendientes de causación y M asientos suyos ya publicados" — la adaptación natural de "N conceptos y
   M proveedores" cuando el parámetro que se edita ya es específico de un solo proveedor. Se muestra en
   el paso de confirmación antes de guardar, mismo flujo de dos pasos (`simularAction` /
   `confirmarAction`) que ya usa `parametrizacion.ts`.

## Diseño de base de datos: sin `SECURITY DEFINER`, a propósito (a diferencia de 080)

`db/migrations/081_a8_terceros_simulador.sql` añade 4 funciones. Ninguna es `SECURITY DEFINER` ni
usa `row_security = off`, al contrario que las de 080 (`simular_impacto_tax_concept` etc.): un
parámetro de `tax_rule` puede ser compartido entre empresas de una firma (`company_id NULL`), pero un
`third_party` es **siempre** de una empresa concreta. La RLS normal de `app_user` ya acota
correctamente; ensanchar el alcance ahí habría sido una superficie de riesgo innecesaria. Confirmé
esto releyendo `012_rls.sql` (`instalar_rls_tenant_company` sobre las tres tablas) antes de decidirlo,
en vez de copiar el patrón de 080 sin pensarlo.

## Verificación con el diseño RLS de A2

No hizo falta ningún cambio de A2: como cada tercero pertenece a una única empresa (`company_id NOT
NULL`), no existe el caso "administrador de firma editando un parámetro compartido entre sus
empresas" que sí aplica a `tax_rule`. Un administrador de firma edita los terceros de cada empresa
entrando con esa empresa seleccionada, exactamente como ya hace con cualquier otro dato de la empresa
(`company`, `journal_entry`, etc.) — el mismo patrón `tenant_id`+`company_id` con RLS de doble nivel
que exige la Regla de Oro 7, sin ningún caso especial nuevo.

## Otras decisiones

- **Dígito de verificación del NIT** (`calcularDigitoVerificacionNit`): algoritmo módulo once fijo
  (pesos 3,7,13,...,71 de la DIAN) usado solo como ayuda/verificación de transcripción en la interfaz,
  nunca para bloquear el guardado. Documenté explícitamente por qué NO es un valor tributario (Regla
  de Oro 2): es un checksum fijo, no una tarifa/base/UVT/SMMLV/tope/calendario, y no cambia con ninguna
  reforma. Verificado contra el NIT público de la DIAN (800.197.268-4): el cálculo da 4.
- **`src/services/index.ts`** — añadí el barrel de `terceros.ts`, sin duplicar las tres clases de
  error que ya reexporta desde `parametrizacion.ts` (`NormaDeRespaldoRequeridaError`,
  `VigenciaInvalidaError`, `EdicionRetroactivaError`) porque `terceros.ts` las reimporta y reexporta
  de ahí mismo — exportarlas dos veces desde el barrel habría sido un choque de nombres.
- **Migraciones usadas**: solo `081` (`080` ya la había tomado el propio A8 en la Ola 2 para el
  simulador de `parametrizacion.ts`). Dentro del rango reservado 080–089.

## Resultado literal de las tres compuertas

```
$ npm run typecheck
> tsc --noEmit
(sin salida — limpio)

$ npm test -- --run
 Test Files  44 passed (44)
      Tests  871 passed (871)
   Duration  270.04s
(exit code 0)

$ npx next build
✓ Compiled successfully in 1942ms
  Running TypeScript ...
  Finished TypeScript in 3.4s ...
✓ Generating static pages using 3 workers (7/7)
Route (app) ... incluye /terceros, /terceros/nuevo, /terceros/[id],
              /terceros/[id]/atributos-fiscales, /terceros/[id]/actividades
(exit code 0)
```

871 = 849 de antes de V-17 + 22 pruebas nuevas de `tests/services/terceros.test.ts` (crear/editar
tercero, las seis conductas para atributos fiscales, las seis conductas para actividad económica,
multimunicipio, permiso denegado, retroactividad con asiento publicado real).

## Archivos

Nuevos:
- `db/migrations/081_a8_terceros_simulador.sql`
- `src/services/terceros.ts`
- `tests/services/terceros.test.ts`
- `app/terceros/_componentes.tsx`
- `app/terceros/page.tsx`
- `app/terceros/nuevo/page.tsx`, `app/terceros/nuevo/acciones.ts`
- `app/terceros/[id]/page.tsx`, `app/terceros/[id]/acciones.ts`
- `app/terceros/[id]/atributos-fiscales/page.tsx`, `.../acciones.ts`
- `app/terceros/[id]/actividades/page.tsx`, `.../acciones.ts`

Modificados:
- `src/services/index.ts` (exporta `terceros.ts`)
- `app/parametros/page.tsx` (enlaza `/terceros`, ya no aparece como "todavía no editable")

No toqué `src/services/ingest.ts`: su decisión de no crear el tercero es correcta y sigue vigente; una
vez el contador crea el proveedor aquí, `resolverTerceroPorNit` lo encuentra por NIT+empresa y la
causación deja de bloquearse. No lo probé de punta a punta con A11 (fuera del alcance pedido), pero
verifiqué que `direccion`, `municipality_id` y `codigo_dane` quedan poblados desde la creación, que es
exactamente lo que el Formato 1001 necesita.

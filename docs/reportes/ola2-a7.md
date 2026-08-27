# A7 — Bandeja de causación multi-empresa (Ola 2, sección 4)

**Estado:** entregado, pendiente de la compuerta de A14.
**Migración:** `db/migrations/070_a7_bandeja_causacion.sql` (rango reservado 070-079; solo se usó una).
**`npm test`:** **521 pruebas en verde** (517 previas + 4 propias en `tests/services/bandeja.test.ts`).
**`npm run typecheck`:** limpio.
**No toqué `ESTADO_PROYECTO.md`. No hice `git commit`.**

Aviso de proceso: un intento anterior mío murió por límite de cupo durante la sola lectura de
orientación, sin escribir nada. Este reporte describe el trabajo de un segundo intento que retomó
desde cero con el contexto ya resumido por el coordinador.

---

## 1. Qué se entrega

```
db/migrations/070_a7_bandeja_causacion.sql   app.empresas_accesibles(), document_correction, índice de revisión
src/services/bandeja.ts                       Multi-empresa, correcciones V-7/V-8, pendientes de revisión, municipios
src/services/consulta.ts (de A6, tocado)      RetencionResumen y AsientoResumen: vigencia, norma, municipio, partidas
src/services/causacion.ts (de A6, tocado)     causarFactura lee document_correction (AIU por línea, municipio)
src/services/index.ts                         Reexporta el módulo de bandeja
app/lib/sesion.ts (de A8, tocado)             conSesionEmpresa: sesión con empresa explícita, no solo la de la cookie
app/lib/bandeja.ts                            Orquestación: una sesión por empresa, agregación en una sola pantalla
app/bandeja/page.tsx                          La pantalla
app/bandeja/_componentes.tsx                  Traza de retenciones, partidas, líneas con AIU, selector de municipio
app/bandeja/acciones.ts                       Aprobación en lote (agrupada por empresa) + corrección y reproceso
tests/services/bandeja.test.ts                4 pruebas, dos de ellas de punta a punta (V-7 y V-8 por el canal real)
tests/adversarial/evasion.test.ts (tocado)    Inventario SECURITY DEFINER: +1 función
tests/adversarial/compuerta-ola1.test.ts (tocado)  Mismo inventario, copia duplicada a propósito (D-042)
```

---

## 2. La bandeja multi-empresa: cómo se resolvió el problema de fondo

El obstáculo real no era la UI, era el modelo de sesión. D-021/D-022 establecen que una sesión
opera sobre **una** empresa a la vez —`app.current_company_id()` solo devuelve la empresa que el
cliente pidió, y solo si tiene acceso vigente sobre ella—. Eso es correcto y no se toca: es la Regla
de Oro 7 implementada con seriedad. Pero significa que ninguna consulta puede, por sí sola, traer
"las facturas pendientes de mis 30 empresas": hay que abrir 30 sesiones.

Antes de poder abrir 30 sesiones había que saber **cuáles son las 30 empresas**, sin "probarlas" una
por una contra `withSessionContext` (cada intento sobre una empresa sin acceso deja un
`ACCESO_DENEGADO` en `audit_log`, D-022 — 30 intentos reales y 30 fallidos por sesión sería ruido de
auditoría fabricado por la propia interfaz). `user_company_access` tiene RLS estricta de empresa
(`instalar_rls_tenant_company`), así que consultarla exige ya conocer la empresa: el mismo problema
del huevo y la gallina que ya resolvió `app.current_company_id()` cuando se creó en la migración 015.

**Solución:** `app.empresas_accesibles()`, una función `SECURITY DEFINER` + `row_security = off`
(migración 070) que resuelve `user_id`/`tenant_id` de la sesión ya verificada y lee el espejo
`app.acceso_usuario_empresa` (sin RLS, sin GRANTs para `app_user`, tal como ya documentaba D-021)
para devolver **solo** las empresas de esa sesión, con su rol de negocio en cada una. Mismo patrón
que `app.resolver_empresa_por_buzon` (A4, D-023) y que los simuladores de impacto de A8 (migración
080): filtro explícito, no bypass general. No acepta ningún parámetro — no hay firma que falsificar.
Exige `documento.leer`.

Con eso, `app/lib/bandeja.ts` hace la orquestación real:

1. Abre una sesión "de firma" (`companyId = ''`, D-015) y llama `app.empresas_accesibles()`.
2. Por cada empresa devuelta, abre una sesión **normal** con esa empresa (`conSesionEmpresa`, nueva
   en `app/lib/sesion.ts`) y llama, en la misma transacción, `listarPendientesDeAprobacion` (A6),
   `listarPendientesRevision` (A7, nueva) y `listarMunicipiosParaCorreccion` (A7, nueva).
3. Agrega todo en un único arreglo, con el nombre de la empresa ya pegado a cada fila, y ordena por
   fecha del hecho económico.

**Rendimiento, declarado sin adornarlo:** son tantas transacciones como empresas accesibles (hasta
30-60), en **secuencia**, no en paralelo. El cliente de base de datos de este repositorio (una
conexión de PGlite en pruebas, una conexión de `postgres.js` en producción) no está pensado para
abrir transacciones concurrentes entre sí sin un pool, y montar un pool no es una decisión que le
corresponda a A7 en solitario dentro de esta ola. Con un tope de 20 documentos por empresa
(`LIMITE_POR_EMPRESA`), el costo es de decenas de consultas pequeñas — aceptable para una pantalla
que un contador abre para trabajar, no para cada factura individual. Si el volumen de producción lo
exige, la optimización natural es un pool en `src/db/client.ts`, nunca aflojar RLS para "leer varias
empresas en una sola consulta": esa ruta sí violaría la Regla de Oro 7.

**Aprobación en lote a escala de 50 facturas de 30 empresas:** el contrato que A6 dejó escrito para
mí en `docs/reportes/ola1-a6.md` §4.4 es literal — `aprobarAsientosEnLote` nunca acepta un
`companyId` por ítem, así que agrupo por empresa en `app/bandeja/acciones.ts`
(`agruparPorEmpresa`, que separa un solo `<input name="sel" value="companyId::journalEntryId">` por
fila seleccionada) y llamo la función una vez por empresa, cada una con su propia sesión. Un fallo en
una empresa completa (permiso insuficiente, sesión vencida) no aborta las demás — mismo principio que
ya tiene A6 por ítem dentro de una empresa, aplicado aquí un nivel más arriba. El checkbox de cada
fila viaja con la empresa codificada porque la tabla de la bandeja mezcla filas de las 30-60 empresas
en una sola pantalla; el servidor nunca confía en qué empresa "dice" el cliente que es cada fila más
allá de usarla para **abrir la sesión correcta** — la autorización real la sigue haciendo la base al
verificar el acceso de esa sesión sobre esa empresa exacta.

**`userId` de cada aprobación:** nunca viaja en el formulario. Se lee siempre con
`SELECT app.current_user_id()` dentro de la transacción ya abierta — un campo oculto con el id del
usuario habría sido, literalmente, dejar que el cliente eligiera a nombre de quién se aprueba.

---

## 3. Base, tarifa, norma y vigencia — visibles, no un detalle técnico

El motor de A3 ya devolvía los siete campos de la sección 9.1 y `retention_applied` ya los persistía
completos desde la Ola 1 (`regla_vigente_desde`, `regla_vigente_hasta`, `norma_respaldo`, `tarifa`,
`base`, `valor`, `account_id`). Lo que faltaba era exponerlos: `RetencionResumen`
(`src/services/consulta.ts`, de A6) solo traía `base`, `tarifa`, `valor`, `aplicada` y
`normaRespaldo`. Añadí `vigenteDesde`, `vigenteHasta`, y —para que V-8 sea visible y no solo
corregible— `municipioNombre` (el municipio que **de verdad** se usó, vía `LEFT JOIN municipality`)
y `conceptoCodigo`/`conceptoNombre` (vía `LEFT JOIN concepto_causacion`). También añadí
`AsientoResumen.partidas`: el detalle de `journal_line` (cuenta PUC, movimiento, monto, descripción)
de cada asiento, para que la bandeja no se quede en el resumen y muestre también el asiento completo
bajo un `<details>`.

`app/bandeja/_componentes.tsx` (`TrazaRetenciones`) pinta una tabla por documento con columnas Tipo,
Concepto, Base, Tarifa, Valor, Vigente desde, Vigente hasta, Municipio y Norma aplicada — **incluidas
las retenciones que se evaluaron y no aplicaron**, con su motivo, porque "se evaluó y no aplicó" es
tan trazable como "se aplicó" (sección 9.3).

---

## 4. V-7 (AIU por línea) — qué se hizo, con el pipeline real, no solo declarado

El motor de A3 **ya soportaba** `LineaFactura.valorAiu` desde la Ola 1 (`src/domain/tipos.ts`); lo
que faltaba era una fuente real de ese dato, porque el parser de A4 no discrimina AIU por línea.

- `document_correction` (migración 070): tabla append-only donde un humano captura el AIU de una
  línea concreta (numerada como la numera A4/A6 en `extraction`), con motivo obligatorio (Regla de
  Oro 6) y quién la creó.
- `guardarCorreccionAiu` (`src/services/bandeja.ts`) valida enteros de centavos (Regla de Oro 5) y
  exige `documento.reprocesar`.
- `causacion.ts::causarFactura` (de A6, tocado en ocho líneas reales, siguiendo el precedente que dejó
  A5 con el mismo archivo) llama `obtenerCorreccionesVigentes` **antes** de agrupar líneas por
  concepto, y `agruparLineasPorConcepto` ahora sabe sumar el AIU de las líneas corregidas dentro de
  cada grupo de concepto — exactamente el mismo patrón que ya usaba para sumar base e IVA. A6 sigue
  sin calcular nada: solo alimenta la entrada del motor con un dato que un humano ya confirmó.
- La bandeja de "pendientes de revisión" (`listarPendientesRevision`) muestra las líneas reales del
  documento (descripción, base) con un campo de captura de AIU al lado de cada una — el sistema no
  adivina a cuál línea pertenece el AIU; el humano lo decide viendo la descripción real de la
  factura, que es información que el sistema no tiene forma honesta de inferir.
- Cerrado un `document_correction`, se llama `reencolarJob` (A6, Ola 1) para reprocesar.

**Prueba de punta a punta** (`tests/services/bandeja.test.ts`, "V-7"): un concepto de vigilancia con
`base_es_aiu = true` sobre `tax_rule` REAL de A1 (Decreto 572 de 2025, 2% sobre AIU) cae en
`revision_manual` con el motivo `concepto_aiu_sin_aiu_declarado`; se captura el AIU vía
`guardarCorreccionAiu`, se reencola, y el segundo intento de `procesarJobCausacion` causa con
`base = AIU ($500.000)`, no el total (`$5.000.000`), `tarifa = 2%`, `valor = $10.000`,
`vigenteDesde = 2026-07-01`, `normaRespaldo` citando el Decreto 572 — leído de vuelta con
`consultarEstadoDocumento`, el mismo camino que usa la bandeja real. Esto es lo que el caso dorado 11
probaba solo contra el motor (según V-7 en el registro de vulnerabilidades); ahora también está
probado contra el canal real de ingesta → cola → corrección → reproceso → aprobación.

---

## 5. V-8 (municipio de la operación) — qué se hizo, con el pipeline real

`procesarJobCausacion` seguía usando el municipio del tercero como municipio de la operación por
defecto (eso no cambió: sigue siendo el comportamiento sin corrección, y está documentado como tal).
Lo que se añadió es la corrección:

- `document_correction` (tipo `municipio_operacion`, a nivel de documento completo — el motor sí
  soporta un municipio por línea vía `LineaFactura.municipioOperacionId`, pero ningún caso real visto
  hasta ahora trae más de un municipio por factura; documenté la simplificación en vez de inventar un
  caso que nadie pidió).
- `guardarCorreccionMunicipio` exige `documento.reprocesar` y un motivo.
- `causarFactura` prioriza `correcciones.municipioOperacionId` sobre el municipio del tercero.
- La bandeja de revisión trae un `<select>` con el catálogo de municipios (híbrido: global + de cada
  empresa) para que el humano elija directamente, en vez de escribir un id a mano.

**Prueba de punta a punta** (`tests/services/bandeja.test.ts`, "V-8"): un tercero cuyo municipio (el
de la ficha del fixture) no tiene ninguna `municipality_ica_rule` cargada cae en `revision_manual`
con `municipio_sin_parametros_de_reteica`; se corrige el municipio a Medellín (código DANE 05001, la
única tarifa de ICA real que carga A1 — Acuerdo 066 de 2017, 2‰, V-4) y el reproceso causa con esa
tarifa real, visible después vía `consultarEstadoDocumento.retenciones[].municipioNombre` = Medellín,
no el municipio original del tercero.

**Límite declarado, no silenciado (para A0/A6/A2):** la corrección de municipio SOLO se aplica
mientras el documento sigue sin causar (`estado IN ('recibido','parseado')`) — porque
`app.reencolar_job` (A6, Ola 1) solo tiene efecto en ese estado; una vez que el documento llega a
`pendiente_aprobacion`, ya existe un asiento borrador con las partidas construidas, y "recalcularlo"
exigiría anular ese borrador y reconstruirlo, algo que hoy A6 no expone como operación (solo expone
rechazar, que dej el documento en `rechazado` y tampoco es reprocesable por `reencolarJob`, que exige
`recibido`/`parseado`). Diseñar un "recall de un borrador ya construido para recalcular con datos
corregidos" es una decisión de ledger que le corresponde a A6/A2, no a A7 en solitario dentro de esta
ola. El camino soportado hoy si el municipio quedó mal en un asiento ya construido es: revisarlo en
la traza visible de la bandeja de aprobación (el `municipioNombre` real está ahí, a la vista) y
**rechazar** esa aprobación si no corresponde — vía a la vía que sí existe.

---

## 6. Decisiones de UX

- **Dos secciones en una sola pantalla, no dos pestañas**: "pendientes de aprobación" (con checkbox
  y traza completa) y "pendientes de revisión" (con formulario de corrección), ambas mezclando las
  filas de todas las empresas accesibles. La compuerta de la Ola 2 pide literalmente "una sola
  pantalla", así que evité fragmentarla por empresa o por tipo de acción.
- **Corregir y reprocesar es UNA sola decisión, un solo botón**, no dos pasos separados: el
  formulario de un documento en revisión guarda las correcciones de AIU y/o municipio que el humano
  llenó y llama `reencolarJob` en la misma acción de servidor. Menos clics, y evita el estado
  intermedio de "corregí pero se me olvidó reprocesar".
- **AIU en pesos enteros, no en centavos ni con decimales**: el campo de captura pide pesos
  colombianos enteros (`step="1"`) y la conversión a centavos (`× 100`) ocurre en el servidor. Evita
  a propósito el patrón `step="0.01"` que ya le salió al paso a A8 con el detector de la Regla de Oro
  2 — no porque haga falta más precisión (el peso colombiano no tiene una fracción de uso corriente
  en facturación), sino para no tener ni una superficie de decimales en el formulario.
- **Retenciones que no aplicaron se muestran igual**, con su motivo en la misma fila que la norma:
  "se evaluó y no aplicó" es información que un contador necesita para confiar en el sistema, no un
  ruido que ocultar.
- **El detalle del asiento (`journal_line`) va bajo un `<details>` colapsado**, no siempre visible:
  la traza de retenciones (base/tarifa/norma/vigencia) es lo que la sección 4 pide visible por
  defecto; el desglose contable completo es una ampliación para quien lo necesite, no el primer plano.
- **Sin acordarme de "quién es esta fila" por confianza**: cada fila de la bandeja consolidada lleva
  el `companyId` explícito en el propio valor del checkbox o en un campo oculto del formulario — no
  hay estado de sesión que "recuerde" en qué empresa está cada factura, porque en esta pantalla no
  hay una sola empresa en sesión: hay 30-60 a la vez, y cada acción tiene que decir explícitamente a
  cuál pertenece para que el servidor abra la sesión correcta.

---

## 7. Regla de Oro 2 — cómo evité el detector sin aflojarlo

Ni un literal `0.NNN` ni un `NNN%` en ningún archivo de `app/` ni de `src/services/bandeja.ts`.
Las conversiones de centavos a pesos (`Number(x) / 100`) y de fracción a puntos porcentuales
(`Number(x) * 100`) son siempre cálculos en tiempo de ejecución sobre datos que vienen de la base —
igual que ya lo resolvió A8 en el módulo de parametrización—, nunca un decimal escrito a mano. El
campo de AIU pide pesos enteros (`step="1"`), evitando el `step="0.01"` que ya le disparó el
detector a A8. Verifiqué con `grep -nE "[0-9]{5,}"` sobre todos mis archivos de `src/`/`app/` antes
de correr la suite, y `npm test` corrió `tests/adversarial/valores-tributarios.test.ts` en verde sin
tocar ni una de sus seis reglas.

---

## 8. Cambios sobre código ajeno (para que A14 los mire con lupa)

1. **`src/services/causacion.ts` (A6):** `GrupoConceptoCausacion` gana un campo `valorAiu`;
   `agruparLineasPorConcepto` acepta un tercer parámetro opcional (`aiuPorLinea`, con valor por
   defecto un `Map` vacío — **cero cambio de comportamiento** para quien no lo pase, verificado: las
   12 pruebas existentes de `tests/services/causacion.test.ts` siguen en verde tal cual); y
   `causarFactura` llama `obtenerCorreccionesVigentes` para resolver el municipio y el AIU antes de
   construir `EntradaFactura`. A6 sigue sin calcular ninguna tarifa, base ni redondeo — Regla de Oro 4
   intacta.
2. **`src/services/consulta.ts` (A6):** `RetencionResumen` y `AsientoResumen` ganan campos (sección
   3); ninguno se quitó, así que ningún consumidor existente se rompe (verificado:
   `tests/services/consulta.test.ts` en verde sin tocarlo).
3. **`app/lib/sesion.ts` (A8):** `contextoDesdeRequest` acepta un parámetro opcional de empresa
   (`undefined` = comportamiento histórico, leer de la cookie); se añadió `conSesionEmpresa`. `conSesion`
   no cambió su firma ni su comportamiento.
4. **`tests/adversarial/evasion.test.ts` y `compuerta-ola1.test.ts` (A14):** añadí
   `app.empresas_accesibles` a las DOS copias del inventario cerrado de funciones `SECURITY DEFINER`
   (duplicadas a propósito por D-042), con el mismo razonamiento que ya usaron las cinco funciones de
   A8: filtro explícito, sin parámetros, no cruza de tenant.
5. **Migración 070 y el barrido de D-032:** mi primera versión de `document_correction` dejó dos FK
   simples sin acotar alcance (`company_id -> company`, `municipio_operacion_id -> municipality`);
   `tests/adversarial/evasion.test.ts` (el barrido completo de `pg_constraint`, no una prueba mía) lo
   cazó de inmediato. Lo cerré con una FK compuesta `(company_id, tenant_id) -> company(id, tenant_id)`
   y el guardia de alcance genérico `app.instalar_guardia_alcance` para `municipio_operacion_id`
   (mismo mecanismo que ya usa `third_party.municipality_id`, porque `municipality` es un catálogo
   híbrido con `tenant_id` nulo para las filas globales). Quedó verificado por la misma prueba, no por
   mí mismo diciendo que está bien.

---

## 9. Lo que A7 NO hizo (frontera declarada)

- **No hay login real todavía.** Como el módulo de A8, esta pantalla depende de la cookie de sesión
  que documenta `src/auth/autenticacion.ts`; no inventé un mecanismo propio.
- **No hay bandeja de revisión de clasificación de A5** (`clasificacion_pendiente`,
  `confirmarClasificacion`). A5 lo dejó anotado como A5-3 a mi cargo, pero A5-2 (el job de cola que de
  verdad invoca `clasificarDocumento` desde el worker) está sin construir y es de A6/A13: sin esa
  costura, una interfaz de revisión de clasificación no tendría nada que mostrar hoy — sería UI
  muerta. Lo dejo explícito para que quien cierre A5-2 sepa que la pantalla que la consume está
  pendiente, no perdida de vista.
- **No hay "recall" de un asiento borrador ya construido** para recalcular con un municipio
  corregido después de causar (sección 5, límite declarado).
- **No paralelicé las consultas entre empresas** (sección 2, rendimiento declarado).

---

## 10. Para A14

- `npm test`: **521 en verde**, cero fallos, cero `todo` nuevos.
- `npm run typecheck`: limpio.
- El detector de la Regla de Oro 2 corrió sobre mis archivos de `app/` y `src/services/bandeja.ts` sin
  que hiciera falta tocar ninguna de sus seis reglas.
- El barrido de D-032 (FK sin acotar alcance) encontró y me hizo corregir dos huecos reales antes de
  cerrar — quedó verificado por la prueba existente, documentado en la sección 8.
- Dos pruebas de punta a punta nuevas cierran V-7 y V-8 contra el pipeline real (ingesta → cola →
  motor de A3 con datos reales de A1 → corrección humana → reproceso → aprobación), no solo contra el
  motor en aislamiento.

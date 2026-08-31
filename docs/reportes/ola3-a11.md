# Ola 3 — A11: información exógena (sección 7.7)

## Alcance de esta entrega

Los siete formatos núcleo de exógena que pedía el encargo — **1001, 1003, 1005, 1006, 1007, 1008 y
1009** —, cada uno generado desde el ledger real (`journal_line`/`retention_applied`, asientos
`posted`), en dos salidas:

1. **El layout que exige la resolución vigente**: un archivo plano delimitado por `|` (`plano.ts`),
   con una advertencia explícita al principio de cada archivo sobre lo que este agente NO pudo
   verificar (ver más abajo).
2. **Excel de cuatro hojas para revisión previa del contador**, reutilizando **tal cual** el
   constructor de A9 (`construirLibroExcel` de `src/reports/excel.ts`) — no se reimplementó nada de
   eso.

No toqué los formatos 1010, 1012, 2276, 2820/2833: A1 ya los tiene catalogados en `exogena_format`
(migración 019 + `db/seeds/tanda2/080_exogena_formatos.sql`), pero generarlos bien (socios, nómina,
enajenación de acciones) es trabajo nuevo de fuentes de datos que este producto todavía no captura
(socios/accionistas, nómina) y que no alcanzaba a hacer bien con el cupo restante. Siete completos y
probados, no doce a medias.

## Archivos nuevos

- `db/migrations/130_a11_exogena_mapeo_cuentas.sql` — tabla `exogena_account_mapping`: el puente
  "cuenta PUC → concepto de un formato de exógena" que la sección 6.3 pide y que la migración 019 de
  A1 dejó **explícitamente pendiente** ("necesitaría su propia tabla puente... queda como pendiente de
  diseño para cuando haya datos que cargar"). Ahora hay datos que cargar (1008/1009/1003), así que la
  creé con el mismo patrón que toda tabla paramétrica del proyecto: vigencia append-only, RLS híbrida,
  permiso `parametro.editar`, auditoría, guardia de alcance. **No es un valor tributario**: es la
  cuenta que el contador de la firma designa para cada concepto, por eso su `norma_respaldo` suele ser
  la decisión del contador, no una resolución DIAN (documentado en el comentario de la columna).
- `src/reports/exogena/tipos.ts`, `terceros.ts`, `consulta.ts`, `plano.ts`, `formatos.ts`, `index.ts`
  — el módulo completo, exportado desde `src/reports/index.ts`.
- `tests/reports/exogena.test.ts` (8 pruebas, PGlite real).

## Cómo se generó cada formato, y de dónde sale cada cifra

- **1001** (pagos/abonos y retenciones practicadas): "valor del pago o abono en cuenta" = suma de las
  partidas de CRÉDITO de la causación de compra (contrapartida + cada retención), restringida a
  créditos con `retention_applied_id` o a la(s) cuenta(s) de contrapartida de compra — por partida
  doble es exactamente la misma cifra que la suma de débitos (gasto + IVA descontable), sin tocar
  `source_document.total_neto` como segunda fuente que pudiera divergir del ledger. Retenciones por
  tipo desde `retention_applied` (`retefuente`/`reteiva`/`reteica`, `aplicada = true`).
- **1003** (retenciones que le practicaron a la empresa): fuente = `retention_applied` tipo
  `autorretencion`, más lo que el contador mapee en `exogena_account_mapping` (concepto
  `retencion_practicada_a_la_empresa`). **Ver limitación de alcance abajo: esto es parcial.**
- **1005/1006** (IVA descontable/generado): mismo criterio que "Detalle de IVA" de A9 (cuenta por
  nombre `ILIKE '%iva%'` + naturaleza contable), reimplementado aquí agregando por tercero en SQL en
  vez de traer el crudo fila por fila.
- **1007** (ingresos): `app.niif_de_cuenta(account_id, fecha)` (función YA EXISTENTE de A10) filtrando
  `clasificacion_niif = 'ingreso'`, resuelta a la fecha de cada hecho económico.
- **1008/1009** (CxC/CxP): saldo natural al corte de las cuentas candidatas. Para 1009, las cuentas
  candidatas son `concepto_causacion.cuenta_contrapartida_id` (lo que el motor de causación ya usa
  como contrapartida de compra) UNIDO con lo que el contador mapee en `exogena_account_mapping`. Para
  1008 **solo** existe la vía del mapeo manual: el producto no causa ventas, así que no hay una fuente
  automática de cuentas por cobrar comerciales.

## El bloqueo del Formato 1001 — VERIFICADO, y es real

**Resultado de la verificación pedida:** el **esquema** de `third_party` (migración `005_terceros.sql`,
A2) **sí tiene** los dos campos que exige el art. 1.3.5.2.1 de la Res. 000227/2025 — `direccion` (text)
y `municipality_id` (con `codigo_dane` denormalizado) —, y `municipality` trae también
`codigo_dane_departamento`. Hasta ahí, A2 ya hizo su parte.

**Pero el problema no es el esquema: es que esos dos campos son `NULL`-ables y NO hay ninguna interfaz
que los pida al crear el tercero — porque no hay ninguna interfaz para crear terceros, punto.**
Verifiqué explícitamente:

- `grep -rn "third_party" app/` no devuelve **ningún** archivo: no existe una sola página ni ruta API
  bajo `app/` que lea o escriba `third_party`.
- `src/services/ingest.ts` resuelve el tercero emisor por NIT contra uno que YA EXISTE, con el
  comentario propio del autor: *"No lo crea: eso es maestro de datos, fuera de este servicio."*
- Las únicas sentencias `INSERT INTO third_party` de todo el repositorio están en
  `tests/helpers/fixtures.ts` (montaje de escenarios de prueba) — y ese mismo fixture **tampoco**
  carga `direccion`, exactamente el síntoma del problema.

Es decir: hoy, un tercero solo puede existir en la base de datos si alguien lo inserta a mano por SQL
(o un futuro flujo que aún no se construyó), y nada en el producto pide dirección ni municipio en ese
momento. El Formato 1001 se generará, pero con esas dos columnas en blanco para cualquier tercero
real, y este agente **no las rellenó con ningún valor por defecto**.

**Este agente lo trata como bloqueo, no como advertencia de pie de página:**

1. El código de `src/reports/exogena/terceros.ts` (`tercerosIncompletosParaFormato1001`) detecta esto
   en tiempo de generación, no al final del año: cualquier tercero sin `direccion` o sin
   `municipality_id`/`codigo_dane` (salvo terceros del exterior, que la propia base prohíbe con
   municipio colombiano) aparece en `tercerosIncompletos`.
2. `generarFormato1001` **no se detiene** por eso (generar el resto del archivo sigue siendo útil),
   pero **tampoco lo esconde**: agrega una hoja **"Bloqueos"** al Excel con la lista exacta de
   terceros y qué les falta, y dos líneas de advertencia en el archivo plano.
3. Prueba de regresión (`tests/reports/exogena.test.ts`) que verifica ambas cosas contra un tercero
   real del fixture compartido (que no trae dirección) — no es una aserción teórica, se demuestra.

**A quién le toca, en dos partes:**

- **A2 (esquema):** nada que corregir — el esquema ya está bien. Sugerencia menor y no bloqueante: si
  en algún momento se decide que dirección/municipio deban ser NOT NULL para terceros nacionales, esa
  es una migración de A2 que este agente no hizo (cambiar una columna a NOT NULL retroactivamente es
  una decisión de producto, no algo que un agente de reportería deba imponer).
- **A8 (interfaz), bloqueo real:** **no existe ninguna pantalla para crear o editar un tercero.** Hasta
  que exista, y hasta que ese formulario declare `direccion` y el municipio como campos obligatorios
  (o al menos advierta fuerte si se dejan vacíos), cualquier tercero que entre al sistema entrará sin
  esos datos, y el Formato 1001 seguirá necesitando la hoja "Bloqueos" para SIEMPRE, no como
  excepción. Este es el hallazgo central de esta entrega y **no se debe cerrar en silencio**.

## Advertencia 17.5 — qué cargué como dato, y qué dejé pendiente de verificación humana

**No cargué ningún tope ni plazo nuevo.** Revisé lo que A1 ya dejó en `db/seeds/tanda2/080_exogena_formatos.sql`
y está bien hecho: el umbral general de 2.400 UVT (AG2025) y los plazos 2026 quedaron en el campo
`notas` de `exogena_format`, **explícitamente NO** en `tope_uvt` de cada formato (con el razonamiento
correcto: es un umbral general de obligación a informar, no un tope por formato) y **sin** ninguna
fecha de vencimiento inventada por NIT en `tax_calendar`.

Lo que **yo** dejo explícitamente pendiente de verificación humana, sin inventarlo:

1. **Los códigos numéricos DIAN de "tipo de documento" y de "concepto"** dentro de cada formato (p.
   ej. qué número exacto identifica NIT vs. CC, o compras vs. honorarios en el Formato 1001). El anexo
   técnico de la Resolución 000227 de 2025 que los publica no estuvo disponible para este agente. En
   vez de inventar una tabla de equivalencias, el layout exporta los valores **de texto** que ya trae
   `third_party`/`concepto_causacion` (p. ej. `"NIT"`, no `"31"`), y cada archivo generado lleva una
   línea de advertencia (`ADVERTENCIA_LAYOUT_NO_VERIFICADO` en `plano.ts`) diciendo exactamente esto,
   para que el contador lo coteje contra el anexo técnico antes de presentar.
2. **El vencimiento exacto por último dígito de NIT** dentro de las ventanas que sí trae la sección 7.7
   ("grandes contribuyentes 28-abr a 13-may; personas jurídicas y naturales 14-may a 12-jun,
   escalonado por NIT"). La sección 7.7 da el rango agregado, no la fecha por dígito. Insertar una
   sola fecha en `tax_calendar` habría sido **inventar** cuál dígito vence cuándo dentro de esa
   ventana — exactamente el escenario que la advertencia 17.5 señala como el más peligroso (un plazo
   incorrecto hace que un cliente presente tarde). **No inserté ninguna fila.** Queda pendiente de
   verificación normativa humana contra el calendario tributario 2026 que publique la DIAN.
3. **El posible tope "por operación" o "por beneficiario" dentro del Formato 1001** (algunos formatos
   de exógena consolidan beneficiarios de cuantía menor bajo un NIT genérico). Si ese umbral existe
   para AG2025, no está en la sección 7.7 que se me dio ni lo pude verificar en otra parte del
   repositorio, así que no lo implementé ni lo mencioné como si existiera con un valor concreto.

## Limitación de alcance que dejo documentada (no es un bloqueo, es la naturaleza del producto)

El producto **no procesa facturas de venta**, solo de compra. Eso significa que el Formato 1003 (lo
que un CLIENTE le retuvo a la empresa al pagarle) y el Formato 1006 (IVA generado en ventas) no tienen,
estructuralmente, una fuente de datos automática en este ledger salvo que la firma registre sus ventas
por asiento manual. Documenté esto en la `advertencias` que cada uno de esos dos generadores devuelve
en tiempo de ejecución (no solo en este reporte), para que la interfaz que los consuma se lo muestre al
contador.

## Las tres compuertas de cierre

- `npm test` → **699 pruebas en verde** (691 previas + 8 nuevas de `tests/reports/exogena.test.ts`).
- `npm run typecheck` → limpio.
- `npx next build` → compila sin errores (Next.js 16.3.3, Turbopack); no toqué `app/`, así que las
  rutas existentes de A7/A8/A12/A13 siguen igual.
- Verificación adicional: corrí `tests/adversarial/valores-tributarios.test.ts` (las 42 pruebas del
  detector de A14) con este módulo dentro — pasan igual, sin falsos positivos por las máscaras de
  moneda ni por el archivo plano.

## Formatos que quedan generables hoy (para `ESTADO_PROYECTO.md`)

Los siete núcleo de la sección 7.7, cada uno en `src/reports/exogena/formatos.ts`:
`generarFormato1001`, `generarFormato1003`, `generarFormato1005`, `generarFormato1006`,
`generarFormato1007`, `generarFormato1008`, `generarFormato1009` — todos detrás de
`reporte.exportar`, todos con layout plano + Excel de cuatro hojas. El Formato 1001 es el único que
trae bloqueo operativo activo (hoja "Bloqueos") mientras A8 no construya el maestro de terceros. Los
formatos 1010, 1012, 2276, 2820/2833 quedan catalogados (A1) pero **no generables**: son trabajo nuevo
de captura de datos que esta ola no alcanzó.

---

## Corrección V-18 (cierra) — las advertencias de alcance ahora llegan al Excel

**El problema que dejó A14:** las advertencias de alcance (p. ej. "este producto no procesa
facturas de venta, así que el Formato 1003/1006 no tiene fuente automática completa") vivían en el
objeto `advertencias` que devuelve cada generador y en la cabecera del archivo plano, pero **no en
el Excel** — que es justamente lo que el contador abre y revisa antes de presentar. Un contador que
viera el 1003 o el 1006 con pocas filas o vacío no tenía forma de distinguir "no hubo esas
operaciones" de "el sistema no puede conocerlas estructuralmente".

### Qué se cambió

No se reimplementó el constructor de cuatro hojas de A9 (`construirLibroExcel`,
`src/reports/excel.ts`): se lo extendió con dos mecanismos, ambos opcionales y sin efecto si no se
usan (por eso ningún libro de A9/A10 —diario, mayor, balance, certificados, ESF, ERI, ECP, EFE,
notas— cambió de comportamiento):

1. **Bloque destacado en "Papel de trabajo"** (`LibroExcelSpec.advertencias?: string[]`, nuevo campo
   en `src/reports/tipos.ts`): si el spec trae advertencias, `construirHojaPapelDeTrabajo` las
   escribe en rojo y negrita (`ADVERTENCIAS DE ALCANCE — LÉALAS ANTES DE PRESENTAR ESTE REPORTE`)
   justo después del encabezado de empresa/NIT/período/responsable, antes de la tabla. Es la segunda
   hoja del libro — la que sigue inmediatamente después de "Datos" — así que aparece sin que nadie
   tenga que buscarla en una pestaña de más.
2. **Hoja "Advertencias" dedicada, marcada como pestaña activa al abrir el archivo**
   (`HojaAdicional.activarAlAbrir?: boolean`, también en `tipos.ts`): reutiliza tal cual la función
   genérica `construirHojaAdicional` que A10 ya dejó construida (ninguna línea nueva de renderizado
   de hoja); solo se agrega un `HojaAdicional` más a `hojasAdicionales`, exactamente por el mismo
   mecanismo con el que A11 ya agregaba la hoja "Bloqueos" del Formato 1001. Lo nuevo es que
   `construirLibroExcel` ahora, al terminar de armar todas las hojas, busca la PRIMERA hoja marcada
   `activarAlAbrir` y fija `workbook.views = [{ ..., activeTab: <ese índice> }]`. Esto **no reordena
   ninguna hoja** — las cuatro obligatorias siguen siendo siempre las cuatro primeras, en el mismo
   orden — solo decide qué pestaña queda seleccionada cuando Excel abre el archivo. Si el Formato
   1001 trae bloqueo de terceros Y advertencia general a la vez, gana "Bloqueos" (va primero en el
   arreglo): un dato real faltante es más urgente que una limitación de alcance del producto.

En `src/reports/exogena/formatos.ts` se agregó `hojaAdvertencias()` (construye el `HojaAdicional`
"Advertencias" con el texto completo, una fila por advertencia) y `hojasAdicionalesExogena()` (arma
`[Bloqueos si aplica, Advertencias si aplica]`), y los siete generadores ahora pasan `advertencias`
y `hojasAdicionales: hojasAdicionalesExogena(...)` en su `LibroExcelSpec`. Se aplicó a **los siete**,
no solo a 1003/1006, tal como se pidió: hoy 1005, 1007, 1008 y 1009 también tienen advertencias no
vacías (identificación de cuenta de IVA por nombre, dependencia de `niif_mapping`, dependencia de
`exogena_account_mapping`), y todas quedan igual de visibles.

### Verificación de que no se rompió la estructura obligatoria (sección 11.2)

- `tests/adversarial/compuerta-ola3-entregas.test.ts` (A14, no tocado) sigue verificando, sobre los
  VEINTE libros de la Ola 3 incluidos los siete de A11, que `wb.worksheets.slice(0, 4).map(w =>
  w.name)` sea exactamente `['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros']` — con
  round-trip real a `.xlsx` — y sigue en verde.
- Se agregaron pruebas propias de regresión: en `tests/reports/formato-excel.test.ts`
  (`describe('construirLibroExcel — advertencias de alcance (V-18)')`, 6 pruebas) se verifica contra
  `construirLibroExcel` en aislamiento: sin advertencias no aparece ningún bloque de más; con
  advertencias el bloque en "Papel de trabajo" existe con la fuente en rojo/negrita; las cuatro hojas
  obligatorias siguen siendo las cuatro primeras aunque haya `hojasAdicionales`; la hoja
  `activarAlAbrir` queda como `workbook.views[0].activeTab`; sin ninguna hoja marcada no se fuerza
  ninguna vista; y si dos hojas la piden, gana la primera en el orden declarado.
- En `tests/reports/exogena.test.ts` (`describe('V-18 — ...')`, 3 pruebas) se verifica contra los
  generadores reales, con base de datos PGlite: el Formato 1003 trae la hoja "Advertencias" con el
  texto exacto de alcance (`/no procesa facturas de VENTA/`), después de las cuatro obligatorias, y
  esa hoja queda activa al abrir; el Formato 1006 igual; y el Formato 1001, que además tiene bloqueo
  de terceros real en el fixture, deja "Bloqueos" como pestaña activa por encima de "Advertencias".

### Las tres compuertas de cierre (V-18)

- `npm test` → **880 pruebas en verde** (871 previas + 9 nuevas: 6 en
  `tests/reports/formato-excel.test.ts`, 3 en `tests/reports/exogena.test.ts`).
- `npm run typecheck` → limpio.
- `npx next build` → exit 0 (Next.js 16.3.3, Turbopack); no se tocó `app/`, así que las rutas
  existentes siguen igual.

### Formatos donde aplica

Los siete generadores de `src/reports/exogena/formatos.ts` (`generarFormato1001`,
`generarFormato1003`, `generarFormato1005`, `generarFormato1006`, `generarFormato1007`,
`generarFormato1008`, `generarFormato1009`) ahora hacen llegar su `advertencias` al Excel por los dos
canales descritos arriba. El mecanismo (`LibroExcelSpec.advertencias`, `HojaAdicional.activarAlAbrir`)
queda disponible en `src/reports/tipos.ts`/`src/reports/excel.ts` para cualquier libro futuro de A9 o
A10 que también necesite advertencias imposibles de pasar por alto — hoy los libros de A9/A10 no
pasan ese campo, así que su comportamiento no cambió.

# Ola 3 — A9: Reportes exportables (sección 11)

## Alcance de esta entrega

Construí los ocho reportes obligatorios de la sección 11.3, cada uno como un libro Excel con las
cuatro hojas obligatorias de la sección 11.2 (Datos, Papel de trabajo, Trazabilidad, Parámetros).
Trabajé solo (A10 y A11 esperaban mi balance de prueba y mis módulos de reportes para arrancar).

Archivos nuevos:

- `db/migrations/110_a9_vistas_reportes.sql` — una vista, `v_journal_line_reporte`
  (`security_invoker = true`, como todas las de `011_vistas.sql`): `journal_line` de asientos
  **publicados** con su cuenta y su asiento desnormalizados. Es la base de los ocho reportes; no
  escribe nada, no crea ninguna tabla nueva.
- `src/reports/tipos.ts` — la forma de la respuesta (encabezado, columna, fila de trazabilidad, fila
  de parámetro, especificación de libro). Ningún valor tributario, igual que `src/domain/tipos.ts`.
- `src/reports/formato.ts` — conversión de centavos a pesos y de tarifa (fracción) a porcentaje,
  **sin punto flotante** en la tarifa (desplaza el punto decimal en el texto, como
  `src/domain/dinero.ts` hace con `aTextoDecimal`).
- `src/reports/excel.ts` — el constructor genérico de las cuatro hojas, sobre `exceljs`.
- `src/reports/encabezado.ts` — arma el encabezado obligatorio (empresa, NIT, período, responsable,
  fecha de generación) desde `app.current_company_id()` / `app.current_user_id()`, nunca por
  parámetro de aplicación.
- `src/reports/parametros.ts` — la hoja "Parámetros": deduplica `tax_rule` desde lo que ya quedó
  denormalizado en `retention_applied` (D-017), más `rounding_rule` vigente.
- `src/reports/consulta.ts` — las consultas crudas de los ocho reportes.
- `src/reports/libros.ts` — los ocho generadores públicos (`generarLibroDiario`,
  `generarLibroMayor`, `generarLibroAuxiliar`, `generarBalanceDePrueba`,
  `generarCertificadoRetenciones`, `generarRelacionRetenciones`, `generarMovimientoTerceros`,
  `generarDetalleIva`), cada uno detrás de `exigirPermiso(REPORTE_EXPORTAR)`.
- `src/reports/index.ts` — barril.
- `tests/reports/formato-excel.test.ts` (16 pruebas, sin base de datos) — aritmética de formato y
  estructura de las cuatro hojas.
- `tests/reports/reportes.test.ts` (17 pruebas, PGlite real) — los ocho reportes, el balance de
  prueba contra la suma directa del ledger en los cinco niveles del PUC, aislamiento entre empresas,
  el permiso `reporte.exportar` exigido de verdad, y la trazabilidad/parámetros amarrados con
  `retention_applied`.

Cambio en un archivo existente:

- `tests/adversarial/casos-dorados.test.ts` — añadí `'reports'` al inventario cerrado de módulos de
  `src/` (la propia prueba dice "un módulo nuevo se declara aquí"; así lo hice, con la misma
  justificación que ya llevan `ai` e `integraciones`).

## Los ocho reportes, y qué hoja "Papel de trabajo" muestra en cada uno

| # | Reporte | Función | "Papel de trabajo" |
|---|---|---|---|
| 1 | Libro auxiliar por cuenta y por tercero | `generarLibroAuxiliar` | mismo detalle que "Datos", con saldo acumulado |
| 2 | Libro diario | `generarLibroDiario` | cronológico por fecha/asiento/línea |
| 3 | Libro mayor | `generarLibroMayor` | mismo detalle, ordenado por cuenta/fecha |
| 4 | Balance de prueba (cualquier nivel del PUC) | `generarBalanceDePrueba` | saldo inicial, movimientos y saldo final por grupo |
| 5 | Certificado de retenciones por tercero | `generarCertificadoRetenciones` | **resumen por tipo** (base, valor, N° operaciones) |
| 6 | Relación de retenciones por período y tipo | `generarRelacionRetenciones` | resumen por tipo, todos los terceros |
| 7 | Movimiento de terceros | `generarMovimientoTerceros` | resumen por tercero (débito/crédito/saldo) |
| 8 | Detalle de IVA generado y descontable | `generarDetalleIva` | IVA generado, descontable y neto |

Para 5-7 la hoja "Datos" sigue siendo el crudo por partida (una fila por `retention_applied` o por
`journal_line`, sin agrupar); el agregado vive **solo** en "Papel de trabajo"
(`LibroExcelSpec.resumenPapelDeTrabajo`), que es optativo y por defecto reutiliza "Datos".

## Cómo garanticé que el balance de prueba cuadra contra el ledger

`balanceDePrueba` (en `src/reports/consulta.ts`) agrega directamente sobre
`v_journal_line_reporte`, que a su vez es un passthrough de `journal_line` filtrado por
`estado = 'posted'` (sin ningún otro filtro): no hay una segunda fuente de verdad que pueda
divergir. `sumaDirectaLedger` hace la misma suma sin agrupar. La prueba
`tests/reports/reportes.test.ts` (`it.each` sobre los cinco niveles del PUC) suma
`debitosPeriodo`/`creditosPeriodo` de **todas** las filas del balance en cada nivel y verifica —con
`BigInt`, nunca `number`— que coincide al centavo con `sumaDirectaLedger`, y que
total débitos = total créditos (la doble partida se demuestra, no se asume). Añadí también una
prueba de saldo inicial: un asiento **antes** del rango del reporte aparece en `saldoInicial` y NO en
`debitosPeriodo`, y viceversa para uno dentro del rango.

No generé 10.000 asientos aleatorios: ese volumen es criterio de salida de A14 (sección 12), y mi
prueba usa un escenario acotado (dos asientos, dos fechas) porque lo que hay que probar es que la
**consulta agrega correctamente** contra la fuente directa — un volumen mayor no cambia la aritmética,
solo el tiempo de PGlite. El diseño (agregación directa sobre la vista, sin tabla intermedia,
`BigInt` de punta a punta) es exactamente lo que hace que escalar a 10.000 no pueda romper el cuadre:
no hay redondeo intermedio, no hay acumulador en `number`, y la vista no filtra nada que la tabla base
no filtre.

## Librería de Excel: `exceljs`

Instalé `exceljs@^4.4.0` (`npm install exceljs`). Es la opción establecida para generar `.xlsx` desde
Node/TypeScript: MIT, sin costo de licencia, sin binario nativo (no envuelve LibreOffice ni requiere
un motor externo, a diferencia de otras rutas que sí lo hacen), con tipos TypeScript propios (no hace
falta `@types/exceljs`). Pesa en el bundle del **servidor**: todo `src/reports/` lo invoca un route
handler de Next.js (App Router corre en servidor); ningún componente de cliente lo importa, así que no
infla ni un byte de lo que baja al navegador del contador. Es la única dependencia nueva que agregué.

## El detector de valores tributarios de A14, y por qué mi código no le da ningún falso positivo

Antes de escribir una sola máscara de Excel leí `tests/adversarial/valores-tributarios.test.ts`
completo, porque una máscara de moneda o de porcentaje puede parecerle una tarifa quemada a un
detector que busca `0.\d+` o `\d+%`. Decisiones que tomé por eso:

- La tarifa nunca se multiplica por 100 en punto flotante: `tarifaATextoPorcentaje` desplaza el punto
  decimal operando sobre el **texto** que trae la base (`"0.040000"` → `"4%"`), sin literal `0.04` en
  ningún lado del código fuente.
- La máscara de moneda de Excel es `'#,##0'` (sin punto, sin `%`): no hay celda con `numFmt` tipo
  `'0.00%'` en todo el módulo.
- Verificado con la suite adversarial completa en verde (`npm test`, ver más abajo): las seis reglas
  del detector, su canario envenenado y el barrido de `insert_normativo` pasan igual con
  `src/reports/` adentro.

## Cómo resolví el acceso al documento original ante un archivado futuro

No lo resolví activamente porque **ningún** reporte de la sección 11.3 necesita el XML crudo: los
ocho leen datos ya estructurados (`journal_line`, `journal_entry`, `retention_applied`,
`third_party`). Ni `src/reports/consulta.ts` ni ningún otro archivo de este módulo toca la columna
`source_document.xml_crudo`. Si un reporte futuro (notas a los estados financieros, por ejemplo)
necesitara el documento original, el accesor correcto ya existe y no lo dupliqué:
`leerXmlDocumento` de `src/ingest/persistencia.ts`, que tolera `xml_almacenamiento = 'archivo_frio'`
sin que el llamador tenga que saber dónde vive el archivo. Lo dejo consignado explícitamente en los
comentarios de cabecera de `src/reports/consulta.ts` para que A10/A11 no reintroduzcan un `SELECT
xml_crudo` directo por accidente.

## Las tres compuertas de cierre

- `npm test` → **645 pruebas en verde** (612 previas + 33 nuevas de `tests/reports/`).
- `npm run typecheck` → limpio.
- `npx next build` → compila sin errores (Next.js 16.3.3, Turbopack); las rutas existentes de A7/A8/A13
  siguen sirviéndose igual, no toqué `app/`.

## Decisiones de diseño que dejo explícitas para A10/A11

- **Cuentas de IVA sin código PUC quemado**: `detalleIva` identifica las cuentas de IVA por
  `account.nombre ILIKE '%iva%'` y clasifica generado/descontable por `account.naturaleza`
  (crédito/débito), no por un código de cuenta fijo. El producto no emite factura de venta (solo
  procesa compras), así que no hay un `concepto_causacion.cuenta_iva_generada_id` en el esquema; esta
  regla funciona igual si una firma cliente registra ventas por asiento manual en el mismo ledger.
- **`resumenPapelDeTrabajo`** (en `src/reports/tipos.ts`) es la vía general para que "Papel de
  trabajo" muestre un agregado distinto del crudo de "Datos", sin romper la regla de que "Datos" es
  siempre fila-por-registro. A10 (estados financieros) probablemente la necesite para sus propias
  hojas resumidas.
- El permiso exigido en los ocho generadores es `reporte.exportar` (ya existía en
  `src/auth/permisos.ts`, de A12): generar el `.xlsx` es la acción que ese permiso nombra
  literalmente. `reporte.leer` queda libre para una futura vista en pantalla que no produzca archivo.

## Reportes ya exportables (para `ESTADO_PROYECTO.md`, que consolida A0)

Los ocho de la sección 11.3, cada uno con sus cuatro hojas: libro auxiliar por cuenta y por tercero,
libro diario, libro mayor, balance de prueba a cualquier nivel del PUC, certificado de retenciones por
tercero, relación de retenciones practicadas por período y tipo, movimiento de terceros, y detalle de
IVA generado y descontable. Todos en `src/reports/libros.ts`.

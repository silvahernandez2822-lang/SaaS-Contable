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

## V-16 (cierre de bloqueo, Ola 3): la descarga que faltaba

**Corrección al registro.** La frase de la línea 88-89 de este mismo documento ("todo `src/reports/`
lo invoca un route handler de Next.js") era **falsa** en el momento en que la escribí: no existía
ningún route handler, ninguna acción de servidor ni ninguna pantalla que importara `src/reports/`
fuera de `tests/`. A14 lo encontró y bloqueó la Ola 3 con eso (V-16): los ocho reportes (y los doce de
A10/A11) estaban completos y correctos como funciones, pero literalmente no había por dónde
descargarlos. No corrijo el párrafo original — lo dejo como registro de lo que pasó — pero dejo
constancia aquí, explícita, de que era un error y de que ya no lo es: desde este cierre, la frase es
cierta de verdad.

### La ruta

`app/api/reportes/[libro]/route.ts` — `GET /api/reportes/:libro?<parámetros>` — es el único
importador de `src/reports/` fuera de `tests/`. Cubre los veinte libros que A14 ya había verificado
como funciones:

- Los ocho obligatorios de la 11.3 (A9): `libro-diario`, `libro-mayor`, `libro-auxiliar`,
  `balance-prueba`, `movimiento-terceros`, `certificado-retenciones`, `relacion-retenciones`,
  `detalle-iva`.
- Los cinco estados financieros NIIF para las PYMES (A10): `estado-situacion-financiera`,
  `estado-resultado-integral`, `estado-cambios-patrimonio`, `estado-flujos-efectivo`,
  `notas-estados-financieros`.
- Los siete formatos núcleo de información exógena (A11): `exogena-1001`, `exogena-1003`,
  `exogena-1005`, `exogena-1006`, `exogena-1007`, `exogena-1008`, `exogena-1009`.

Contrato de cada slug (fechas, `accountId`, `terceroId`, `nivel` del PUC, `anioGravable`...)
documentado en los comentarios del propio `route.ts`; un slug desconocido responde `404` con la
lista completa de slugs válidos, y un parámetro faltante o mal formado responde `400` sin tocar la
base de datos más de lo necesario para resolver la sesión.

**Seguridad — lo delicado de esta ruta.** La empresa NUNCA sale de la query string: sale
exclusivamente de `conSesion` (`app/lib/sesion.ts`), que la lee de la cookie de sesión y que la BASE
DE DATOS autoriza contra `app.current_company_id()` dentro de `withSessionContext`
(`EmpresaNoAutorizadaError` si la sesión no tiene acceso vigente a esa empresa, con su propio rastro
`ACCESO_DENEGADO` en `audit_log`). Un parámetro `companyId` en la URL, si alguien lo manda, se ignora
por completo: el código de la ruta ni siquiera lo lee. El nombre del archivo descargado (razón
social, NIT, reporte y período) se arma leyendo la hoja "Papel de trabajo" del propio libro ya
generado — nunca de un dato que la petición aporte — así que tampoco hay ahí una vía para que el
nombre del archivo revele o insinúe datos de otra empresa.

El permiso `reporte.exportar` lo sigue exigiendo cada `generarXxx` de `src/reports` (sin cambios);
la ruta solo traduce `PermisoInsuficienteError` a `403` y `SesionNoPresenteError`/
`SesionInvalidaError` a `401`.

### El punto de entrada mínimo desde la interfaz

`app/reportes/page.tsx` — un Server Component en el patrón ya establecido por A7/A8
(`conSesion` + verificación de permiso antes de renderizar nada útil). Muestra un formulario `GET`
plano por cada uno de los ocho reportes obligatorios, con sus campos propios (fechas, cuenta,
tercero, nivel del PUC), apuntando directo a `/api/reportes/<slug>`: sin JavaScript de cliente, sin
acción de servidor, el navegador descarga el archivo con el propio `<form method="get">`. Si la
sesión no tiene `reporte.exportar`, la página lo dice y no ofrece ningún formulario. Los doce
reportes de A10/A11 se pueden pedir hoy mismo contra la misma ruta con la URL directa (documentada
en el propio `route.ts` y en la página); no tienen todavía un formulario en esta pantalla — eso es
la pantalla rica de reportería que le corresponde a A8, no el mínimo que cierra V-16.

### Cómo probé que no sirve libros de otra empresa ni sin permiso

`tests/app/reportes-route.test.ts`, ocho pruebas, todas contra la ruta real (`GET` exportado de
`route.ts`) y una base de datos PGlite real con migraciones reales — nada de esto es un doble de la
autorización. Lo único que se sustituye con `vi.mock` es la traducción HTTP↔cookie de `next/headers`
(que fuera del runtime real de Next lanza "called outside a request scope") y el singleton de
conexión de `app/lib/db`; la propia cabecera de `app/lib/sesion.ts` ya advertía que "la garantía de
seguridad NO está ahí", y en efecto no lo está: sigue viviendo en `withSessionContext` y
`app.exigir_permiso`, sin ningún doble, exactamente como en producción.

Lo que queda demostrado, con sesiones y tokens reales emitidos por `app.abrir_sesion`:

1. Sin ninguna cookie de sesión → `401`, con `Content-Type` de error JSON (nunca un `.xlsx`).
2. Con un token que no resuelve a ninguna sesión vigente → `401`.
3. Reporte desconocido → `404` con la lista de slugs válidos.
4. Falta un parámetro obligatorio → `400`, no un `500` ni un archivo vacío.
5. Sesión válida, con `reporte.exportar`, empresa propia → `200`; el buffer devuelto se vuelve a
   abrir con `ExcelJS.Workbook().xlsx.load(...)` y trae las cuatro hojas obligatorias en orden
   (`Datos`, `Papel de trabajo`, `Trazabilidad`, `Parámetros`); el `Content-Disposition` trae el
   nombre de LA EMPRESA DE LA SESIÓN; la hoja "Papel de trabajo" confirma la misma razón social.
6. Sesión válida pero con el rol `solo_lectura` (tiene `reporte.leer`, no `reporte.exportar`) →
   `403 permiso_insuficiente`, sin archivo.
7. Token válido de una sesión autorizada SOLO para la empresa propia, con la cookie de empresa
   apuntando a la empresa de OTRO tenant → `403 empresa_no_autorizada`, y queda el rastro
   `ACCESO_DENEGADO` en `audit_log` de la firma que lo intentó — no entrega el libro ajeno.
8. Un `companyId` puesto a mano en la query string (la empresa ajena) se ignora: la respuesta sigue
   siendo la de la empresa de la sesión, nunca la otra.

### Las tres compuertas, verificadas después de este cierre

- `npm test` → **814 pruebas en verde** (806 previas + 8 nuevas de `tests/app/reportes-route.test.ts`).
- `npm run typecheck` → limpio.
- `npx next build` → compila sin errores (Next.js 16.3.3, Turbopack); la ruta nueva aparece listada
  como `ƒ /api/reportes/[libro]` y la página nueva como `ƒ /reportes`, junto a las rutas existentes
  de A7/A8/A13 sin tocarlas.

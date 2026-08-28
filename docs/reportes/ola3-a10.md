# Ola 3 — A10: Estados financieros, cierre de resultados y notas (secciones 2 y 11)

## Qué entregué

Los cuatro estados financieros bajo NIIF para las PYMES (Grupo 2), el cierre de las cuentas de
resultado por asiento nuevo, y la estructura de notas con las revelaciones mínimas del Grupo 2 —
con papel de trabajo en Excel para cada revelación que exige juicio profesional.

Todo se apoya en A9: el constructor genérico de las cuatro hojas obligatorias (`src/reports/excel.ts`)
y la vista `v_journal_line_reporte` (migración 110). No reimplementé nada suyo.

### Archivos nuevos

- `db/migrations/120_a10_estados_financieros.sql` — dos funciones `SECURITY INVOKER`, ninguna tabla,
  ningún dato:
  - `app.niif_de_cuenta(account_id, fecha)` — clasificación NIIF vigente de una cuenta, **heredada
    del ancestro del PUC por prefijo del código** cuando la cuenta no tiene mapeo propio. Devuelve
    **cero filas** si nadie la clasificó: eso no se tapa con un valor por defecto.
  - `app.ancestro_puc(account_id, nivel)` — código y **nombre** del ancestro en un nivel del PUC.
    Es lo que rotula los renglones de los estados sin que ningún código PUC quede escrito en
    TypeScript: el rótulo es un dato del catálogo.
- `src/reports/estados/tipos.ts` — formas de la respuesta. Ninguna cifra nace aquí.
- `src/reports/estados/consulta.ts` — las consultas (todas `SELECT` sobre `v_journal_line_reporte`).
- `src/reports/estados/armado.ts` — armado de los cuatro estados. Funciones puras, `BigInt` de punta
  a punta, **sin una sola división** (los estados suman y restan; no prorratean).
- `src/reports/estados/notas.ts` — el índice de notas. **No redacta ninguna revelación.**
- `src/reports/estados/libros.ts` — los cinco generadores de libro Excel.
- `src/reports/estados/index.ts` — barril, reexportado desde `src/reports/index.ts`.
- `src/services/cierre.ts` — cierre de las cuentas de resultado. Está en `services/` y no en
  `reports/` porque **escribe en el ledger**, y escribir es un caso de uso; `src/reports/` sigue
  siendo de solo lectura, como lo dejó A9.
- `tests/helpers/estados-a10.ts` — fixture del PUC jerárquico y su mapeo NIIF.
- `tests/reports/estados-financieros.test.ts` (23 pruebas, PGlite real).
- `tests/services/cierre.test.ts` (11 pruebas, PGlite real).
- `tests/reports/notas-y-armado.test.ts` (12 pruebas, sin base de datos).

### Cambios en archivos existentes (aditivos)

- `src/reports/tipos.ts` — tipo `HojaAdicional` y campo optativo `hojasAdicionales` en
  `LibroExcelSpec`.
- `src/reports/excel.ts` — `construirHojaAdicional`. Las cuatro hojas obligatorias se siguen creando
  siempre y **primero**; las adicionales van después. Hay una prueba que verifica el orden
  (`hojas.slice(0, 4)` debe ser exactamente las cuatro de la sección 11.2).
- `src/reports/index.ts`, `src/services/index.ts` — barriles.

---

## Los estados que quedan generables

| Estado | Función | Estado |
|---|---|---|
| Estado de Situación Financiera (sección 4) | `generarEstadoSituacionFinanciera` | Generable, con comparativo |
| Estado de Resultado Integral (sección 5) | `generarEstadoResultadoIntegral` | Generable, por función o por naturaleza |
| Estado de Cambios en el Patrimonio (sección 6) | `generarEstadoCambiosPatrimonio` | Generable; una columna la completa el contador |
| Estado de Flujos de Efectivo (sección 7) | `generarEstadoFlujosEfectivo` | Generable **una vez** se marquen las cuentas de efectivo |
| Notas a los estados financieros (sección 8) | `generarNotasEstadosFinancieros` | Índice + 2 notas automáticas + 4 papeles de trabajo |

Cada uno también tiene su función `calcular…` sin Excel, para la interfaz y para las pruebas.

---

## Las dos elecciones de presentación, justificadas

### ERI: **por función**, con el desglose por naturaleza siempre adjunto

El PUC del Decreto 2650 ya separa el costo de ventas (clase 6) de los gastos operacionales de
administración (grupo 51) y de los de ventas (grupo 52). **Esa segregación ES la clasificación por
función**, y sale del catálogo sin que nadie reclasifique nada. Presentar por naturaleza como opción
primaria obligaría a reagrupar contra el criterio del propio catálogo con el que trabaja el mercado
colombiano.

Y como la sección 5.11(b) exige que quien presenta por función revele **además** la naturaleza de los
gastos —incluidos depreciación, amortización y beneficios a los empleados—, el desglose por
naturaleza no es optativo en mi implementación: sale siempre, en su propia hoja y en la nota N7.

La elección es barata de revertir porque **función y naturaleza son el mismo dato agregado a distinto
nivel del PUC**: el grupo (2 dígitos) es la función, la cuenta (4 dígitos) es la naturaleza. Con
`presentacion: 'naturaleza'` se obtiene el otro corte, y hay una prueba que verifica que los dos dan
el mismo total y distinto número de renglones.

### EFE: **método directo**

El método indirecto parte del resultado y lo ajusta por partidas que no afectan el efectivo:
depreciación, deterioro, provisiones, impuesto diferido. **Este producto no genera esas partidas** —
causa facturas de compra; esos ajustes entran por asiento manual, si es que entran. Construir un
indirecto obligaría a **suponer** qué cuentas son no monetarias, es decir, a inventar.

El directo sale del ledger sin suponer nada, y es exacto por una identidad, no por una aproximación:

> En un asiento balanceado la suma de todas las partidas con signo es cero. Luego, en cualquier
> asiento que toque efectivo, **la suma de las partidas de NO efectivo es exactamente el negativo del
> movimiento de efectivo**. Clasificar cada contrapartida por su actividad y cambiarle el signo
> descompone el flujo de caja **al centavo, sin prorrateo y sin redondeo**.

Efecto colateral correcto y comprobado con prueba: un traslado entre dos cuentas de efectivo no
genera ninguna fila, porque no tiene contrapartidas fuera del efectivo — que es justo lo que pide la
sección 7.3.

---

## El cierre de resultados: asiento nuevo, jamás una edición

`cerrarCuentasDeResultado` (`src/services/cierre.ts`) recorre el ciclo completo que dejó A2:
`INSERT` en `draft` → partidas → `app.publicar_asiento`. No hay un solo `UPDATE` ni `DELETE` sobre
nada publicado.

Decisiones que vale la pena dejar por escrito:

- **La cuenta de contrapartida llega por parámetro.** No hay ningún código PUC escrito en el archivo.
  El mercado usa la cuenta de resultado del ejercicio del grupo 36, pero eso es una convención del
  catálogo, no una constante del programa.
- **Solo se cierran las cuentas que el mapeo NIIF clasifica como `ingreso`, `costo` o `gasto`.** No se
  usa la clase del PUC como atajo. Si una cuenta con movimiento no tiene mapeo, el cierre **no la
  toca** y la devuelve en `cuentasSinClasificar`. Cerrar contra el supuesto «la clase 5 siempre es
  gasto» sería inventar la clasificación que `niif_mapping` existe para no inventar.
- **`otro_resultado_integral` no se cierra**: el ORI no pasa por el resultado del ejercicio.
- **Idempotente** por `idempotency_key = cierre:<desde>:<hasta>`. Cerrar diez veces deja un asiento.
- **El asiento de cierre tiene documento fuente**: `journal_entry.source_document_id` es NOT NULL, así
  que se crea un **acta de cierre** (`tipo_documento = 'Otro'`, `origen = 'carga_manual'`), una sola
  vez por ejercicio, garantizado por `source_document_hash_uq` en la base, no por un `if`.
- **Aprobación real**: una fila de `approval` con `entidad = 'cierre_periodo'`, `decision = 'aprobado'`,
  usuario e IP. Sin ella, LG006 rechazaría la publicación.

El ERI **excluye siempre los asientos de cierre**. Si no lo hiciera, el estado de resultados de un
ejercicio ya cerrado saldría en ceros, porque el cierre precisamente cancela esas cuentas. El ESF, en
cambio, **nunca los excluye**: el cierre es el hecho que traslada el resultado al patrimonio y el
balance tiene que verlo. Las dos cosas están probadas con el mismo escenario, antes y después.

---

## Lo más importante: qué NO automaticé, y cómo entrego su papel de trabajo

Una revelación inventada es el mismo fallo que una tarifa inventada, solo que más abajo en la cadena.
`src/reports/estados/notas.ts` declara el índice de notas, qué exige la norma y **qué falta**, pero no
escribe una sola línea de revelación. Hay una prueba que lo defiende como compuerta: el objeto de una
nota no tiene ningún campo de contenido redactado.

| Nota | Referencia | Origen | Papel de trabajo en Excel |
|---|---|---|---|
| N1 Entidad que reporta | 3.24 | Mixta | Encabezado automático; domicilio, forma jurídica y actividad los pone el contador |
| N2 Bases de preparación y declaración de cumplimiento | 3.3 / 8.5(a) | **Manual** | Índice, con la exigencia literal. La declaración de cumplimiento es una afirmación del preparador: el sistema no la puede emitir en su nombre |
| N3 Políticas contables significativas | 8.5(b) | **Manual** | Hoja **`PT politicas contables`**: una fila por sección NIIF en juego, con columnas en blanco para la política y la base de medición |
| N4 Juicios contables significativos | 8.6 | **Manual** | Hoja **`PT juicios y estimaciones`**, filas vacías a propósito |
| N5 Fuentes de incertidumbre en las estimaciones | 8.7 | **Manual** | Misma hoja, con columnas de partida afectada, importe en libros y efecto |
| N6 Desagregación del ESF | 4.11 / 8.2(b) | **Automática** | Hoja `N6 desagregacion ESF`, cuenta por cuenta |
| N7 Desagregación de ingresos, costos y gastos | 5.11 | **Automática** | Hoja `N7 desagregacion ERI`, con el desglose por naturaleza |
| N8 Efectivo y equivalentes | 7.2, 7.20-7.21 | Mixta | Hoja **`PT efectivo y equivalentes`** en el libro del EFE |
| N9 Movimientos del patrimonio | 6.3 | Mixta | Hoja **`PT clasificacion movimientos`** en el libro del ECP |
| N10 Partes relacionadas | Sección 33 | Mixta | Hoja **`PT partes relacionadas`** |
| N11 Hechos posteriores | Sección 32 | **Manual** | Hoja **`PT hechos posteriores`** |
| N12 Provisiones y contingencias | 21.14-21.17 | Mixta | Misma hoja |
| N13 Compromisos y garantías | 8.2(c) | **Manual** | Misma hoja |

### Los tres puntos donde me negué a automatizar, con nombre propio

1. **Qué es un equivalente de efectivo (7.2) es una política contable, no un código de cuenta.** Dos
   empresas con el mismo PUC pueden clasificar distinto el mismo fiduciario a la vista. El EFE lee
   `niif_mapping.rubro_efe = 'efectivo_y_equivalentes'`. Si nadie ha marcado nada, **el estado sale
   vacío y con el papel de trabajo dentro** —la lista de todas las cuentas de activo corriente con
   saldo, para elegir, con los cuatro criterios de la sección 7.2 al pie— en vez de salir con una
   cifra supuesta. Hay una prueba de esto exactamente.

2. **La actividad de cada flujo (7.3), cuando no está declarada, se PRESUME y se marca.** La
   presunción es: activo no corriente → inversión; pasivo no corriente y patrimonio → financiación;
   el resto → operación. Es razonable pero no es la norma: una obligación financiera a corto plazo es
   pasivo corriente y su flujo es de **financiación**. Por eso cada partida presumida sale listada en
   la hoja `PT actividades presumidas` para que un humano la confirme, en vez de quedar enterrada
   dentro de un total. `partidasPresumidas` cuenta cuántas son.

3. **La naturaleza de un movimiento de patrimonio (6.3) no está en el asiento.** El ledger dice cuánto
   se movió, cuándo y contra qué cuenta; no dice si un cargo a resultados acumulados es la corrección
   de un error de ejercicios anteriores o una distribución de utilidades. La columna
   `naturalezaDelCambio` sale **en blanco**, con la lista cerrada de opciones de la sección 6.3 al pie
   de la hoja. Hay una prueba que verifica que sale vacía.

### Y una cuarta, transversal: la cuenta sin clasificar

Una cuenta con saldo y sin mapeo NIIF **no se omite jamás**. Sale en su propia sección del estado
(«Partidas sin clasificación NIIF»), con su saldo, su alerta y su hoja `Sin clasificacion NIIF`. Una
cuenta omitida descuadraría el estado sin dejar rastro; una cuenta listada aparte se ve.

El cuadre del ESF lo verifica el propio libro en la hoja `Cuadre`:
Activo − Pasivo − Patrimonio − Resultado no cerrado − Sin clasificar = 0. Y cuadra **porque el ledger
impone la doble partida en la base de datos**, no porque el informe se cuadre a sí mismo.

---

## Qué NO pude construir por el alcance del PUC cargado

A1 cargó un **PUC operativo**: 9 clases, 30 grupos y 63 cuentas, no las 2.470 del Decreto 2650. Y
`niif_mapping` (seed `020_niif_mapping.sql`) mapea unas 70 cuentas de nivel 3, **todas con
`requiere_verificacion_humana = true`**. Consecuencias concretas, sin rellenar nada:

1. **Las columnas `rubro_esf`, `rubro_eri` y `rubro_efe` de `niif_mapping` están vacías en el seed
   completo.** No las poblé y **no podía**: `niif_mapping` es paramétrica y el trigger
   `trg_vigencia_sin_solape` (PR002) rechaza una segunda vigencia global que se cruce con la de A1,
   que va desde 2016-01-01 sin cierre. Rellenarlas exigiría o editar el seed de A1 (no es mío) o
   abrir una vigencia nueva desde hoy, lo que dejaría sin rótulo todos los ejercicios anteriores.
   **Solución adoptada:** el rótulo de presentación es `COALESCE(rubro_*, nombre del grupo PUC)`. El
   nombre viene del catálogo (`account.nombre`), no de una tabla escrita en TypeScript. Cuando el
   contador llene `rubro_*` desde parametrización, manda el suyo.

2. **El EFE no es generable «de fábrica»** por lo mismo: `rubro_efe` está vacío, luego ninguna cuenta
   está marcada como efectivo. Es una configuración de una sola vez por empresa, y entrego el papel de
   trabajo para hacerla. Prefiero eso a marcar el grupo 11 por mi cuenta: sería quemar un código PUC
   y, peor, tomar una decisión de política contable en nombre del contador.

3. **Renglones del ESF que el catálogo cargado no puede desagregar.** El PUC operativo llega al nivel
   de cuenta (4 dígitos) para unos pocos grupos. No hay cuentas cargadas para inventarios en detalle
   (14), intangibles (16 solo tiene 1605/1610/1698), diferidos (17 solo 1705), ni valorizaciones.
   Cualquier empresa que use esas cuentas las creará ella misma y **heredarán la clasificación del
   ancestro** por `app.niif_de_cuenta` — eso funciona. Lo que no puedo prometer es que el catálogo
   global traiga hoy el rótulo NIIF fino de cada una.

4. **El desglose de gastos por naturaleza de la sección 5.11(b) queda incompleto en un punto
   concreto:** depreciación, amortización y beneficios a los empleados salen como renglón propio
   **solo si la empresa los tiene en cuentas separadas**. Con el catálogo cargado, el grupo 51 no
   trae todas sus cuentas de nivel 3. Lo declaro al pie de la hoja `Gastos por naturaleza` en vez de
   inventar un renglón: «si su catálogo no los separa, esos renglones deben completarse a mano».

5. **No construí cuentas de orden (clases 8 y 9) en el detalle.** Se excluyen del ESF a propósito —no
   son activo, pasivo ni patrimonio, se revelan en notas—, y el catálogo cargado no tiene cuentas de
   orden con las que probar nada real. La nota N13 pide su saldo, si la empresa las lleva.

6. **No construí el estado de resultados con «resultado por acción» ni segmentos.** No aplican al
   Grupo 2 (son de Plenas) y no los inventé.

---

## Detalles de diseño que otro agente debería conocer

- **La herencia de clasificación es por prefijo del código, no por `parent_id`.** En el PUC el código
  ES la jerarquía (sección 7.8), y `parent_id` puede venir sin poblar: el propio fixture de A2 lo deja
  nulo en tres de sus cinco cuentas. Un auxiliar `51359501` hereda de `513595`, que hereda de `5135`,
  que hereda de `51`, que hereda de `5`. Prioridad: mapeo de la cuenta misma > ancestro más
  específico > alcance de empresa > alcance de firma > global > vigencia más reciente que cubra la
  fecha.
- **Las dos funciones nuevas son `SECURITY INVOKER`**, declarado de forma explícita. Leen `account` y
  `niif_mapping`, que llevan RLS híbrida: una `SECURITY DEFINER` aquí sería una puerta trasera al
  aislamiento entre firmas a cambio de nada. No engrosan el inventario de `SECURITY DEFINER` que
  audita A14.
- **La pertenencia a «efectivo y equivalentes» se resuelve a la fecha de corte**, no a la de cada
  asiento, para que la conciliación cuadre al centavo aunque la clasificación haya cambiado a mitad
  del período. Está documentado en `cuentasDeEfectivo`.
- **La hoja «Parámetros» de un estado financiero es el mapeo NIIF usado**, con su vigencia y su norma
  de respaldo. Sin eso, dentro de seis meses nadie sabría bajo qué clasificación se armó ese balance —
  y `niif_mapping` es paramétrico, pudo cambiar.
- **La hoja «Trazabilidad» reutiliza `FilaTrazabilidad` de A9** con la equivalencia: donde el reporte
  tributario pone la regla y su vigencia, el estado financiero pone el mapeo NIIF y su vigencia. El
  campo `taxRuleId` lleva el código de la cuenta de origen del mapeo.
- **`hojasAdicionales` no relaja la sección 11.2.** Las cuatro obligatorias se crean siempre y en el
  mismo orden fijo; las adicionales van después. Probado con `hojas.slice(0, 4)`.

---

## Las tres compuertas

- `npm test` → **691 pruebas en verde**, 38 archivos (645 previas + 46 mías: 23 de estados
  financieros contra PGlite, 11 de cierre contra PGlite, 12 sin base de datos).
- `npm run typecheck` → limpio.
- `npx next build` → compila sin errores (Next.js 16.3.3, Turbopack). No toqué `app/`.

El detector de valores tributarios de A14 (`valores-tributarios.test.ts`, 42 pruebas) pasa con mis
archivos dentro: no hay una sola tarifa, base ni código PUC quemado en `src/`. Las máscaras de moneda
que uso son las de A9, ya auditadas. Los códigos PUC que aparecen en las pruebas son fixtures, y el
barrido no alcanza `tests/` por diseño.

/**
 * A10 — Los cuatro estados financieros y las notas, ensamblados como libros
 * Excel sobre el constructor de A9 (`src/reports/excel.ts`): las cuatro hojas
 * obligatorias de la sección 11.2 más las hojas adicionales que un juego de
 * estados financieros necesita.
 *
 * Cada generador exige `reporte.exportar`, igual que los ocho libros de A9: la
 * comprobación real la impone la base (`app.exigir_permiso`); esto falla antes
 * y con un mensaje legible.
 *
 * ELECCIONES DE PRESENTACIÓN, JUSTIFICADAS (no implícitas):
 *
 * · ERI POR FUNCIÓN (sección 5.11(b)), con el desglose por naturaleza siempre
 *   adjunto. El PUC del Decreto 2650 ya separa el costo de ventas (clase 6) de
 *   los gastos de administración (grupo 51) y de los de ventas (grupo 52): esa
 *   segregación ES la clasificación por función, y sale del catálogo sin que
 *   nadie tenga que reclasificar nada. Presentar por naturaleza obligaría a
 *   reagrupar contra el criterio del propio catálogo. Y como quien presenta por
 *   función DEBE revelar además la naturaleza de los gastos, el desglose por
 *   naturaleza (cuenta del PUC: gastos de personal, honorarios, depreciaciones)
 *   se genera siempre, no como opción. Quien prefiera presentar por naturaleza
 *   lo tiene con `presentacion: 'naturaleza'`: es el mismo dato agregado un
 *   nivel más abajo del PUC.
 *
 * · EFE POR MÉTODO DIRECTO (sección 7.7). El método indirecto parte del
 *   resultado y lo ajusta por partidas que no afectan el efectivo —
 *   depreciación, deterioro, provisiones, impuesto diferido — que este producto
 *   no genera: causa facturas de compra, y esos ajustes entran por asiento
 *   manual, si es que entran. Construir un indirecto obligaría a SUPONER qué
 *   cuentas son no monetarias, es decir, a inventar. El directo, en cambio, sale
 *   del ledger sin suponer nada: cada asiento que toca efectivo trae sus
 *   contrapartidas, y en un asiento balanceado la suma de las contrapartidas es
 *   exactamente el movimiento de caja. Se descompone al centavo, sin prorrateo
 *   y sin redondeo.
 */
import type ExcelJS from 'exceljs';
import type { SqlClient } from '../../db/types';
import { exigirPermiso, PERMISOS } from '../../auth/permisos';
import { construirLibroExcel } from '../excel';
import { obtenerEncabezado } from '../encabezado';
import type {
  ColumnaDatos,
  FilaParametro,
  FilaTrazabilidad,
  HojaAdicional,
  LibroExcelSpec,
} from '../tipos';
import {
  armarEstadoCambiosPatrimonio,
  armarEstadoFlujosEfectivo,
  armarEstadoResultadoIntegral,
  armarEstadoSituacionFinanciera,
} from './armado';
import {
  asientosDePatrimonio,
  cuentasDeEfectivo,
  mapeosNiifUsados,
  partidasDeFlujo,
  saldoDeEfectivo,
  saldosPorCuenta,
  saldosPorCuentaConNaturaleza,
  type RangoEstados,
} from './consulta';
import { ESTRUCTURA_NOTAS, seccionesEnJuego } from './notas';
import type {
  EstadoCambiosPatrimonio,
  EstadoFlujosEfectivo,
  EstadoResultadoIntegral,
  EstadoSituacionFinanciera,
  PresentacionEri,
  SaldoCuenta,
} from './tipos';

// =============================================================================
// Columnas compartidas
// =============================================================================

const COLUMNAS_SALDO: ColumnaDatos[] = [
  { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
  { header: 'Nombre de la cuenta', key: 'cuentaNombre', width: 34 },
  { header: 'Naturaleza', key: 'cuentaNaturaleza', width: 11 },
  { header: 'Clasificación NIIF', key: 'clasificacionNiif', width: 20 },
  { header: 'Sección NIIF', key: 'seccionNiif', width: 26 },
  { header: 'Rubro de presentación', key: 'rubro', width: 32 },
  { header: 'Grupo PUC', key: 'grupoCodigo', width: 10 },
  { header: 'Nombre del grupo PUC', key: 'grupoNombre', width: 32 },
  { header: 'Resolución del mapeo', key: 'resolucionNiif', width: 18 },
  { header: 'Mapeo heredado de', key: 'origenCodigo', width: 16 },
  { header: 'Saldo inicial', key: 'saldoInicial', width: 16, tipo: 'moneda' },
  { header: 'Débitos', key: 'debitos', width: 16, tipo: 'moneda' },
  { header: 'Créditos', key: 'creditos', width: 16, tipo: 'moneda' },
  { header: 'Saldo (deudor +)', key: 'saldoFinal', width: 16, tipo: 'moneda' },
];

const COLUMNAS_RENGLON: ColumnaDatos[] = [
  { header: 'Sección', key: 'seccion', width: 30 },
  { header: 'Rubro', key: 'rubro', width: 44 },
  { header: 'Valor', key: 'valor', width: 18, tipo: 'moneda' },
  { header: 'Comparativo', key: 'valorComparativo', width: 18, tipo: 'moneda' },
  { header: 'Alerta', key: 'advertencia', width: 60 },
];

/**
 * Trazabilidad de un estado financiero: qué mapeo NIIF, de qué vigencia y con
 * qué norma de respaldo clasificó cada cuenta con saldo, y si la clasificación
 * se resolvió sobre la cuenta misma o se heredó de un ancestro del PUC. Es el
 * equivalente, para los estados, de lo que la hoja de A9 hace con las reglas
 * tributarias: sin ella, dentro de seis meses nadie sabe bajo qué mapeo se
 * armó este balance (Regla de Oro 6).
 */
function trazabilidadDelMapeo(cuentas: readonly SaldoCuenta[]): FilaTrazabilidad[] {
  return cuentas.map((c) => ({
    referencia: `${c.cuentaCodigo} — ${c.cuentaNombre}`,
    tipo: 'Clasificación NIIF de la cuenta',
    taxRuleId: c.origenCodigo,
    tarifaTexto: null,
    vigenteDesde: c.vigenteDesde,
    vigenteHasta: c.vigenteHasta,
    normaRespaldo: c.normaRespaldo ?? 'Sin mapeo NIIF vigente para esta cuenta.',
    baseTexto: null,
    valorTexto: c.saldoFinal,
    aplicada: c.clasificacionNiif !== null,
    motivoNoAplica:
      c.clasificacionNiif === null
        ? 'Ninguna cuenta de su rama del PUC tiene mapeo NIIF vigente en la fecha de corte.'
        : null,
    nota:
      c.clasificacionNiif === null
        ? null
        : `${c.clasificacionNiif} (resolución ${c.resolucionNiif}${
            c.resolucionNiif === 'heredada' ? ` desde ${c.origenCodigo ?? ''}` : ''
          })${c.requiereVerificacionHumana ? ' — mapeo pendiente de verificación humana' : ''}`,
  }));
}

async function parametrosDelMapeo(tx: SqlClient, fechaCorte: string): Promise<FilaParametro[]> {
  const mapeos = await mapeosNiifUsados(tx, fechaCorte);
  return mapeos.map((m) => ({
    parametro: `Mapeo NIIF ${m.origenCodigo}${m.origenNombre ? ` — ${m.origenNombre}` : ''}`,
    valor: m.clasificacionNiif,
    vigenteDesde: m.vigenteDesde,
    vigenteHasta: m.vigenteHasta,
    normaRespaldo: m.normaRespaldo,
    notas: `${m.cuentasAfectadas} cuenta(s) clasificada(s)${
      m.requiereVerificacionHumana ? ' — PENDIENTE DE VERIFICACIÓN HUMANA' : ''
    }`,
  }));
}

/** Hoja con las cuentas que nadie clasificó. Siempre se emite, aunque esté vacía. */
function hojaSinClasificar(cuentas: readonly SaldoCuenta[]): HojaAdicional {
  return {
    nombre: 'Sin clasificacion NIIF',
    encabezadoTexto:
      cuentas.length === 0
        ? ['Ninguna cuenta con saldo quedó sin clasificación NIIF en este corte.']
        : [
            'CUENTAS CON SALDO Y SIN CLASIFICACIÓN NIIF',
            'Estas cuentas NO se pueden presentar en ningún rubro del estado hasta que se clasifiquen.',
            'Se listan aparte, con su saldo, en vez de omitirlas: una cuenta omitida descuadraría el estado sin dejar rastro.',
            'Se corrige creando la vigencia correspondiente en el mapeo NIIF (niif_mapping) desde el módulo de parametrización.',
          ],
    columnas: [
      { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
      { header: 'Nombre', key: 'cuentaNombre', width: 36 },
      { header: 'Grupo PUC', key: 'grupoCodigo', width: 10 },
      { header: 'Saldo (deudor +)', key: 'saldoFinal', width: 18, tipo: 'moneda' },
    ],
    filas: cuentas,
  };
}

// =============================================================================
// 1. Estado de Situación Financiera (sección 4)
// =============================================================================

export interface OpcionesEsf {
  fechaCorte: string;
  /** Corte del período anterior. La información comparativa es obligatoria (3.14). */
  fechaCorteComparativa?: string | null;
}

export async function calcularEstadoSituacionFinanciera(
  tx: SqlClient,
  opciones: OpcionesEsf,
): Promise<EstadoSituacionFinanciera> {
  const saldos = await saldosPorCuenta(tx, {
    desde: opciones.fechaCorte,
    hasta: opciones.fechaCorte,
    excluirCierre: false,
  });
  const comparativos = opciones.fechaCorteComparativa
    ? await saldosPorCuenta(tx, {
        desde: opciones.fechaCorteComparativa,
        hasta: opciones.fechaCorteComparativa,
        excluirCierre: false,
      })
    : null;
  return armarEstadoSituacionFinanciera(saldos, {
    fechaCorte: opciones.fechaCorte,
    comparativos,
    fechaCorteComparativa: opciones.fechaCorteComparativa ?? null,
  });
}

export async function generarEstadoSituacionFinanciera(
  tx: SqlClient,
  opciones: OpcionesEsf,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const estado = await calcularEstadoSituacionFinanciera(tx, opciones);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Estado de Situación Financiera (NIIF para las PYMES, Grupo 2)',
    periodo: opciones.fechaCorteComparativa
      ? `Corte ${opciones.fechaCorte} (comparativo ${opciones.fechaCorteComparativa})`
      : `Corte ${opciones.fechaCorte}`,
  });

  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_SALDO,
    filasDatos: estado.detalle,
    resumenPapelDeTrabajo: { columnas: COLUMNAS_RENGLON, filas: estado.renglones },
    trazabilidad: trazabilidadDelMapeo(estado.detalle),
    parametros: await parametrosDelMapeo(tx, opciones.fechaCorte),
    hojasAdicionales: [
      {
        nombre: 'Cuadre',
        encabezadoTexto: [
          'PRUEBA DE CUADRE DEL ESTADO DE SITUACIÓN FINANCIERA',
          'Activo − Pasivo − Patrimonio − Resultado no cerrado − Partidas sin clasificar debe ser CERO.',
          'No cuadra por construcción del informe: cuadra porque el ledger impone la doble partida en la base de datos.',
        ],
        columnas: [
          { header: 'Concepto', key: 'concepto', width: 52 },
          { header: 'Valor', key: 'valor', width: 20, tipo: 'moneda' },
        ],
        filas: [
          { concepto: 'Total activo', valor: estado.totalActivo },
          { concepto: 'Total pasivo', valor: estado.totalPasivo },
          { concepto: 'Total patrimonio (según libros)', valor: estado.totalPatrimonio },
          {
            concepto: 'Resultado del ejercicio pendiente de cierre',
            valor: estado.resultadoNoCerrado,
          },
          { concepto: 'Partidas sin clasificación NIIF', valor: estado.totalSinClasificar },
          { concepto: 'DESCUADRE (debe ser cero)', valor: estado.descuadre },
        ],
        pie:
          estado.descuadre === '0'
            ? ['El estado cuadra al centavo.']
            : [
                'ATENCIÓN: el estado NO cuadra. Revise si hay cuentas de orden que no se compensan entre sí.',
              ],
      },
      hojaSinClasificar(estado.cuentasSinClasificar),
    ],
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 2. Estado de Resultado Integral (sección 5)
// =============================================================================

export interface OpcionesEri extends RangoEstados {
  presentacion?: PresentacionEri;
  comparativo?: RangoEstados | null;
}

export async function calcularEstadoResultadoIntegral(
  tx: SqlClient,
  opciones: OpcionesEri,
): Promise<EstadoResultadoIntegral> {
  // El ERI SIEMPRE excluye los asientos de cierre: el cierre cancela las
  // cuentas de resultado, y si se contara el estado del ejercicio ya cerrado
  // saldría en ceros.
  const saldos = await saldosPorCuenta(tx, { ...opciones, excluirCierre: true });
  const naturaleza = await saldosPorCuentaConNaturaleza(tx, { ...opciones, excluirCierre: true });
  const comparativos = opciones.comparativo
    ? await saldosPorCuenta(tx, { ...opciones.comparativo, excluirCierre: true })
    : null;
  return armarEstadoResultadoIntegral(saldos, naturaleza, {
    desde: opciones.desde,
    hasta: opciones.hasta,
    presentacion: opciones.presentacion ?? 'funcion',
    comparativos,
  });
}

export async function generarEstadoResultadoIntegral(
  tx: SqlClient,
  opciones: OpcionesEri,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const estado = await calcularEstadoResultadoIntegral(tx, opciones);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: `Estado de Resultado Integral — presentación por ${
      estado.presentacion === 'funcion' ? 'función' : 'naturaleza'
    } (NIIF para las PYMES, Grupo 2)`,
    periodo: `${opciones.desde} a ${opciones.hasta}`,
  });

  const hojas: HojaAdicional[] = [
    {
      nombre: 'Gastos por naturaleza',
      encabezadoTexto: [
        'DESGLOSE DE COSTOS Y GASTOS POR NATURALEZA',
        'Sección 5.11(b): quien presenta el resultado por función revela además la naturaleza de los gastos,',
        'incluidos depreciación, amortización y beneficios a los empleados. Por eso este desglose no es optativo.',
        'El rótulo de cada renglón es el nombre de la cuenta del PUC, tomado del catálogo.',
      ],
      columnas: [
        { header: 'Cuenta PUC', key: 'codigoOrden', width: 12 },
        { header: 'Naturaleza del gasto', key: 'rubro', width: 44 },
        { header: 'Valor', key: 'valor', width: 18, tipo: 'moneda' },
      ],
      filas: estado.desgloseNaturaleza,
      pie: [
        'Si su catálogo no separa depreciación, amortización o beneficios a los empleados en cuentas propias,',
        'esos renglones deben completarse a mano: el sistema no los puede deducir de una cuenta que los agrupa.',
      ],
    },
    {
      nombre: 'Resultado',
      encabezadoTexto: ['RESUMEN DEL RESULTADO DEL PERÍODO'],
      columnas: [
        { header: 'Concepto', key: 'concepto', width: 46 },
        { header: 'Valor', key: 'valor', width: 20, tipo: 'moneda' },
      ],
      filas: [
        { concepto: 'Ingresos', valor: estado.totalIngresos },
        { concepto: 'Costos', valor: estado.totalCostos },
        { concepto: 'Gastos', valor: estado.totalGastos },
        { concepto: 'Resultado del período', valor: estado.resultadoDelPeriodo },
        { concepto: 'Otro resultado integral', valor: estado.otroResultadoIntegral },
        { concepto: 'Resultado integral total', valor: estado.resultadoIntegralTotal },
      ],
    },
    hojaSinClasificar(estado.cuentasSinClasificar),
  ];

  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_SALDO,
    filasDatos: estado.detalle,
    resumenPapelDeTrabajo: { columnas: COLUMNAS_RENGLON, filas: estado.renglones },
    trazabilidad: trazabilidadDelMapeo(estado.detalle),
    parametros: await parametrosDelMapeo(tx, opciones.hasta),
    hojasAdicionales: hojas,
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 3. Estado de Cambios en el Patrimonio (sección 6)
// =============================================================================

export async function calcularEstadoCambiosPatrimonio(
  tx: SqlClient,
  rango: RangoEstados,
): Promise<EstadoCambiosPatrimonio> {
  const saldos = await saldosPorCuenta(tx, { ...rango, excluirCierre: false });
  const asientos = await asientosDePatrimonio(tx, rango);
  const eri = await calcularEstadoResultadoIntegral(tx, { ...rango, presentacion: 'funcion' });
  return armarEstadoCambiosPatrimonio(saldos, asientos, {
    desde: rango.desde,
    hasta: rango.hasta,
    resultadoDelPeriodo: eri.resultadoIntegralTotal,
  });
}

export async function generarEstadoCambiosPatrimonio(
  tx: SqlClient,
  rango: RangoEstados,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const estado = await calcularEstadoCambiosPatrimonio(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Estado de Cambios en el Patrimonio (NIIF para las PYMES, Grupo 2)',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });

  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: [
      { header: 'Componente (grupo PUC)', key: 'componenteCodigo', width: 14 },
      { header: 'Nombre del componente', key: 'componenteNombre', width: 32 },
      { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
      { header: 'Nombre de la cuenta', key: 'cuentaNombre', width: 34 },
      { header: 'Saldo inicial', key: 'saldoInicial', width: 18, tipo: 'moneda' },
      { header: 'Aumentos (créditos)', key: 'aumentos', width: 18, tipo: 'moneda' },
      { header: 'Disminuciones (débitos)', key: 'disminuciones', width: 18, tipo: 'moneda' },
      { header: 'Saldo final', key: 'saldoFinal', width: 18, tipo: 'moneda' },
      { header: 'Naturaleza del cambio (la completa el contador)', key: 'naturalezaDelCambio', width: 48 },
    ],
    filasDatos: estado.movimientos,
    trazabilidad: [],
    trazabilidadNota:
      'El Estado de Cambios en el Patrimonio no aplica ninguna regla tributaria: concilia saldos del ledger. La trazabilidad del mapeo NIIF de cada cuenta está en el Estado de Situación Financiera.',
    parametros: await parametrosDelMapeo(tx, rango.hasta),
    hojasAdicionales: [
      {
        nombre: 'Conciliacion',
        encabezadoTexto: ['CONCILIACIÓN DEL PATRIMONIO (saldos con signo acreedor positivo)'],
        columnas: [
          { header: 'Concepto', key: 'concepto', width: 52 },
          { header: 'Valor', key: 'valor', width: 20, tipo: 'moneda' },
        ],
        filas: [
          { concepto: 'Patrimonio al inicio del período', valor: estado.saldoInicialTotal },
          {
            concepto: 'Resultado integral total del período (del Estado de Resultado Integral)',
            valor: estado.resultadoDelPeriodo,
          },
          { concepto: 'Patrimonio al final del período (según libros)', valor: estado.saldoFinalTotal },
        ],
        pie: [
          'El resultado integral del período aparece dentro del patrimonio final SOLO si el asiento de cierre',
          'ya se publicó. Si no, sigue en las cuentas de resultado y el Estado de Situación Financiera lo',
          'muestra en el renglón "Resultado del ejercicio (pendiente de cierre contra patrimonio)".',
        ],
      },
      PAPEL_TRABAJO_CAMBIOS_PATRIMONIO(estado),
    ],
  };
  return construirLibroExcel(spec);
}

/**
 * PAPEL DE TRABAJO — clasificación de los movimientos de patrimonio.
 *
 * La sección 6.3 exige separar, dentro de la conciliación de cada componente,
 * el resultado integral total, los cambios por política contable, la
 * corrección de errores, los aportes de los propietarios y las distribuciones.
 * El ledger dice cuánto se movió, cuándo y contra qué cuenta. NO dice si un
 * cargo a resultados acumulados es una corrección de un error de ejercicios
 * anteriores o una distribución de utilidades: eso lo sabe quien hizo el
 * asiento. Por eso la columna sale en blanco, con lista de opciones al pie.
 */
function PAPEL_TRABAJO_CAMBIOS_PATRIMONIO(estado: EstadoCambiosPatrimonio): HojaAdicional {
  return {
    nombre: 'PT clasificacion movimientos',
    encabezadoTexto: [
      'PAPEL DE TRABAJO — CLASIFICACIÓN DE LOS MOVIMIENTOS DE PATRIMONIO (sección 6.3)',
      'Una fila por partida que tocó patrimonio en el período. Complete la última columna.',
      'El sistema no la deduce: el asiento dice cuánto y contra qué cuenta, no dice por qué.',
    ],
    columnas: [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'N° asiento', key: 'asientoNumero', width: 12 },
      { header: 'Tipo', key: 'asientoTipo', width: 12 },
      { header: 'Descripción del asiento', key: 'descripcion', width: 44 },
      { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
      { header: 'Nombre de la cuenta', key: 'cuentaNombre', width: 32 },
      { header: 'Débito/Crédito', key: 'side', width: 14 },
      { header: 'Monto', key: 'monto', width: 18, tipo: 'moneda' },
      { header: 'CLASIFIQUE AQUÍ', key: 'clasificacion', width: 40 },
    ],
    filas: estado.asientosDePatrimonio.map((a) => ({ ...a, clasificacion: '' })),
    pie: [
      'Valores admitidos en la última columna (sección 6.3):',
      '  · Resultado integral total del período',
      '  · Cambio en política contable aplicado retroactivamente',
      '  · Corrección de un error de períodos anteriores',
      '  · Inversión de los propietarios (aportes de capital)',
      '  · Distribución a los propietarios (dividendos o participaciones)',
      '  · Otro (descríbalo)',
    ],
  };
}

// =============================================================================
// 4. Estado de Flujos de Efectivo, método directo (sección 7)
// =============================================================================

export async function calcularEstadoFlujosEfectivo(
  tx: SqlClient,
  rango: RangoEstados,
): Promise<EstadoFlujosEfectivo> {
  const cuentas = await cuentasDeEfectivo(tx, rango.hasta);
  const partidas = cuentas.length === 0 ? [] : await partidasDeFlujo(tx, rango);
  const saldos = await saldosPorCuenta(tx, { ...rango, excluirCierre: false });
  const efectivoInicial =
    cuentas.length === 0
      ? '0'
      : await saldoDeEfectivo(tx, { fecha: diaAnterior(rango.desde), fechaClasificacion: rango.hasta });
  const efectivoFinal =
    cuentas.length === 0
      ? '0'
      : await saldoDeEfectivo(tx, { fecha: rango.hasta, fechaClasificacion: rango.hasta });

  return armarEstadoFlujosEfectivo(partidas, {
    desde: rango.desde,
    hasta: rango.hasta,
    cuentasEfectivo: cuentas,
    // Candidatas: todo activo corriente con saldo. Es la lista de la que el
    // contador elige; NO una propuesta de clasificación.
    candidatasEfectivo: saldos.filter((s) => s.clasificacionNiif === 'activo_corriente'),
    efectivoInicial,
    efectivoFinal,
  });
}

/** Día anterior a una fecha ISO, sin dependencias y sin zona horaria. */
export function diaAnterior(fechaIso: string): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}

export async function generarEstadoFlujosEfectivo(
  tx: SqlClient,
  rango: RangoEstados,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const estado = await calcularEstadoFlujosEfectivo(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Estado de Flujos de Efectivo — método directo (NIIF para las PYMES, Grupo 2)',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });

  const hojas: HojaAdicional[] = [
    {
      nombre: 'Conciliacion efectivo',
      encabezadoTexto: [
        'CONCILIACIÓN DEL EFECTIVO Y EQUIVALENTES',
        'Efectivo inicial + flujo neto − efectivo final debe ser CERO.',
        'Es exacto por construcción del ledger: en un asiento balanceado la suma de las contrapartidas',
        'de una línea de efectivo es exactamente el movimiento de caja, así que no hay prorrateo ni redondeo.',
      ],
      columnas: [
        { header: 'Concepto', key: 'concepto', width: 52 },
        { header: 'Valor', key: 'valor', width: 20, tipo: 'moneda' },
      ],
      filas: [
        { concepto: 'Efectivo y equivalentes al inicio', valor: estado.efectivoInicial },
        { concepto: 'Flujo neto de actividades de operación', valor: estado.flujoOperacion },
        { concepto: 'Flujo neto de actividades de inversión', valor: estado.flujoInversion },
        { concepto: 'Flujo neto de actividades de financiación', valor: estado.flujoFinanciacion },
        { concepto: 'Flujo neto del período', valor: estado.flujoNeto },
        { concepto: 'Efectivo y equivalentes al final', valor: estado.efectivoFinal },
        { concepto: 'DESCUADRE (debe ser cero)', valor: estado.descuadre },
      ],
    },
    PAPEL_TRABAJO_EFECTIVO(estado),
    PAPEL_TRABAJO_ACTIVIDADES(estado),
  ];

  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'N° asiento', key: 'asientoNumero', width: 12 },
      { header: 'Cuenta contrapartida', key: 'cuentaCodigo', width: 14 },
      { header: 'Nombre de la cuenta', key: 'cuentaNombre', width: 34 },
      { header: 'Rubro', key: 'rubro', width: 32 },
      { header: 'Actividad', key: 'actividad', width: 16 },
      { header: 'Origen de la actividad', key: 'actividadOrigen', width: 20 },
      { header: 'Flujo (entrada +)', key: 'flujo', width: 18, tipo: 'moneda' },
      { header: 'Tercero', key: 'terceroRazonSocial', width: 32 },
    ],
    filasDatos: estado.partidas,
    resumenPapelDeTrabajo: { columnas: COLUMNAS_RENGLON, filas: estado.renglones },
    trazabilidad: [],
    trazabilidadNota:
      'El Estado de Flujos de Efectivo no aplica ninguna regla tributaria. Su trazabilidad propia —qué cuentas son efectivo y con qué criterio se asignó cada actividad— está en las dos hojas de papel de trabajo de este mismo libro.',
    parametros: await parametrosDelMapeo(tx, rango.hasta),
    hojasAdicionales: hojas,
  };
  return construirLibroExcel(spec);
}

/**
 * PAPEL DE TRABAJO — determinación del efectivo y equivalentes de efectivo.
 *
 * Qué es un equivalente de efectivo es una POLÍTICA CONTABLE de la entidad
 * (sección 7.2: inversión de alta liquidez, a corto plazo, convertible en un
 * importe determinado de efectivo y sujeta a un riesgo insignificante de
 * cambio de valor, mantenida para cumplir compromisos de corto plazo). No se
 * deduce del código de la cuenta: dos empresas con el mismo PUC pueden
 * clasificar distinto el mismo fiduciario a la vista. Por eso el sistema
 * PREGUNTA en vez de suponer, y mientras nadie responda el estado sale vacío
 * con este papel de trabajo dentro, en lugar de salir con una cifra inventada.
 */
function PAPEL_TRABAJO_EFECTIVO(estado: EstadoFlujosEfectivo): HojaAdicional {
  return {
    nombre: 'PT efectivo y equivalentes',
    encabezadoTexto: estado.sinCuentasDeEfectivoMarcadas
      ? [
          'PAPEL DE TRABAJO — DETERMINACIÓN DEL EFECTIVO Y EQUIVALENTES (sección 7.2)',
          'NINGUNA CUENTA ESTÁ MARCADA TODAVÍA, así que el estado de flujos sale vacío. No es un fallo: es',
          'que la decisión no se ha tomado. Marque abajo las cuentas que son efectivo y equivalentes y',
          'declárelo en el mapeo NIIF (niif_mapping.rubro_efe = efectivo_y_equivalentes) desde parametrización.',
          'Se listan todas las cuentas de activo corriente con saldo: la lista de la que se elige, no una propuesta.',
        ]
      : [
          'PAPEL DE TRABAJO — DETERMINACIÓN DEL EFECTIVO Y EQUIVALENTES (sección 7.2)',
          'Cuentas actualmente marcadas como efectivo y equivalentes, y el resto del activo corriente para contraste.',
          'Revise que la lista siga siendo correcta antes de emitir el estado.',
        ],
    columnas: [
      { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
      { header: 'Nombre', key: 'cuentaNombre', width: 36 },
      { header: 'Clasificación NIIF', key: 'clasificacionNiif', width: 20 },
      { header: 'Saldo al corte', key: 'saldoFinal', width: 18, tipo: 'moneda' },
      { header: '¿ES EFECTIVO O EQUIVALENTE? (Sí/No)', key: 'esEfectivo', width: 34 },
      { header: 'JUSTIFICACIÓN', key: 'justificacion', width: 48 },
    ],
    filas: estado.candidatasEfectivo.map((c) => ({
      ...c,
      esEfectivo: estado.cuentasEfectivo.some((e) => e.accountId === c.accountId) ? 'Sí' : '',
      justificacion: '',
    })),
    pie: [
      'Criterios de la sección 7.2 para un equivalente de efectivo:',
      '  · Inversión a corto plazo de gran liquidez.',
      '  · Fácilmente convertible en un importe determinado de efectivo.',
      '  · Sujeta a un riesgo insignificante de cambios en su valor.',
      '  · Mantenida para cumplir compromisos de pago a corto plazo, no para inversión.',
      'Revele además (7.21) el importe de los saldos de efectivo que NO estén disponibles para su uso.',
    ],
  };
}

/**
 * PAPEL DE TRABAJO — confirmación de la actividad de cada flujo.
 *
 * Cuando el mapeo NIIF no declara `rubro_efe`, el sistema PRESUME la actividad
 * a partir de la clasificación NIIF de la contrapartida, y marca la fila. La
 * presunción es razonable pero no es la norma: un préstamo a corto plazo es
 * pasivo corriente y su flujo es de financiación, no de operación. Por eso
 * cada partida presumida sale listada aquí para que un humano la confirme, en
 * lugar de quedar enterrada dentro de un total.
 */
function PAPEL_TRABAJO_ACTIVIDADES(estado: EstadoFlujosEfectivo): HojaAdicional {
  const presumidas = estado.partidas.filter((p) => p.actividadOrigen !== 'declarada');
  return {
    nombre: 'PT actividades presumidas',
    encabezadoTexto:
      presumidas.length === 0
        ? ['Todas las partidas del estado tienen su actividad DECLARADA en el mapeo NIIF. Nada que confirmar.']
        : [
            'PAPEL DE TRABAJO — CONFIRMACIÓN DE LA ACTIVIDAD DE CADA FLUJO (sección 7.3)',
            `${presumidas.length} partida(s) tienen la actividad asignada por PRESUNCIÓN, no declarada.`,
            'La presunción usada: activo no corriente → inversión; pasivo no corriente y patrimonio → financiación; el resto → operación.',
            'Confírmela o corríjala declarando rubro_efe en el mapeo NIIF. Ejemplo típico a corregir:',
            'una obligación financiera a corto plazo es pasivo corriente, pero su flujo es de FINANCIACIÓN.',
          ],
    columnas: [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'N° asiento', key: 'asientoNumero', width: 12 },
      { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
      { header: 'Nombre de la cuenta', key: 'cuentaNombre', width: 34 },
      { header: 'Actividad presumida', key: 'actividad', width: 20 },
      { header: 'Origen', key: 'actividadOrigen', width: 16 },
      { header: 'Flujo (entrada +)', key: 'flujo', width: 18, tipo: 'moneda' },
      { header: 'ACTIVIDAD CONFIRMADA', key: 'confirmada', width: 28 },
    ],
    filas: presumidas.map((p) => ({ ...p, confirmada: '' })),
  };
}

// =============================================================================
// 5. Notas a los estados financieros (sección 8)
// =============================================================================

export interface OpcionesNotas extends RangoEstados {
  presentacion?: PresentacionEri;
}

/**
 * El libro de notas. Trae el índice completo con las revelaciones mínimas del
 * Grupo 2, las desagregaciones que sí salen del ledger, y una hoja de papel de
 * trabajo por cada nota que exige juicio profesional, con la celda en blanco.
 *
 * Ninguna nota sale redactada. Ver el encabezado de `notas.ts`.
 */
export async function generarNotasEstadosFinancieros(
  tx: SqlClient,
  opciones: OpcionesNotas,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);

  const esf = await calcularEstadoSituacionFinanciera(tx, { fechaCorte: opciones.hasta });
  const eri = await calcularEstadoResultadoIntegral(tx, {
    ...opciones,
    presentacion: opciones.presentacion ?? 'funcion',
  });
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Notas a los estados financieros (NIIF para las PYMES, Grupo 2)',
    periodo: `${opciones.desde} a ${opciones.hasta}`,
  });

  const secciones = seccionesEnJuego(esf.detalle);

  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: [
      { header: 'Nota', key: 'codigo', width: 8 },
      { header: 'Título', key: 'titulo', width: 52 },
      { header: 'Referencia normativa', key: 'referencia', width: 46 },
      { header: 'Origen', key: 'origen', width: 14 },
      { header: 'Qué exige la norma', key: 'exigencia', width: 80 },
      { header: 'Qué aporta el sistema', key: 'aportaElSistema', width: 80 },
      { header: 'Qué debe completar el contador', key: 'completaElContador', width: 80 },
      { header: 'REDACCIÓN DE LA NOTA', key: 'redaccion', width: 100 },
      { header: 'Estado', key: 'estado', width: 18 },
    ],
    filasDatos: ESTRUCTURA_NOTAS.map((n) => ({
      ...n,
      redaccion: '',
      estado: n.origen === 'automatica' ? 'Generada — revisar' : 'PENDIENTE — la escribe el contador',
    })),
    resumenPapelDeTrabajo: {
      columnas: [
        { header: 'Nota', key: 'codigo', width: 8 },
        { header: 'Título', key: 'titulo', width: 52 },
        { header: 'Referencia', key: 'referencia', width: 46 },
        { header: 'Origen', key: 'origen', width: 14 },
        { header: 'Estado', key: 'estado', width: 36 },
      ],
      filas: ESTRUCTURA_NOTAS.map((n) => ({
        codigo: n.codigo,
        titulo: n.titulo,
        referencia: n.referencia,
        origen: n.origen,
        estado:
          n.origen === 'automatica'
            ? 'Generada desde el ledger — revisar'
            : 'PENDIENTE — la escribe el contador',
      })),
    },
    trazabilidad: [],
    trazabilidadNota:
      'Las notas no aplican reglas tributarias. La trazabilidad del mapeo NIIF que sustenta las desagregaciones está en el libro del Estado de Situación Financiera.',
    parametros: await parametrosDelMapeo(tx, opciones.hasta),
    hojasAdicionales: [
      {
        nombre: 'N6 desagregacion ESF',
        encabezadoTexto: [
          'NOTA N6 — DESAGREGACIÓN DE LAS PARTIDAS DEL ESTADO DE SITUACIÓN FINANCIERA (4.11 y 8.2(b))',
          'Generada desde el ledger. Revise las filas marcadas como pendientes de verificación humana.',
        ],
        columnas: COLUMNAS_SALDO,
        filas: esf.detalle,
      },
      {
        nombre: 'N7 desagregacion ERI',
        encabezadoTexto: [
          'NOTA N7 — DESAGREGACIÓN DE INGRESOS, COSTOS Y GASTOS (sección 5.11)',
          `Presentación del estado: por ${eri.presentacion === 'funcion' ? 'función' : 'naturaleza'}.`,
          'Debajo, el mismo período desglosado por NATURALEZA, que la norma exige cuando se presenta por función.',
        ],
        columnas: [
          { header: 'Cuenta PUC', key: 'codigoOrden', width: 12 },
          { header: 'Naturaleza del gasto', key: 'rubro', width: 44 },
          { header: 'Valor', key: 'valor', width: 18, tipo: 'moneda' },
        ],
        filas: eri.desgloseNaturaleza,
      },
      {
        nombre: 'PT politicas contables',
        encabezadoTexto: [
          'PAPEL DE TRABAJO — NOTA N3, POLÍTICAS CONTABLES SIGNIFICATIVAS (8.5(b))',
          'El sistema no redacta ninguna política: una política contable es una elección de la entidad entre',
          'alternativas que la norma admite, no un dato del ledger. Lo que sí puede hacer, y hace, es decirle',
          'QUÉ políticas tiene que redactar, a partir de las secciones NIIF que sus propias cuentas ponen en juego.',
          secciones.length === 0
            ? 'AVISO: el mapeo NIIF de esta empresa no tiene poblada la columna seccion_niif, así que esta lista sale vacía. Se deja vacía en vez de suponer secciones: complete seccion_niif en el mapeo o redacte las políticas desde su propio análisis.'
            : `Secciones NIIF en juego según las cuentas con saldo: ${secciones.length}.`,
        ],
        columnas: [
          { header: 'Sección NIIF en juego', key: 'seccion', width: 46 },
          { header: 'POLÍTICA CONTABLE ADOPTADA', key: 'politica', width: 100 },
          { header: 'BASE DE MEDICIÓN', key: 'medicion', width: 44 },
        ],
        filas: secciones.map((s) => ({ seccion: s, politica: '', medicion: '' })),
      },
      {
        nombre: 'PT juicios y estimaciones',
        encabezadoTexto: [
          'PAPEL DE TRABAJO — NOTAS N4 Y N5, JUICIOS (8.6) Y FUENTES DE INCERTIDUMBRE (8.7)',
          'Las dos revelaciones que un sistema contable no puede producir, por definición:',
          '  · 8.6 pide los juicios de la GERENCIA al aplicar las políticas contables.',
          '  · 8.7 pide los supuestos con riesgo significativo de causar un ajuste material el próximo año.',
          'Ninguno de los dos está en un asiento. Escriba una fila por juicio y una por fuente de incertidumbre.',
        ],
        columnas: [
          { header: 'Tipo (juicio 8.6 / estimación 8.7)', key: 'tipo', width: 32 },
          { header: 'DESCRIPCIÓN', key: 'descripcion', width: 80 },
          { header: 'PARTIDA AFECTADA (cuenta o rubro)', key: 'partida', width: 40 },
          { header: 'IMPORTE EN LIBROS', key: 'importe', width: 22 },
          { header: 'EFECTO SI EL SUPUESTO CAMBIA', key: 'efecto', width: 60 },
        ],
        filas: [
          { tipo: 'Juicio (8.6)', descripcion: '', partida: '', importe: '', efecto: '' },
          { tipo: 'Juicio (8.6)', descripcion: '', partida: '', importe: '', efecto: '' },
          { tipo: 'Estimación (8.7)', descripcion: '', partida: '', importe: '', efecto: '' },
          { tipo: 'Estimación (8.7)', descripcion: '', partida: '', importe: '', efecto: '' },
        ],
        pie: [
          'Se entregan cuatro filas de ejemplo VACÍAS a propósito. No hay texto sugerido: un juicio profesional',
          'sugerido por el software es un juicio que nadie hizo, firmado por alguien que no lo pensó.',
        ],
      },
      {
        nombre: 'PT partes relacionadas',
        encabezadoTexto: [
          'PAPEL DE TRABAJO — NOTA N10, PARTES RELACIONADAS (sección 33)',
          'El sistema conoce los terceros por su NIT y sus movimientos, pero no conoce los vínculos societarios',
          'ni familiares que hacen a un tercero parte relacionada. Identifíquelos aquí; el movimiento y el saldo',
          'de cada uno los toma del reporte "Movimiento de terceros".',
        ],
        columnas: [
          { header: 'TERCERO (NIT o nombre)', key: 'tercero', width: 40 },
          { header: 'CATEGORÍA DE PARTE RELACIONADA', key: 'categoria', width: 40 },
          { header: 'NATURALEZA DE LA TRANSACCIÓN', key: 'naturaleza', width: 46 },
          { header: 'IMPORTE DE LAS TRANSACCIONES', key: 'importe', width: 28 },
          { header: 'SALDO PENDIENTE Y CONDICIONES', key: 'saldo', width: 46 },
        ],
        filas: [
          { tercero: '', categoria: '', naturaleza: '', importe: '', saldo: '' },
          { tercero: '', categoria: '', naturaleza: '', importe: '', saldo: '' },
        ],
        pie: [
          'Categorías de la sección 33.9: controladora; entidades con control conjunto o influencia significativa;',
          'subsidiarias; asociadas; negocios conjuntos; personal clave de la gerencia; otras partes relacionadas.',
          'Revele además la remuneración del personal clave de la gerencia en total (33.7).',
        ],
      },
      {
        nombre: 'PT hechos posteriores',
        encabezadoTexto: [
          'PAPEL DE TRABAJO — NOTAS N11, N12 Y N13 (secciones 32, 21 y 8.2(c))',
          'Hechos posteriores al cierre, contingencias, compromisos y garantías. Nada de esto está en el ledger',
          'del período: un hecho posterior que no implica ajuste es, por definición, un hecho que no se registró.',
        ],
        columnas: [
          { header: 'Tipo', key: 'tipo', width: 36 },
          { header: 'DESCRIPCIÓN', key: 'descripcion', width: 80 },
          { header: '¿IMPLICA AJUSTE? (Sí/No)', key: 'ajuste', width: 26 },
          { header: 'EFECTO FINANCIERO ESTIMADO', key: 'efecto', width: 40 },
        ],
        filas: [
          { tipo: 'Hecho posterior (sección 32)', descripcion: '', ajuste: '', efecto: '' },
          { tipo: 'Pasivo contingente (21.15)', descripcion: '', ajuste: 'No', efecto: '' },
          { tipo: 'Activo contingente (21.16)', descripcion: '', ajuste: 'No', efecto: '' },
          { tipo: 'Compromiso o garantía (8.2(c))', descripcion: '', ajuste: '', efecto: '' },
        ],
        pie: [
          'Revele también la fecha de autorización de los estados financieros para su emisión y quién la concedió (32.9).',
        ],
      },
    ],
  };
  return construirLibroExcel(spec);
}

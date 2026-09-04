/**
 * A9 — Los ocho reportes obligatorios de la sección 11.3, ensamblados como
 * libros Excel de cuatro hojas (sección 11.2).
 *
 * Cada función exige `reporte.exportar` (el permiso ya existe desde A12,
 * `src/auth/permisos.ts`): generar el .xlsx es exactamente la acción que ese
 * permiso nombra. La comprobación real la impone la base de datos
 * (`app.exigir_permiso`); esto solo falla temprano con un mensaje claro,
 * igual que el resto de `src/services`.
 */
import type ExcelJS from 'exceljs';
import type { SqlClient } from '../db/types';
import { exigirPermiso, PERMISOS } from '../auth/permisos';
import { construirLibroExcel, libroABuffer } from './excel';
import { obtenerEncabezado } from './encabezado';
import { parametrosDesdeRetenciones, parametrosDeRedondeoVigente } from './parametros';
import type { ColumnaDatos, FilaTrazabilidad, LibroExcelSpec } from './tipos';
import {
  balanceDePrueba,
  detalleIva,
  icaPorMunicipio,
  libroAuxiliar,
  libroDiario,
  libroMayor,
  movimientoTercerosDetalle,
  movimientoTercerosResumen,
  retencionesPorPeriodo,
  retencionesPorTercero,
  type FilaMovimiento,
  type FilaRetencionAplicada,
  type NivelPuc,
  type RangoFechas,
} from './consulta';

export { libroABuffer };

// =============================================================================
// Columnas compartidas
// =============================================================================

const COLUMNAS_MOVIMIENTO: ColumnaDatos[] = [
  { header: 'Fecha', key: 'fecha', width: 12 },
  { header: 'N° asiento', key: 'asientoNumero', width: 10 },
  { header: 'Tipo asiento', key: 'asientoTipo', width: 12 },
  { header: 'Cuenta', key: 'cuentaCodigo', width: 12 },
  { header: 'Nombre cuenta', key: 'cuentaNombre', width: 30 },
  { header: 'Naturaleza', key: 'cuentaNaturaleza', width: 10 },
  { header: 'Línea', key: 'linea', width: 8 },
  { header: 'Débito/Crédito', key: 'side', width: 12 },
  { header: 'Monto', key: 'monto', width: 16, tipo: 'moneda' },
  { header: 'Tercero (documento)', key: 'terceroDocumento', width: 16 },
  { header: 'Tercero (razón social)', key: 'terceroRazonSocial', width: 28 },
  { header: 'Centro de costo', key: 'costCenterCodigo', width: 14 },
  { header: 'Descripción', key: 'descripcion', width: 34 },
  { header: 'Documento fuente', key: 'sourceDocumentId', width: 20 },
];

function trazabilidadDeMovimientos(_filas: readonly FilaMovimiento[]): FilaTrazabilidad[] {
  // Los libros contables puros (diario, mayor, auxiliar, movimiento de
  // terceros) registran el HECHO contable ya calculado; la regla y la
  // vigencia que produjeron cada retención viven en `retention_applied` y se
  // exponen en el certificado y la relación de retenciones (abajo), que son
  // los reportes "con cálculo tributario" de la sección 11.2.
  return [];
}

const NOTA_SIN_TRAZA_LEDGER =
  'Este es un libro contable (no un cálculo tributario): la regla y la vigencia de cada retención se consultan en el certificado de retenciones o en la relación de retenciones por período.';

// =============================================================================
// 1. Libro diario
// =============================================================================

export async function generarLibroDiario(tx: SqlClient, rango: RangoFechas): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const filas = await libroDiario(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Libro diario',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_MOVIMIENTO,
    filasDatos: filas,
    trazabilidad: trazabilidadDeMovimientos(filas),
    trazabilidadNota: NOTA_SIN_TRAZA_LEDGER,
    parametros: [],
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 2. Libro mayor
// =============================================================================

export async function generarLibroMayor(tx: SqlClient, rango: RangoFechas): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const filas = await libroMayor(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Libro mayor',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_MOVIMIENTO,
    filasDatos: filas,
    trazabilidad: trazabilidadDeMovimientos(filas),
    trazabilidadNota: NOTA_SIN_TRAZA_LEDGER,
    parametros: [],
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 3. Libro auxiliar por cuenta y por tercero
// =============================================================================

export interface FiltroLibroAuxiliar extends RangoFechas {
  accountId: string;
  terceroId?: string | null;
}

const COLUMNAS_AUXILIAR: ColumnaDatos[] = [
  ...COLUMNAS_MOVIMIENTO,
  { header: 'Saldo acumulado', key: 'saldoAcumulado', width: 16, tipo: 'moneda' },
];

export async function generarLibroAuxiliar(
  tx: SqlClient,
  filtro: FiltroLibroAuxiliar,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const filas = await libroAuxiliar(tx, filtro);
  const cuenta = filas[0];
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: `Libro auxiliar${cuenta ? ` — ${cuenta.cuentaCodigo} ${cuenta.cuentaNombre}` : ''}`,
    periodo: `${filtro.desde} a ${filtro.hasta}`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_AUXILIAR,
    filasDatos: filas,
    trazabilidad: trazabilidadDeMovimientos(filas),
    trazabilidadNota: NOTA_SIN_TRAZA_LEDGER,
    parametros: [],
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 4. Balance de prueba a cualquier nivel del PUC
// =============================================================================

const COLUMNAS_BALANCE: ColumnaDatos[] = [
  { header: 'Código', key: 'codigoGrupo', width: 12 },
  { header: 'Nombre', key: 'nombreGrupo', width: 30 },
  { header: 'Saldo inicial', key: 'saldoInicial', width: 16, tipo: 'moneda' },
  { header: 'Débitos del período', key: 'debitosPeriodo', width: 18, tipo: 'moneda' },
  { header: 'Créditos del período', key: 'creditosPeriodo', width: 18, tipo: 'moneda' },
  { header: 'Saldo final', key: 'saldoFinal', width: 16, tipo: 'moneda' },
];

export async function generarBalanceDePrueba(
  tx: SqlClient,
  opciones: RangoFechas & { nivel: NivelPuc },
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const filas = await balanceDePrueba(tx, opciones);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: `Balance de prueba — nivel PUC ${opciones.nivel}`,
    periodo: `${opciones.desde} a ${opciones.hasta}`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_BALANCE,
    filasDatos: filas,
    trazabilidad: [],
    trazabilidadNota:
      'El balance de prueba agrega saldos contables ya asentados; no evalúa ninguna regla tributaria por sí mismo.',
    parametros: [],
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 5. Movimiento de terceros
// =============================================================================

export async function generarMovimientoTerceros(
  tx: SqlClient,
  opciones: RangoFechas & { terceroId?: string | null },
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const detalle = await movimientoTercerosDetalle(tx, opciones);
  const resumen = await movimientoTercerosResumen(tx, opciones);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Movimiento de terceros',
    periodo: `${opciones.desde} a ${opciones.hasta}`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_MOVIMIENTO,
    filasDatos: detalle,
    resumenPapelDeTrabajo: {
      columnas: [
        { header: 'Documento', key: 'numeroDocumento', width: 16 },
        { header: 'Razón social', key: 'razonSocial', width: 30 },
        { header: 'Total débito', key: 'totalDebito', width: 16, tipo: 'moneda' },
        { header: 'Total crédito', key: 'totalCredito', width: 16, tipo: 'moneda' },
        { header: 'Saldo', key: 'saldo', width: 16, tipo: 'moneda' },
        { header: 'Movimientos', key: 'movimientos', width: 12 },
      ],
      filas: resumen,
    },
    trazabilidad: trazabilidadDeMovimientos(detalle),
    trazabilidadNota: NOTA_SIN_TRAZA_LEDGER,
    parametros: [],
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 6. Certificado de retenciones por tercero / 7. Relación por período y tipo
// =============================================================================

const COLUMNAS_RETENCION: ColumnaDatos[] = [
  { header: 'Fecha del hecho económico', key: 'fechaHechoEconomico', width: 14 },
  { header: 'Tercero (documento)', key: 'terceroDocumento', width: 16 },
  { header: 'Tercero (razón social)', key: 'terceroRazonSocial', width: 28 },
  { header: 'Tipo', key: 'tipo', width: 16 },
  { header: 'Concepto', key: 'conceptoNombre', width: 24 },
  { header: 'Municipio (ReteICA)', key: 'municipioNombre', width: 18 },
  { header: 'Base', key: 'base', width: 16, tipo: 'moneda' },
  { header: 'Tarifa', key: 'tarifa', width: 10, tipo: 'porcentaje' },
  { header: 'Valor', key: 'valor', width: 16, tipo: 'moneda' },
  { header: 'Aplicada', key: 'aplicada', width: 10 },
  { header: 'Motivo si no aplica', key: 'motivoNoAplica', width: 30 },
  { header: 'Documento fuente', key: 'sourceDocumentId', width: 20 },
];

function trazabilidadDeRetenciones(retenciones: readonly FilaRetencionAplicada[]): FilaTrazabilidad[] {
  return retenciones.map((r) => ({
    referencia: `${r.tipo} · ${r.terceroRazonSocial ?? r.terceroId ?? 'sin tercero'} · ${r.fechaHechoEconomico}`,
    tipo: r.tipo,
    taxRuleId: r.taxRuleId,
    tarifaTexto: r.tarifa,
    vigenteDesde: r.vigenteDesde,
    vigenteHasta: r.vigenteHasta,
    normaRespaldo: r.normaRespaldo,
    baseTexto: r.base,
    valorTexto: r.valor,
    aplicada: r.aplicada,
    motivoNoAplica: r.motivoNoAplica,
    nota: r.municipioNombre ? `Municipio: ${r.municipioNombre}` : null,
  }));
}

/** Suma por tipo, para la tabla de resumen de "Papel de trabajo". */
function resumenPorTipo(retenciones: readonly FilaRetencionAplicada[]): Array<Record<string, unknown>> {
  const acumulado = new Map<string, { tipo: string; base: bigint; valor: bigint; conteo: number }>();
  for (const r of retenciones) {
    if (!r.aplicada) continue;
    const previo = acumulado.get(r.tipo) ?? { tipo: r.tipo, base: 0n, valor: 0n, conteo: 0 };
    previo.base += BigInt(r.base);
    previo.valor += BigInt(r.valor);
    previo.conteo += 1;
    acumulado.set(r.tipo, previo);
  }
  return [...acumulado.values()].map((a) => ({
    tipo: a.tipo,
    base: a.base.toString(),
    valor: a.valor.toString(),
    conteo: a.conteo,
  }));
}

const COLUMNAS_RESUMEN_TIPO: ColumnaDatos[] = [
  { header: 'Tipo de retención', key: 'tipo', width: 18 },
  { header: 'Base total', key: 'base', width: 16, tipo: 'moneda' },
  { header: 'Valor total retenido', key: 'valor', width: 18, tipo: 'moneda' },
  { header: 'N° de operaciones', key: 'conteo', width: 16 },
];

export async function generarCertificadoRetenciones(
  tx: SqlClient,
  opciones: RangoFechas & { terceroId: string },
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const retenciones = await retencionesPorTercero(tx, opciones);
  const tercero = retenciones[0];
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: `Certificado de retenciones — ${tercero?.terceroRazonSocial ?? 'tercero sin retenciones en el período'}`,
    periodo: `${opciones.desde} a ${opciones.hasta}`,
  });
  const parametros = [
    ...parametrosDesdeRetenciones(retenciones),
    ...(await parametrosDeRedondeoVigente(tx, { hasta: opciones.hasta })),
  ];
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_RETENCION,
    filasDatos: retenciones,
    resumenPapelDeTrabajo: { columnas: COLUMNAS_RESUMEN_TIPO, filas: resumenPorTipo(retenciones) },
    trazabilidad: trazabilidadDeRetenciones(retenciones),
    parametros,
  };
  return construirLibroExcel(spec);
}

export async function generarRelacionRetenciones(
  tx: SqlClient,
  rango: RangoFechas,
): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const retenciones = await retencionesPorPeriodo(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Relación de retenciones practicadas por período y tipo',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });
  const parametros = [
    ...parametrosDesdeRetenciones(retenciones),
    ...(await parametrosDeRedondeoVigente(tx, { hasta: rango.hasta })),
  ];
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_RETENCION,
    filasDatos: retenciones,
    resumenPapelDeTrabajo: { columnas: COLUMNAS_RESUMEN_TIPO, filas: resumenPorTipo(retenciones) },
    trazabilidad: trazabilidadDeRetenciones(retenciones),
    parametros,
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 9. ICA por municipio (D-091) — reteica APLICADA, agrupada por municipio
// =============================================================================

/** Suma por municipio, para la tabla de resumen de "Papel de trabajo". */
function resumenPorMunicipio(retenciones: readonly FilaRetencionAplicada[]): Array<Record<string, unknown>> {
  const acumulado = new Map<string, { municipio: string; base: bigint; valor: bigint; conteo: number }>();
  for (const r of retenciones) {
    const clave = r.municipioNombre ?? 'Sin municipio en la regla aplicada';
    const previo = acumulado.get(clave) ?? { municipio: clave, base: 0n, valor: 0n, conteo: 0 };
    previo.base += BigInt(r.base);
    previo.valor += BigInt(r.valor);
    previo.conteo += 1;
    acumulado.set(clave, previo);
  }
  return [...acumulado.values()].map((a) => ({
    municipio: a.municipio,
    base: a.base.toString(),
    valor: a.valor.toString(),
    conteo: a.conteo,
  }));
}

const COLUMNAS_RESUMEN_MUNICIPIO: ColumnaDatos[] = [
  { header: 'Municipio', key: 'municipio', width: 24 },
  { header: 'Base total', key: 'base', width: 16, tipo: 'moneda' },
  { header: 'ReteICA total', key: 'valor', width: 18, tipo: 'moneda' },
  { header: 'N° de operaciones', key: 'conteo', width: 16 },
];

export async function generarIcaPorMunicipio(tx: SqlClient, rango: RangoFechas): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const retenciones = await icaPorMunicipio(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'ICA retenido por municipio',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });
  const parametros = [
    ...parametrosDesdeRetenciones(retenciones),
    ...(await parametrosDeRedondeoVigente(tx, { hasta: rango.hasta })),
  ];
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_RETENCION,
    filasDatos: retenciones,
    resumenPapelDeTrabajo: { columnas: COLUMNAS_RESUMEN_MUNICIPIO, filas: resumenPorMunicipio(retenciones) },
    trazabilidad: trazabilidadDeRetenciones(retenciones),
    trazabilidadNota:
      retenciones.length === 0
        ? 'No hay retenciones de ReteICA aplicadas en el período. Verifique la parametrización de ICA por municipio (municipality_ica_rule) si esperaba movimiento.'
        : undefined,
    parametros,
  };
  return construirLibroExcel(spec);
}

// =============================================================================
// 8. Detalle de IVA generado y descontable
// =============================================================================

const COLUMNAS_IVA: ColumnaDatos[] = [
  ...COLUMNAS_MOVIMIENTO,
  { header: 'IVA generado/descontable', key: 'tipoIva', width: 16 },
];

export async function generarDetalleIva(tx: SqlClient, rango: RangoFechas): Promise<ExcelJS.Workbook> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const filas = await detalleIva(tx, rango);
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Detalle de IVA generado y descontable',
    periodo: `${rango.desde} a ${rango.hasta}`,
  });
  const totalGenerado = filas
    .filter((f) => f.tipoIva === 'generado')
    .reduce((acc, f) => acc + (f.side === 'credito' ? BigInt(f.monto) : -BigInt(f.monto)), 0n);
  const totalDescontable = filas
    .filter((f) => f.tipoIva === 'descontable')
    .reduce((acc, f) => acc + (f.side === 'debito' ? BigInt(f.monto) : -BigInt(f.monto)), 0n);
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos: COLUMNAS_IVA,
    filasDatos: filas,
    resumenPapelDeTrabajo: {
      columnas: [
        { header: 'Concepto', key: 'concepto', width: 24 },
        { header: 'Valor', key: 'valor', width: 16, tipo: 'moneda' },
      ],
      filas: [
        { concepto: 'IVA generado (por pagar)', valor: totalGenerado.toString() },
        { concepto: 'IVA descontable', valor: totalDescontable.toString() },
        { concepto: 'Neto a pagar / (a favor)', valor: (totalGenerado - totalDescontable).toString() },
      ],
    },
    trazabilidad: [],
    trazabilidadNota:
      'El IVA se registra tal como llega en el documento fuente; no lo calcula el motor de retenciones (Regla de Oro 4), así que no tiene una regla de `tax_rule` que trazar aquí.',
    parametros: [],
  };
  return construirLibroExcel(spec);
}

/**
 * A11 — Los siete formatos núcleo de exógena (sección 7.7): 1001, 1003, 1005,
 * 1006, 1007, 1008 y 1009. Cada generador exige `reporte.exportar` (mismo
 * permiso que A9 usa para los ocho libros de la sección 11.3: generar el
 * archivo — plano o Excel — es la acción que ese permiso nombra) y produce
 * DOS salidas:
 *
 *  1. `plano`: el layout delimitado que exige la resolución vigente (con la
 *     advertencia de `plano.ts` sobre lo que NO se pudo verificar).
 *  2. `workbook`: el mismo contenido en un libro Excel de cuatro hojas, con
 *     el constructor de A9 (`construirLibroExcel`), para revisión previa del
 *     contador antes de presentar.
 *
 * El Formato 1001 además exige, por columna aparte del `workbook`, la lista
 * de terceros a los que les falta dirección o código de departamento/
 * municipio (`tercerosIncompletos`): NUNCA se rellena ese dato con un valor
 * por defecto ni se omite la fila; se genera con lo que hay (en blanco) y se
 * reporta como bloqueo aparte, tanto en el objeto de retorno como en una
 * hoja "Bloqueos" del Excel.
 *
 * V-18: TODO generador de esta sección que devuelva `advertencias` (limitación
 * de alcance del producto, no un error) las hace llegar al `workbook`, no solo
 * al objeto de retorno y a la cabecera del plano: un bloque destacado en
 * "Papel de trabajo" (`LibroExcelSpec.advertencias`) y una hoja "Advertencias"
 * dedicada que queda ACTIVA al abrir el archivo (`hojaAdvertencias`,
 * `hojasAdicionalesExogena`) — para que un contador que abre el Excel no
 * confunda "no hubo operaciones" con "el producto no puede conocerlas
 * estructuralmente" (p. ej. Formatos 1003 y 1006: este producto no procesa
 * ventas).
 */
import type ExcelJS from 'exceljs';
import type { SqlClient } from '../../db/types';
import { exigirPermiso, PERMISOS } from '../../auth/permisos';
import { construirLibroExcel } from '../excel';
import { obtenerEncabezado } from '../encabezado';
import type { ColumnaDatos, HojaAdicional, LibroExcelSpec } from '../tipos';
import {
  autorretencionPorTercero1003,
  ingresosPorTercero1007,
  ivaPorTercero,
  pagosPorTercero1001,
  retencionMapeadaPorTercero1003,
  retencionesPorTerceroYTipo,
  saldosPorConcepto,
} from './consulta';
import { identificacionTercerosPorId, tercerosIncompletosParaFormato1001 } from './terceros';
import { centavosAPesosEnteroTexto, construirPlano, type ColumnaPlano } from './plano';
import type { IdentificacionTercero, RangoExogena, TerceroIncompleto } from './tipos';

export interface SalidaFormatoExogena {
  formatoCodigo: string;
  /** Fila cruda por registro, la misma que alimenta el Excel y el plano. */
  filas: readonly Record<string, unknown>[];
  /** El layout de texto que exige la resolución vigente (ver advertencia en `plano.ts`). */
  plano: string;
  workbook: ExcelJS.Workbook;
  /** Bloqueo del Formato 1001 (art. 1.3.5.2.1 Res. 000227/2025): vacío en los demás formatos. */
  tercerosIncompletos: TerceroIncompleto[];
  advertencias: string[];
}

const COLUMNAS_TERCERO_DATOS: ColumnaDatos[] = [
  { header: 'Tipo documento', key: 'tipoDocumento', width: 12 },
  { header: 'N° identificación', key: 'numeroDocumento', width: 16 },
  { header: 'DV', key: 'digitoVerificacion', width: 6 },
  { header: 'Primer apellido', key: 'primerApellido', width: 16 },
  { header: 'Segundo apellido', key: 'segundoApellido', width: 16 },
  { header: 'Primer nombre', key: 'primerNombre', width: 16 },
  { header: 'Otros nombres', key: 'otrosNombres', width: 16 },
  { header: 'Razón social', key: 'razonSocial', width: 28 },
  { header: 'Dirección', key: 'direccion', width: 26 },
  { header: 'Código departamento (DIVIPOLA)', key: 'codigoDepartamento', width: 14 },
  { header: 'Código municipio (DIVIPOLA)', key: 'codigoMunicipio', width: 14 },
  { header: 'País', key: 'pais', width: 8 },
];

const COLUMNAS_TERCERO_PLANO: ColumnaPlano<Record<string, unknown>>[] = COLUMNAS_TERCERO_DATOS.map((c) => ({
  header: c.header,
  obtener: (fila) => String((fila[c.key] as string | number | null) ?? ''),
}));

function filaTercero(t: IdentificacionTercero | null): Record<string, unknown> {
  if (t === null) {
    return {
      tipoDocumento: '',
      numeroDocumento: '',
      digitoVerificacion: '',
      primerApellido: '',
      segundoApellido: '',
      primerNombre: '',
      otrosNombres: '',
      razonSocial: '(sin tercero identificado en la partida)',
      direccion: '',
      codigoDepartamento: '',
      codigoMunicipio: '',
      pais: '',
    };
  }
  return {
    tipoDocumento: t.tipoDocumento,
    numeroDocumento: t.numeroDocumento,
    digitoVerificacion: t.digitoVerificacion ?? '',
    primerApellido: t.primerApellido ?? '',
    segundoApellido: t.segundoApellido ?? '',
    primerNombre: t.primerNombre ?? '',
    otrosNombres: t.otrosNombres ?? '',
    razonSocial: t.razonSocial,
    direccion: t.direccion ?? '',
    codigoDepartamento: t.codigoDepartamento ?? '',
    codigoMunicipio: t.codigoMunicipio ?? '',
    pais: t.pais,
  };
}

/** Hoja "Bloqueos": el Formato 1001 no se puede presentar en firme mientras
 * esta hoja tenga filas — se genera igual (no se detiene el archivo), pero
 * queda a la vista de quien lo revise. `activarAlAbrir` (V-18): es la hoja
 * que se ve al abrir el archivo cuando existe, por encima de cualquier hoja
 * "Advertencias" general (un bloqueo de datos reales es más urgente que una
 * limitación de alcance del producto). */
function hojaBloqueos1001(incompletos: readonly TerceroIncompleto[]): HojaAdicional {
  return {
    nombre: 'Bloqueos',
    activarAlAbrir: true,
    encabezadoTexto: [
      'Formato 1001 (art. 1.3.5.2.1 Res. 000227/2025): dirección y código de departamento/municipio ' +
        'son obligatorios para CADA tercero informado. Los terceros de esta hoja NO los tienen capturados: ' +
        'este archivo no debe presentarse a la DIAN hasta corregirlos en el maestro de terceros.',
    ],
    columnas: [
      { header: 'N° identificación', key: 'numeroDocumento', width: 16 },
      { header: 'Razón social', key: 'razonSocial', width: 28 },
      { header: 'Falta dirección', key: 'faltaDireccion', width: 16 },
      { header: 'Falta código municipio/departamento', key: 'faltaMunicipio', width: 20 },
    ],
    filas: incompletos.map((i) => ({
      numeroDocumento: i.numeroDocumento,
      razonSocial: i.razonSocial,
      faltaDireccion: i.faltaDireccion ? 'Sí' : 'No',
      faltaMunicipio: i.faltaMunicipio ? 'Sí' : 'No',
    })),
  };
}

/**
 * Hoja "Advertencias" (V-18 — corrección de A14 sobre A11/A9). Las
 * advertencias de alcance que cada generador ya devuelve en `advertencias`
 * (p. ej. "este producto no procesa facturas de venta, así que el Formato
 * 1003/1006 no tiene fuente automática completa") antes solo vivían en el
 * objeto de retorno y en la cabecera del archivo plano; el Excel — que es
 * justamente lo que un contador revisa antes de presentar — no las mostraba.
 * Reutiliza `HojaAdicional` y `construirHojaAdicional` de A9/A10 tal cual,
 * sin reimplementar nada: solo se agrega DESPUÉS de las cuatro hojas
 * obligatorias, exactamente como cualquier otra hoja adicional, y queda
 * marcada `activarAlAbrir` para que sea imposible de pasar por alto (ver
 * `construirLibroExcel`).
 */
function hojaAdvertencias(advertencias: readonly string[]): HojaAdicional {
  return {
    nombre: 'Advertencias',
    activarAlAbrir: true,
    encabezadoTexto: [
      'ADVERTENCIAS DE ALCANCE Y COBERTURA DE DATOS — léalas antes de presentar este formato.',
      'Distinguen "no hubo operaciones de este tipo en el período" de "el producto no tiene, ' +
        'estructuralmente, cómo conocerlas": son dos situaciones muy distintas y esta hoja existe para que ' +
        'no se confundan.',
    ],
    columnas: [{ header: 'Advertencia', key: 'texto', width: 120 }],
    filas: advertencias.map((texto) => ({ texto })),
  };
}

/** `hojasAdicionales` común a todo formato de exógena: el bloqueo del 1001
 * (si aplica) primero, y la hoja de advertencias de alcance (si el generador
 * devolvió alguna) después. Si ambas existen, `hojaBloqueos1001` gana la
 * pestaña activa por ir primero (ver `activarAlAbrir` en `tipos.ts`). */
function hojasAdicionalesExogena(
  advertencias: readonly string[],
  tercerosIncompletos: readonly TerceroIncompleto[] = [],
): HojaAdicional[] {
  return [
    ...(tercerosIncompletos.length > 0 ? [hojaBloqueos1001(tercerosIncompletos)] : []),
    ...(advertencias.length > 0 ? [hojaAdvertencias(advertencias)] : []),
  ];
}

async function terceroIdsDe(filas: readonly { terceroId: string | null }[]): Promise<string[]> {
  return [...new Set(filas.map((f) => f.terceroId).filter((id): id is string => id !== null))];
}

// =============================================================================
// Formato 1001
// =============================================================================

export async function generarFormato1001(tx: SqlClient, rango: RangoExogena): Promise<SalidaFormatoExogena> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const pagos = await pagosPorTercero1001(tx, rango);
  const retenciones = await retencionesPorTerceroYTipo(tx, rango);
  const idsTerceros = [...new Set(pagos.map((p) => p.terceroId))];
  const terceros = await identificacionTercerosPorId(tx, idsTerceros);

  const retencionesPorTercero = new Map<string, Record<string, string>>();
  for (const r of retenciones) {
    const previo = retencionesPorTercero.get(r.terceroId) ?? {};
    previo[r.tipo] = r.total;
    retencionesPorTercero.set(r.terceroId, previo);
  }

  const filas = pagos.map((p) => {
    const t = terceros.get(p.terceroId) ?? null;
    const ret = retencionesPorTercero.get(p.terceroId) ?? {};
    return {
      ...filaTercero(t),
      terceroId: p.terceroId,
      valorPagoOAbono: p.valorPagoOAbono,
      valorRetefuente: ret.retefuente ?? '0',
      valorReteiva: ret.reteiva ?? '0',
      valorReteica: ret.reteica ?? '0',
      numeroOperaciones: p.numeroOperaciones,
    };
  });

  const tercerosIncompletos = tercerosIncompletosParaFormato1001([...terceros.values()]);

  const columnasMonto: ColumnaDatos[] = [
    { header: 'Valor pago o abono en cuenta', key: 'valorPagoOAbono', width: 20, tipo: 'moneda' },
    { header: 'Retención renta practicada', key: 'valorRetefuente', width: 20, tipo: 'moneda' },
    { header: 'Retención IVA practicada', key: 'valorReteiva', width: 20, tipo: 'moneda' },
    { header: 'Retención ICA practicada', key: 'valorReteica', width: 20, tipo: 'moneda' },
    { header: 'N° operaciones', key: 'numeroOperaciones', width: 12 },
  ];
  const columnasDatos = [...COLUMNAS_TERCERO_DATOS, ...columnasMonto];
  const columnasPlano: ColumnaPlano<Record<string, unknown>>[] = [
    ...COLUMNAS_TERCERO_PLANO,
    { header: 'Valor pago o abono en cuenta', obtener: (f) => centavosAPesosEnteroTexto(f.valorPagoOAbono as string) },
    { header: 'Retención renta practicada', obtener: (f) => centavosAPesosEnteroTexto(f.valorRetefuente as string) },
    { header: 'Retención IVA practicada', obtener: (f) => centavosAPesosEnteroTexto(f.valorReteiva as string) },
    { header: 'Retención ICA practicada', obtener: (f) => centavosAPesosEnteroTexto(f.valorReteica as string) },
  ];

  const advertencias = [
    'La columna "Concepto" numérico de la DIAN (p. ej. compras, servicios, honorarios) no se incluye: ' +
      'esta versión agrupa por tercero, no por concepto de causación, porque el catálogo numérico de conceptos ' +
      'DIAN para el Formato 1001 no está verificado (advertencia 17.5). Pendiente de verificación normativa humana.',
  ];
  if (tercerosIncompletos.length > 0) {
    advertencias.push(
      `${tercerosIncompletos.length} tercero(s) sin dirección y/o código de municipio: ver hoja "Bloqueos". ` +
        'No se rellenó ningún valor por defecto.',
    );
  }

  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Formato 1001 — Pagos o abonos en cuenta y retenciones practicadas',
    periodo: `Año gravable ${rango.anioGravable} (${rango.desde} a ${rango.hasta})`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos,
    filasDatos: filas,
    trazabilidad: [],
    trazabilidadNota:
      'La regla y la vigencia de cada retención se consultan en el certificado de retenciones (sección 11.3); aquí se consolida el total por tercero para exógena.',
    parametros: [],
    advertencias,
    hojasAdicionales: hojasAdicionalesExogena(advertencias, tercerosIncompletos),
  };
  const workbook = construirLibroExcel(spec);
  const plano = construirPlano('1001', columnasPlano, filas, advertencias);
  return { formatoCodigo: '1001', filas, plano, workbook, tercerosIncompletos, advertencias };
}

// =============================================================================
// Formato 1003
// =============================================================================

export async function generarFormato1003(tx: SqlClient, rango: RangoExogena): Promise<SalidaFormatoExogena> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const [autorretencion, mapeadas] = await Promise.all([
    autorretencionPorTercero1003(tx, rango),
    retencionMapeadaPorTercero1003(tx, rango),
  ]);
  const combinadas = [...autorretencion, ...mapeadas];
  const idsTerceros = [...new Set(combinadas.map((c) => c.terceroId))];
  const terceros = await identificacionTercerosPorId(tx, idsTerceros);

  const filas = combinadas.map((c) => ({
    ...filaTercero(terceros.get(c.terceroId) ?? null),
    terceroId: c.terceroId,
    tipo: c.tipo,
    base: c.base,
    valor: c.valor,
    numeroOperaciones: c.n,
  }));

  const columnasDatos: ColumnaDatos[] = [
    ...COLUMNAS_TERCERO_DATOS,
    { header: 'Tipo de retención', key: 'tipo', width: 20 },
    { header: 'Base', key: 'base', width: 18, tipo: 'moneda' },
    { header: 'Valor retenido', key: 'valor', width: 18, tipo: 'moneda' },
    { header: 'N° operaciones', key: 'numeroOperaciones', width: 12 },
  ];
  const columnasPlano: ColumnaPlano<Record<string, unknown>>[] = [
    ...COLUMNAS_TERCERO_PLANO,
    { header: 'Tipo de retención', obtener: (f) => String(f.tipo ?? '') },
    { header: 'Base', obtener: (f) => centavosAPesosEnteroTexto(f.base as string) },
    { header: 'Valor retenido', obtener: (f) => centavosAPesosEnteroTexto(f.valor as string) },
  ];

  const advertencias = [
    'ALCANCE LIMITADO: este producto no procesa facturas de VENTA, así que no existe en el ledger la fuente ' +
      'natural del Formato 1003 (lo que un CLIENTE retuvo al pagarle a la empresa). Esta salida solo trae la ' +
      'autorretención que el motor de reglas calculó sobre las propias compras de la empresa (si es autorretenedora) ' +
      'y los movimientos que el contador haya mapeado manualmente (`exogena_account_mapping`, concepto ' +
      '"retencion_practicada_a_la_empresa"). Si la firma tiene ingresos con retención practicada por clientes que no ' +
      'están en esta lista, debe agregarlos por fuera de este generador antes de presentar.',
  ];

  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Formato 1003 — Retenciones en la fuente que le practicaron',
    periodo: `Año gravable ${rango.anioGravable} (${rango.desde} a ${rango.hasta})`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos,
    filasDatos: filas,
    trazabilidad: [],
    trazabilidadNota: 'La regla y la vigencia de la autorretención se consultan en el certificado de retenciones.',
    parametros: [],
    advertencias,
    hojasAdicionales: hojasAdicionalesExogena(advertencias),
  };
  const workbook = construirLibroExcel(spec);
  const plano = construirPlano('1003', columnasPlano, filas, advertencias);
  return { formatoCodigo: '1003', filas, plano, workbook, tercerosIncompletos: [], advertencias };
}

// =============================================================================
// Formato 1005 (IVA descontable) y 1006 (IVA generado)
// =============================================================================

async function generarFormatoIva(
  tx: SqlClient,
  rango: RangoExogena,
  tipo: 'descontable' | 'generado',
): Promise<SalidaFormatoExogena> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const formatoCodigo = tipo === 'descontable' ? '1005' : '1006';
  const nombreFormato = tipo === 'descontable' ? 'IVA descontable' : 'IVA generado';
  const agregados = await ivaPorTercero(tx, rango, tipo);
  const idsTerceros = await terceroIdsDe(agregados);
  const terceros = await identificacionTercerosPorId(tx, idsTerceros);

  const filas = agregados.map((a) => ({
    ...filaTercero(a.terceroId ? (terceros.get(a.terceroId) ?? null) : null),
    terceroId: a.terceroId,
    valorIva: a.valorIva,
    numeroOperaciones: a.n,
  }));

  const columnasDatos: ColumnaDatos[] = [
    ...COLUMNAS_TERCERO_DATOS,
    { header: `Valor ${nombreFormato}`, key: 'valorIva', width: 18, tipo: 'moneda' },
    { header: 'N° operaciones', key: 'numeroOperaciones', width: 12 },
  ];
  const columnasPlano: ColumnaPlano<Record<string, unknown>>[] = [
    ...COLUMNAS_TERCERO_PLANO,
    { header: `Valor ${nombreFormato}`, obtener: (f) => centavosAPesosEnteroTexto(f.valorIva as string) },
  ];

  const advertencias = [
    `La cuenta de IVA se identifica por NOMBRE ('%iva%' en el PUC de la empresa) y por naturaleza contable, ` +
      'igual que el reporte "Detalle de IVA" de la sección 11.3 (A9): no depende de un código de cuenta fijo. ' +
      '"Base gravable" no se incluye: el ledger no guarda una base separada para las líneas de IVA (solo para ' +
      'las retenciones), así que no se deriva una cifra sin verificar (Regla de Oro 5).',
  ];
  if (tipo === 'generado') {
    advertencias.push(
      'Este producto no procesa facturas de VENTA: esta salida solo verá movimiento si la firma registra sus ' +
        'ventas por asiento manual en el mismo ledger.',
    );
  }

  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: `Formato ${formatoCodigo} — ${nombreFormato}`,
    periodo: `Año gravable ${rango.anioGravable} (${rango.desde} a ${rango.hasta})`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos,
    filasDatos: filas,
    trazabilidad: [],
    trazabilidadNota: 'El IVA se registra tal como llega en el documento fuente; no lo calcula el motor de retenciones (Regla de Oro 4).',
    parametros: [],
    advertencias,
    hojasAdicionales: hojasAdicionalesExogena(advertencias),
  };
  const workbook = construirLibroExcel(spec);
  const plano = construirPlano(formatoCodigo, columnasPlano, filas, advertencias);
  return { formatoCodigo, filas, plano, workbook, tercerosIncompletos: [], advertencias };
}

export function generarFormato1005(tx: SqlClient, rango: RangoExogena): Promise<SalidaFormatoExogena> {
  return generarFormatoIva(tx, rango, 'descontable');
}

export function generarFormato1006(tx: SqlClient, rango: RangoExogena): Promise<SalidaFormatoExogena> {
  return generarFormatoIva(tx, rango, 'generado');
}

// =============================================================================
// Formato 1007 — ingresos recibidos
// =============================================================================

export async function generarFormato1007(tx: SqlClient, rango: RangoExogena): Promise<SalidaFormatoExogena> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const agregados = await ingresosPorTercero1007(tx, rango);
  const idsTerceros = await terceroIdsDe(agregados);
  const terceros = await identificacionTercerosPorId(tx, idsTerceros);

  const filas = agregados.map((a) => ({
    ...filaTercero(a.terceroId ? (terceros.get(a.terceroId) ?? null) : null),
    terceroId: a.terceroId,
    valorIngreso: a.valorIngreso,
    numeroOperaciones: a.n,
  }));

  const columnasDatos: ColumnaDatos[] = [
    ...COLUMNAS_TERCERO_DATOS,
    { header: 'Valor ingreso', key: 'valorIngreso', width: 18, tipo: 'moneda' },
    { header: 'N° operaciones', key: 'numeroOperaciones', width: 12 },
  ];
  const columnasPlano: ColumnaPlano<Record<string, unknown>>[] = [
    ...COLUMNAS_TERCERO_PLANO,
    { header: 'Valor ingreso', obtener: (f) => centavosAPesosEnteroTexto(f.valorIngreso as string) },
  ];

  const advertencias = [
    'Las cuentas de ingreso se identifican por `niif_mapping.clasificacion_niif = \'ingreso\'` (A10), resuelto ' +
      'a la fecha de cada hecho económico (`app.niif_de_cuenta`). Si la firma no ha clasificado sus cuentas de ' +
      'ingreso en `niif_mapping`, esta salida queda vacía: no es un error, es la ausencia documentada de esa ' +
      'configuración.',
  ];

  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Formato 1007 — Ingresos recibidos',
    periodo: `Año gravable ${rango.anioGravable} (${rango.desde} a ${rango.hasta})`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos,
    filasDatos: filas,
    trazabilidad: [],
    trazabilidadNota: 'Los ingresos se toman del ledger ya asentado; no hay una regla tributaria que trazar aquí.',
    parametros: [],
    advertencias,
    hojasAdicionales: hojasAdicionalesExogena(advertencias),
  };
  const workbook = construirLibroExcel(spec);
  const plano = construirPlano('1007', columnasPlano, filas, advertencias);
  return { formatoCodigo: '1007', filas, plano, workbook, tercerosIncompletos: [], advertencias };
}

// =============================================================================
// Formato 1008 (cuentas por cobrar) y 1009 (cuentas por pagar)
// =============================================================================

async function generarFormatoSaldo(
  tx: SqlClient,
  fechaCorte: string,
  anioGravable: number,
  concepto: 'cuenta_por_cobrar' | 'cuenta_por_pagar',
): Promise<SalidaFormatoExogena> {
  await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
  const formatoCodigo = concepto === 'cuenta_por_cobrar' ? '1008' : '1009';
  const nombreFormato = concepto === 'cuenta_por_cobrar' ? 'Cuentas por cobrar' : 'Cuentas por pagar';
  const saldos = await saldosPorConcepto(tx, concepto, fechaCorte);
  const idsTerceros = await terceroIdsDe(saldos);
  const terceros = await identificacionTercerosPorId(tx, idsTerceros);

  const filas = saldos.map((s) => ({
    ...filaTercero(s.terceroId ? (terceros.get(s.terceroId) ?? null) : null),
    terceroId: s.terceroId,
    cuentaCodigo: s.cuentaCodigo,
    cuentaNombre: s.cuentaNombre,
    saldoCorte: s.saldo,
  }));

  const columnasDatos: ColumnaDatos[] = [
    ...COLUMNAS_TERCERO_DATOS,
    { header: 'Cuenta PUC', key: 'cuentaCodigo', width: 12 },
    { header: 'Nombre cuenta', key: 'cuentaNombre', width: 26 },
    { header: 'Saldo al corte', key: 'saldoCorte', width: 18, tipo: 'moneda' },
  ];
  const columnasPlano: ColumnaPlano<Record<string, unknown>>[] = [
    ...COLUMNAS_TERCERO_PLANO,
    { header: 'Cuenta PUC', obtener: (f) => String(f.cuentaCodigo ?? '') },
    { header: 'Saldo al corte', obtener: (f) => centavosAPesosEnteroTexto(f.saldoCorte as string) },
  ];

  const advertencias =
    concepto === 'cuenta_por_pagar'
      ? [
          'Las cuentas se identifican como la contrapartida que el motor de causación usa al registrar compras ' +
            '(`concepto_causacion.cuenta_contrapartida_id`), más las que el contador mapee explícitamente en ' +
            '`exogena_account_mapping`. El saldo es el saldo NATURAL de la cuenta (a favor de su naturaleza contable) ' +
            `al ${fechaCorte}.`,
        ]
      : [
          'Este producto no causa ventas, así que NO hay una fuente automática de cuentas por cobrar comerciales: ' +
            'esta salida solo trae saldo si el contador configuró al menos una cuenta en `exogena_account_mapping` ' +
            '(concepto "cuenta_por_cobrar"). Si la lista está vacía, es porque falta esa configuración, no porque ' +
            'la empresa no tenga cuentas por cobrar.',
        ];

  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: `Formato ${formatoCodigo} — ${nombreFormato}`,
    periodo: `Año gravable ${anioGravable}, saldo al ${fechaCorte}`,
  });
  const spec: LibroExcelSpec = {
    encabezado,
    columnasDatos,
    filasDatos: filas,
    trazabilidad: [],
    trazabilidadNota: 'Saldo contable al corte; no hay una regla tributaria que trazar aquí.',
    parametros: [],
    advertencias,
    hojasAdicionales: hojasAdicionalesExogena(advertencias),
  };
  const workbook = construirLibroExcel(spec);
  const plano = construirPlano(formatoCodigo, columnasPlano, filas, advertencias);
  return { formatoCodigo, filas, plano, workbook, tercerosIncompletos: [], advertencias };
}

export function generarFormato1008(tx: SqlClient, fechaCorte: string, anioGravable: number): Promise<SalidaFormatoExogena> {
  return generarFormatoSaldo(tx, fechaCorte, anioGravable, 'cuenta_por_cobrar');
}

export function generarFormato1009(tx: SqlClient, fechaCorte: string, anioGravable: number): Promise<SalidaFormatoExogena> {
  return generarFormatoSaldo(tx, fechaCorte, anioGravable, 'cuenta_por_pagar');
}

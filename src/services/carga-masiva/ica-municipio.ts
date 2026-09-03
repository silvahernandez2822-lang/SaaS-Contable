/**
 * A8 — D-088 · TAREA 4. Carga masiva de la parametrización de ICA de UN
 * municipio completo desde un archivo con el layout propio del cliente
 * (bloque de encabezado + tabla de actividades), distinto del CSV de columnas
 * planas del framework `definiciones.ts`.
 *
 * QUÉ HACE Y QUÉ NO (mismos principios que `importar.ts`):
 *
 *  · NO escribe SQL. El encabezado va por `crearOReemplazarMunicipioIca` y cada
 *    actividad por `crearOReemplazarTaxRule`, los mismos servicios de dominio
 *    que usa la edición fila a fila: heredan sin copiar una línea la vigencia
 *    append-only (6.2.3), la norma de respaldo obligatoria (6.2.4), el permiso
 *    por trigger (`parametro.editar`, 016) y la auditoría (Regla de Oro 6).
 *  · NO inventa valores tributarios. La fecha de vigencia, la norma de respaldo
 *    y la periodicidad de declaración NO están en el archivo del cliente: las
 *    escribe el contador en el formulario de carga, una vez para todo el
 *    municipio. Sin ellas no se carga nada.
 *  · Zero-pad de los códigos a 4 dígitos ANTES de resolver contra
 *    `ciiu_activity`. Un código de 5 dígitos (subclase del Distrito de Bogotá),
 *    uno corrupto o uno inexistente sale como FILA CON ERROR en el informe: no
 *    se inserta, no se inventa y no se calla (§17). El resto sí se carga.
 *
 * A diferencia de `importar.ts` (todo-o-nada), aquí las filas con error de
 * formato/código NO abortan la carga: se informan y las válidas entran, porque
 * el archivo real trae ~100 subclases de 5 dígitos que el cliente no puede
 * quitar y bloquear por ellas las 450 buenas sería inútil. Un fallo inesperado
 * en un INSERT sí deshace todo (lo hace el ROLLBACK de `conSesion`).
 */
import ExcelJS from 'exceljs';
import type { SqlClient } from '../../db/types';
import { isPostgresError, SQLSTATE } from '../../db/types';
import {
  crearOReemplazarMunicipioIca,
  resolverCiiuPorCodigo,
  resolverMunicipioPorDane,
} from '../catalogos';
import { crearOReemplazarTaxRule } from '../catalogos';
import { ArchivoIlegibleError } from './tabla';

export { ArchivoIlegibleError };

/**
 * Concepto tributario global (seed 100_reteica_medellin.sql) que sirve de
 * puntero para toda `tax_rule` de ICA de municipio. El motor (`reglasIca` en
 * repositorio.ts) resuelve la tarifa por `municipality_id` + `ciiu_activity_id`
 * y trata el concepto como opcional, así que una sola identidad estable para
 * general y por actividad es suficiente y evita crear conceptos por la vía.
 */
const CONCEPTO_RETEICA = 'reteica_tarifa_general_municipio';

export interface ErrorFilaIca {
  numeroFila: number | null;
  columna: string | null;
  motivo: string;
}

export interface EncabezadoIca {
  baseMinimaComprasUvt: string | null;
  baseMinimaServiciosUvt: string | null;
  tipoMedicionBaseMinima: 'por_factura' | 'por_periodo';
  periodoMeses: number | null;
}

export interface ResultadoCargaIca {
  archivo: string;
  hoja: string;
  municipioTexto: string;
  municipioDane: string | null;
  encabezado: EncabezadoIca | null;
  filasLeidas: number;
  filasValidas: number;
  filasConError: number;
  filasInsertadas: number;
  errores: ErrorFilaIca[];
  aplicado: boolean;
}

export class CargaIcaRechazadaError extends Error {
  readonly resultado: ResultadoCargaIca;
  constructor(resultado: ResultadoCargaIca) {
    super('No se cargó la parametrización de ICA del municipio.');
    this.name = 'CargaIcaRechazadaError';
    this.resultado = resultado;
  }
}

// =============================================================================
// LECTURA DEL ARCHIVO
// =============================================================================

interface FilaActividadCruda {
  numeroFila: number;
  codigoCrudo: string;
  descripcion: string;
  tarifaCrudo: string;
  gravadaCrudo: string;
}

export interface ArchivoIcaLeido {
  hoja: string;
  municipioTexto: string;
  encabezado: EncabezadoIca;
  actividades: FilaActividadCruda[];
}

function texto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return texto(o.result as ExcelJS.CellValue);
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('').trim();
    }
    if ('text' in o && typeof o.text === 'string') return o.text.trim();
  }
  return String(v).trim();
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Devuelve, por cada fila de la hoja, la lista de textos de sus celdas (1..N). */
function filasDeHoja(hoja: ExcelJS.Worksheet): string[][] {
  const filas: string[][] = [];
  hoja.eachRow({ includeEmpty: true }, (fila, numero) => {
    const celdas: string[] = [];
    const valores = fila.values as ExcelJS.CellValue[];
    for (let c = 1; c < Math.max(valores.length, 12); c += 1) celdas.push(texto(valores[c]));
    while (filas.length < numero - 1) filas.push([]);
    filas.push(celdas);
  });
  return filas;
}

/** Valor de la celda a la derecha de la primera celda cuyo texto casa `test`. */
function valorTrasEtiqueta(filas: string[][], test: (t: string) => boolean): string {
  for (const celdas of filas) {
    for (let i = 0; i < celdas.length; i += 1) {
      if (celdas[i] && test(normalizar(celdas[i]!))) {
        for (let j = i + 1; j < celdas.length; j += 1) {
          if (celdas[j] && celdas[j]!.trim() !== '') return celdas[j]!.trim();
        }
        return '';
      }
    }
  }
  return '';
}

export async function leerArchivoIca(
  contenido: ArrayBuffer | Buffer | Uint8Array,
): Promise<ArchivoIcaLeido> {
  const wb = new ExcelJS.Workbook();
  try {
    const ab =
      contenido instanceof ArrayBuffer
        ? contenido
        : (contenido.buffer.slice(
            contenido.byteOffset,
            contenido.byteOffset + contenido.byteLength,
          ) as ArrayBuffer);
    await wb.xlsx.load(ab);
  } catch (e) {
    throw new ArchivoIlegibleError(
      'No se pudo abrir el archivo como libro de Excel (.xlsx). Detalle: ' +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  const hoja = wb.worksheets[0];
  if (!hoja) throw new ArchivoIlegibleError('El archivo de Excel no tiene ninguna hoja.');

  const filas = filasDeHoja(hoja);

  const municipioTexto = valorTrasEtiqueta(filas, (t) => t === 'municipio' || t.startsWith('municipio'));
  if (!municipioTexto) {
    throw new ArchivoIlegibleError(
      'No se encontró la celda "Municipio" con su valor en el bloque de encabezado del archivo.',
    );
  }

  const baseCompras = valorTrasEtiqueta(
    filas,
    (t) => t.includes('base minima') && t.includes('compra'),
  );
  const baseServicios = valorTrasEtiqueta(
    filas,
    (t) => t.includes('base minima') && t.includes('servicio'),
  );
  const tipoMedicionTexto = normalizar(
    valorTrasEtiqueta(filas, (t) => t.includes('tipo de medicion') || t.includes('medicion base')),
  );
  const periodoTexto = valorTrasEtiqueta(
    filas,
    (t) => t.includes('periodo') && (t.includes('mes') || t.includes('meses')),
  );

  const tipoMedicion: 'por_factura' | 'por_periodo' =
    tipoMedicionTexto.includes('periodo') ? 'por_periodo' : 'por_factura';
  const periodoMeses =
    tipoMedicion === 'por_periodo' && periodoTexto ? Number(periodoTexto.replace(',', '.')) : null;

  // Tabla de actividades: fila de encabezados = la que trae "Codigo" y "Gravada".
  let filaEnc = -1;
  filas.forEach((celdas, idx) => {
    const norm = celdas.map((c) => normalizar(c));
    if (norm.some((c) => c === 'codigo') && norm.some((c) => c.includes('gravada'))) filaEnc = idx;
  });
  if (filaEnc < 0) {
    throw new ArchivoIlegibleError(
      'No se encontró la tabla de actividades: falta la fila de encabezados con las columnas "Código" y "Gravada".',
    );
  }
  const enc = filas[filaEnc]!.map((c) => normalizar(c));
  const colCodigo = enc.findIndex((c) => c === 'codigo');
  const colTarifa = enc.findIndex((c) => c.includes('tarifa'));
  const colGravada = enc.findIndex((c) => c.includes('gravada'));
  const colDesc = enc.findIndex((c) => c.includes('descripcion'));

  const actividades: FilaActividadCruda[] = [];
  for (let i = filaEnc + 1; i < filas.length; i += 1) {
    const celdas = filas[i]!;
    const codigoCrudo = (celdas[colCodigo] ?? '').trim();
    const tarifaCrudo = (celdas[colTarifa] ?? '').trim();
    const gravadaCrudo = (celdas[colGravada] ?? '').trim();
    const descripcion = colDesc >= 0 ? (celdas[colDesc] ?? '').trim() : '';
    if (codigoCrudo === '' && tarifaCrudo === '' && gravadaCrudo === '') continue; // fila en blanco
    actividades.push({ numeroFila: i + 1, codigoCrudo, descripcion, tarifaCrudo, gravadaCrudo });
  }

  return {
    hoja: hoja.name,
    municipioTexto,
    encabezado: {
      baseMinimaComprasUvt: baseCompras || null,
      baseMinimaServiciosUvt: baseServicios || null,
      tipoMedicionBaseMinima: tipoMedicion,
      periodoMeses,
    },
    actividades,
  };
}

// =============================================================================
// VALIDACIÓN DE UNA FILA DE ACTIVIDAD (pura)
// =============================================================================

interface ActividadValida {
  numeroFila: number;
  ciiuCodigo: string;
  tarifaFraccion: string;
  gravada: boolean;
}

const DECIMAL = /^\d+(?:[.,]\d+)?$/;

function validarActividad(fila: FilaActividadCruda): ActividadValida {
  const soloDigitos = fila.codigoCrudo.replace(/[^\d]/g, '');
  if (fila.codigoCrudo === '') {
    throw new Error('"Código": la fila trae tarifa o gravada pero el código está vacío.');
  }
  if (!/^\d+$/.test(fila.codigoCrudo) || fila.codigoCrudo.length > 4 || soloDigitos.length > 4) {
    throw new Error(
      `"Código": "${fila.codigoCrudo}" no es un código CIIU de 4 dígitos. Las subclases de 5 dígitos ` +
        'del Distrito y los valores corruptos no se cargan (pendiente de decisión de esquema, misma raíz que V-5).',
    );
  }
  const ciiuCodigo = fila.codigoCrudo.padStart(4, '0');

  const gravadaNorm = normalizar(fila.gravadaCrudo);
  let gravada: boolean;
  if (gravadaNorm === 's' || gravadaNorm === 'si' || gravadaNorm === 'sí' || gravadaNorm === 'x') {
    gravada = true;
  } else if (gravadaNorm === 'n' || gravadaNorm === 'no' || gravadaNorm === '') {
    gravada = false;
  } else {
    throw new Error(`"Gravada": "${fila.gravadaCrudo}" no es "S" ni "N".`);
  }

  if (!gravada) {
    // No gravada: la tarifa es cero, sin importar lo que traiga la celda
    // (el CHECK tax_rule_gravada_ck lo exige).
    return { numeroFila: fila.numeroFila, ciiuCodigo, tarifaFraccion: '0', gravada: false };
  }

  if (fila.tarifaCrudo === '') {
    throw new Error('"Tarifa por mil": una actividad gravada necesita su tarifa y vino vacía.');
  }
  const norm = fila.tarifaCrudo.replace(',', '.');
  if (!DECIMAL.test(fila.tarifaCrudo.replace(',', '.'))) {
    throw new Error(`"Tarifa por mil": "${fila.tarifaCrudo}" no es un número.`);
  }
  const fraccion = (Number(norm) / 1000).toFixed(6);
  return { numeroFila: fila.numeroFila, ciiuCodigo, tarifaFraccion: fraccion, gravada: true };
}

// =============================================================================
// IMPORTACIÓN
// =============================================================================

export interface OpcionesCargaIca {
  vigenteDesde: string;
  normaRespaldo: string;
  periodicidad: 'mensual' | 'bimestral' | 'trimestral' | 'cuatrimestral' | 'anual';
  alcance?: 'firma' | 'empresa';
}

function motivoDeError(e: unknown): string {
  if (isPostgresError(e)) {
    if (e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
      return 'su sesión no tiene el permiso parametro.editar (administrador tributario o de firma).';
    }
    if (e.code === SQLSTATE.CHECK_VIOLATION) return `restricción del esquema: ${e.message}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function importarIcaMunicipio(
  tx: SqlClient,
  nombreArchivo: string,
  contenido: ArrayBuffer | Buffer | Uint8Array,
  opciones: OpcionesCargaIca,
): Promise<ResultadoCargaIca> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opciones.vigenteDesde)) {
    throw new ArchivoIlegibleError('La fecha de vigencia es obligatoria (AAAA-MM-DD).');
  }
  if (!opciones.normaRespaldo.trim()) {
    throw new ArchivoIlegibleError(
      'La norma de respaldo es obligatoria: escriba el acuerdo municipal que sustenta estas tarifas.',
    );
  }

  const leido = await leerArchivoIca(contenido);

  const resultado: ResultadoCargaIca = {
    archivo: nombreArchivo,
    hoja: leido.hoja,
    municipioTexto: leido.municipioTexto,
    municipioDane: null,
    encabezado: leido.encabezado,
    filasLeidas: leido.actividades.length,
    filasValidas: 0,
    filasConError: 0,
    filasInsertadas: 0,
    errores: [],
    aplicado: false,
  };

  // ---- Resolver el municipio (por DANE de 5 dígitos o por nombre) ----------
  const t = leido.municipioTexto.trim();
  let municipalityId: string | null = null;
  if (/^\d{5}$/.test(t)) {
    municipalityId = await resolverMunicipioPorDane(tx, t);
  } else {
    const { rows } = await tx.query<{ id: string; codigo_dane: string }>(
      `SELECT id, codigo_dane FROM municipality
        WHERE tenant_id IS NULL AND lower(btrim(nombre)) = lower(btrim($1))`,
      [t],
    );
    if (rows.length === 1) {
      municipalityId = rows[0]!.id;
      resultado.municipioDane = rows[0]!.codigo_dane;
    } else if (rows.length > 1) {
      resultado.errores.push({
        numeroFila: null,
        columna: 'Municipio',
        motivo: `"${t}" corresponde a ${rows.length} municipios. Escriba el código DANE de 5 dígitos en la celda "Municipio".`,
      });
      resultado.filasConError = resultado.errores.length;
      throw new CargaIcaRechazadaError(resultado);
    }
  }
  if (!municipalityId) {
    resultado.errores.push({
      numeroFila: null,
      columna: 'Municipio',
      motivo: `no existe ningún municipio "${t}" en el catálogo DANE. Cárguelo primero (plantilla de municipios).`,
    });
    resultado.filasConError = resultado.errores.length;
    throw new CargaIcaRechazadaError(resultado);
  }
  {
    const { rows } = await tx.query<{ codigo_dane: string }>(
      'SELECT codigo_dane FROM municipality WHERE id = $1',
      [municipalityId],
    );
    resultado.municipioDane = rows[0]?.codigo_dane ?? null;
  }
  if (!resultado.municipioDane) throw new CargaIcaRechazadaError(resultado);

  // ---- Pasada 1: formato de cada fila de actividad ------------------------
  const candidatas: ActividadValida[] = [];
  for (const fila of leido.actividades) {
    try {
      candidatas.push(validarActividad(fila));
    } catch (e) {
      resultado.errores.push({
        numeroFila: fila.numeroFila,
        columna: null,
        motivo: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- Pasada 2: el CIIU existe -----------------------------------------
  const validas: ActividadValida[] = [];
  for (const c of candidatas) {
    const ciiuId = await resolverCiiuPorCodigo(tx, c.ciiuCodigo);
    if (!ciiuId) {
      resultado.errores.push({
        numeroFila: c.numeroFila,
        columna: 'Código',
        motivo: `no existe la actividad CIIU "${c.ciiuCodigo}" en el catálogo. No se inventa: verifíquela.`,
      });
    } else {
      validas.push(c);
    }
  }

  resultado.filasValidas = validas.length;
  resultado.filasConError = resultado.errores.length;

  // ---- Escritura: encabezado del municipio primero, luego las actividades --
  const periodoMeses = leido.encabezado.periodoMeses;
  try {
    await crearOReemplazarMunicipioIca(tx, {
      municipioDane: resultado.municipioDane,
      practicaReteica: true,
      baseMinimaServiciosUvt: leido.encabezado.baseMinimaServiciosUvt,
      baseMinimaComprasUvt: leido.encabezado.baseMinimaComprasUvt,
      usaTarifaDeActividad: true,
      tarifaGeneral: null,
      periodicidad: opciones.periodicidad,
      tipoMedicionBaseMinima: leido.encabezado.tipoMedicionBaseMinima,
      periodoMeses,
      vigenteDesde: opciones.vigenteDesde,
      normaRespaldo: opciones.normaRespaldo.trim(),
      alcanceNuevo: opciones.alcance,
    });

    for (const c of validas) {
      await crearOReemplazarTaxRule(tx, {
        tipo: 'reteica',
        conceptoCodigo: CONCEPTO_RETEICA,
        tarifa: c.tarifaFraccion,
        gravada: c.gravada,
        municipioDane: resultado.municipioDane,
        ciiuCodigo: c.ciiuCodigo,
        vigenteDesde: opciones.vigenteDesde,
        normaRespaldo: opciones.normaRespaldo.trim(),
        alcance: opciones.alcance,
      });
      resultado.filasInsertadas += 1;
    }
  } catch (e) {
    resultado.errores.push({ numeroFila: null, columna: null, motivo: motivoDeError(e) });
    resultado.filasConError = resultado.errores.length;
    resultado.filasInsertadas = 0;
    throw new CargaIcaRechazadaError(resultado);
  }

  await tx
    .query('SELECT app.registrar_carga_masiva($1, $2, $3, $4, $5::jsonb)', [
      'municipality_ica_rule + tax_rule (reteica)',
      nombreArchivo,
      resultado.filasInsertadas,
      resultado.filasConError,
      JSON.stringify({
        catalogo: 'ica_municipio_d088',
        hoja: leido.hoja,
        municipio: resultado.municipioDane,
        filas_leidas: resultado.filasLeidas,
      }),
    ])
    .catch(() => undefined);

  resultado.aplicado = true;
  return resultado;
}

// =============================================================================
// PLANTILLA DESCARGABLE (mismo layout que espera el parser)
// =============================================================================

export function construirPlantillaIcaMunicipio(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Contable CO';
  wb.description = 'Plantilla D-088 — parametrización de ICA por municipio';
  const hoja = wb.addWorksheet('Hoja1');

  hoja.getCell('C5').value = 'Municipio';
  hoja.getCell('D5').value = '05001';
  hoja.getCell('G5').value = 'Base mínima UVT compra';
  hoja.getCell('H5').value = 27;
  hoja.getCell('G6').value = 'Base mínima UVT servicio';
  hoja.getCell('H6').value = 4;
  hoja.getCell('J5').value = 'Tipo de medición base mínima';
  hoja.getCell('K5').value = 'Por factura';
  hoja.getCell('J6').value = 'Periodo en meses (solo si es "Por periodo")';
  hoja.getCell('K6').value = '';

  for (const [c, txt] of [
    ['C8', 'Código'],
    ['D8', 'Descripción'],
    ['I8', 'Tarifa por mil'],
    ['J8', 'Gravada'],
  ] as const) {
    hoja.getCell(c).value = txt;
    hoja.getCell(c).font = { bold: true };
  }
  hoja.getColumn(3).numFmt = '@'; // C = Código como texto
  hoja.getCell('C9').value = '0161';
  hoja.getCell('D9').value = 'Actividades de apoyo a la agricultura (ejemplo — bórrelo)';
  hoja.getCell('I9').value = 6;
  hoja.getCell('J9').value = 'S';
  hoja.getCell('C10').value = '9900';
  hoja.getCell('D10').value = 'Actividad no gravada (ejemplo — la tarifa se deja vacía)';
  hoja.getCell('J10').value = 'N';

  const nota = wb.addWorksheet('Instrucciones');
  nota.getColumn(1).width = 110;
  [
    'Plantilla D-088 — parametrización de ICA por municipio. Un archivo = un municipio completo.',
    '',
    'BLOQUE DE ENCABEZADO (hoja "Hoja1"):',
    '  • "Municipio": el código DANE de 5 dígitos (recomendado) o el nombre exacto del municipio.',
    '  • "Base mínima UVT compra" / "Base mínima UVT servicio": en UVT. Vacío = sin base mínima.',
    '  • "Tipo de medición base mínima": "Por factura" (se compara cada factura) o "Por periodo"',
    '    (se compara el acumulado del tercero en el municipio durante la ventana).',
    '  • "Periodo en meses": solo si es "Por periodo". Entre 1 y 12.',
    '',
    'TABLA DE ACTIVIDADES (encabezados en la fila 8):',
    '  • "Código": CIIU de 4 dígitos. Los ceros a la izquierda se conservan (161 = 0161).',
    '    Las subclases de 5 dígitos del Distrito NO se cargan: salen en el informe de errores.',
    '  • "Tarifa por mil": p. ej. 9,66 se guarda como 0,00966. Vacío si la actividad NO está gravada.',
    '  • "Gravada": "S" o "N". Con "N" el motor no retiene ICA de esa actividad, sin importar la tarifa.',
    '',
    'La FECHA DE VIGENCIA, la NORMA DE RESPALDO y la PERIODICIDAD de declaración NO van en el archivo:',
    'las escribe usted en el formulario de carga, una sola vez para todo el municipio (sección 6.2).',
  ].forEach((linea) => nota.addRow([linea]));

  return wb;
}

/**
 * A9 — Descarga de reportes en Excel (Ola 3, sección 11 — cierre de V-16).
 *
 * `src/reports/` construía los ocho reportes obligatorios de la 11.3 (y los
 * de A10/A11 sobre el mismo constructor de cuatro hojas) desde su primera
 * entrega, pero A14 encontró que ningún route handler los invocaba: no había
 * por dónde descargarlos. Esta ruta es ese único punto de entrada HTTP.
 *
 * Contrato:
 *
 *   GET /api/reportes/:libro?<parámetros del reporte>
 *
 *   - `:libro` es uno de los slugs de `REPORTES` (abajo). 404 con la lista de
 *     slugs válidos si no existe.
 *   - Los parámetros de cada reporte (fechas, cuenta, tercero, nivel del PUC,
 *     año gravable...) van en la query string. 400 con un mensaje puntual si
 *     falta uno obligatorio o tiene un formato inválido.
 *   - Responde el `.xlsx` con `Content-Type` de OOXML y `Content-Disposition:
 *     attachment` con un nombre de archivo pensado para un contador: razón
 *     social, NIT, reporte y período — tomados del propio libro generado,
 *     nunca de un parámetro que el cliente arme.
 *
 * SEGURIDAD (D-021/D-022, esto es lo delicado de esta ruta):
 *
 *   - La empresa NUNCA sale de la query string ni de ningún parámetro que
 *     elija el cliente. Sale exclusivamente de `conSesion` (`app/lib/sesion.ts`),
 *     que la lee de la cookie de sesión y la BASE DE DATOS la autoriza contra
 *     `app.current_company_id()` (`EmpresaNoAutorizadaError` si no hay acceso
 *     vigente). Cada `generarXxx` de `src/reports` arma su encabezado y filtra
 *     sus datos con esa función — nunca con un `companyId` de aplicación.
 *   - Sin cookie de sesión (o sesión vencida/revocada): 401, sin generar nada.
 *   - Sin el permiso `reporte.exportar`: 403 — lo exige el motor
 *     (`app.exigir_permiso`, disparado dentro de cada `generarXxx`), esta
 *     ruta solo traduce el error a HTTP.
 */
import type ExcelJS from 'exceljs';
import type { SqlClient } from '../../../../src/db/types';
import { SesionInvalidaError, EmpresaNoAutorizadaError } from '../../../../src/db/tenant-context';
import { PermisoInsuficienteError } from '../../../../src/auth/permisos';
import { conSesion, SesionNoPresenteError } from '../../../lib/sesion';
import {
  libroABuffer,
  generarLibroDiario,
  generarLibroMayor,
  generarLibroAuxiliar,
  generarBalanceDePrueba,
  generarMovimientoTerceros,
  generarCertificadoRetenciones,
  generarRelacionRetenciones,
  generarDetalleIva,
  generarEstadoSituacionFinanciera,
  generarEstadoResultadoIntegral,
  generarEstadoCambiosPatrimonio,
  generarEstadoFlujosEfectivo,
  generarNotasEstadosFinancieros,
  generarFormato1001,
  generarFormato1003,
  generarFormato1005,
  generarFormato1006,
  generarFormato1007,
  generarFormato1008,
  generarFormato1009,
  type NivelPuc,
  type RangoExogena,
  type PresentacionEri,
} from '../../../../src/reports';

export const dynamic = 'force-dynamic';

// =============================================================================
// Parámetros de la query string: validación temprana (mensaje claro), nunca
// el filtro de seguridad — ese lo impone `conSesion` + la base de datos.
// =============================================================================

class ParametroReporteInvalidoError extends Error {}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaRequerida(sp: URLSearchParams, campo: string): string {
  const v = sp.get(campo);
  if (!v || !RE_FECHA.test(v)) {
    throw new ParametroReporteInvalidoError(
      `El parámetro "${campo}" es obligatorio y debe tener el formato AAAA-MM-DD.`,
    );
  }
  return v;
}

function fechaOpcional(sp: URLSearchParams, campo: string): string | null {
  const v = sp.get(campo);
  if (v === null || v === '') return null;
  if (!RE_FECHA.test(v)) {
    throw new ParametroReporteInvalidoError(`El parámetro "${campo}" debe tener el formato AAAA-MM-DD.`);
  }
  return v;
}

function rangoFechas(sp: URLSearchParams): { desde: string; hasta: string } {
  return { desde: fechaRequerida(sp, 'desde'), hasta: fechaRequerida(sp, 'hasta') };
}

function requerido(sp: URLSearchParams, campo: string): string {
  const v = sp.get(campo);
  if (!v) throw new ParametroReporteInvalidoError(`El parámetro "${campo}" es obligatorio para este reporte.`);
  return v;
}

function opcional(sp: URLSearchParams, campo: string): string | null {
  return sp.get(campo) || null;
}

function enteroRequerido(sp: URLSearchParams, campo: string, min: number, max: number): number {
  const crudo = sp.get(campo);
  const n = crudo === null ? NaN : Number(crudo);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ParametroReporteInvalidoError(
      `El parámetro "${campo}" debe ser un entero entre ${min} y ${max}.`,
    );
  }
  return n;
}

function presentacionOpcional(sp: URLSearchParams): PresentacionEri | undefined {
  const v = sp.get('presentacion');
  if (v === 'funcion' || v === 'naturaleza') return v;
  return undefined;
}

function rangoExogena(sp: URLSearchParams): RangoExogena {
  const rango = rangoFechas(sp);
  const anioGravable = enteroRequerido(sp, 'anioGravable', 2000, 2100);
  return { ...rango, anioGravable };
}

// =============================================================================
// Catálogo de reportes descargables. `periodo` es solo cosmético (nombre de
// archivo); la generación real ya trae su propio período en la hoja "Papel
// de trabajo".
// =============================================================================

interface SalidaReporte {
  workbook: ExcelJS.Workbook;
  periodo: string;
}

type GeneradorReporte = (tx: SqlClient, sp: URLSearchParams) => Promise<SalidaReporte>;

const REPORTES: Record<string, GeneradorReporte> = {
  // ---- Los ocho reportes obligatorios de la sección 11.3 (A9) ----
  'libro-diario': async (tx, sp) => {
    const rango = rangoFechas(sp);
    return { workbook: await generarLibroDiario(tx, rango), periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'libro-mayor': async (tx, sp) => {
    const rango = rangoFechas(sp);
    return { workbook: await generarLibroMayor(tx, rango), periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'libro-auxiliar': async (tx, sp) => {
    const rango = rangoFechas(sp);
    const accountId = requerido(sp, 'accountId');
    const terceroId = opcional(sp, 'terceroId');
    const workbook = await generarLibroAuxiliar(tx, { ...rango, accountId, terceroId });
    return { workbook, periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'balance-prueba': async (tx, sp) => {
    const rango = rangoFechas(sp);
    const nivel = enteroRequerido(sp, 'nivel', 1, 5) as NivelPuc;
    const workbook = await generarBalanceDePrueba(tx, { ...rango, nivel });
    return { workbook, periodo: `${rango.desde}_a_${rango.hasta}_nivel${nivel}` };
  },
  'movimiento-terceros': async (tx, sp) => {
    const rango = rangoFechas(sp);
    const terceroId = opcional(sp, 'terceroId');
    const workbook = await generarMovimientoTerceros(tx, { ...rango, terceroId });
    return { workbook, periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'certificado-retenciones': async (tx, sp) => {
    const rango = rangoFechas(sp);
    const terceroId = requerido(sp, 'terceroId');
    const workbook = await generarCertificadoRetenciones(tx, { ...rango, terceroId });
    return { workbook, periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'relacion-retenciones': async (tx, sp) => {
    const rango = rangoFechas(sp);
    return { workbook: await generarRelacionRetenciones(tx, rango), periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'detalle-iva': async (tx, sp) => {
    const rango = rangoFechas(sp);
    return { workbook: await generarDetalleIva(tx, rango), periodo: `${rango.desde}_a_${rango.hasta}` };
  },

  // ---- Estados financieros NIIF para las PYMES (A10) ----
  'estado-situacion-financiera': async (tx, sp) => {
    const fechaCorte = fechaRequerida(sp, 'fechaCorte');
    const fechaCorteComparativa = fechaOpcional(sp, 'fechaCorteComparativa');
    const workbook = await generarEstadoSituacionFinanciera(tx, { fechaCorte, fechaCorteComparativa });
    return { workbook, periodo: fechaCorte };
  },
  'estado-resultado-integral': async (tx, sp) => {
    const rango = rangoFechas(sp);
    const presentacion = presentacionOpcional(sp);
    const comparativoDesde = fechaOpcional(sp, 'comparativoDesde');
    const comparativoHasta = fechaOpcional(sp, 'comparativoHasta');
    if (Boolean(comparativoDesde) !== Boolean(comparativoHasta)) {
      throw new ParametroReporteInvalidoError(
        'Para el comparativo del ERI indique "comparativoDesde" y "comparativoHasta" juntos, o ninguno.',
      );
    }
    const comparativo = comparativoDesde && comparativoHasta ? { desde: comparativoDesde, hasta: comparativoHasta } : null;
    const workbook = await generarEstadoResultadoIntegral(tx, { ...rango, presentacion, comparativo });
    return { workbook, periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'estado-cambios-patrimonio': async (tx, sp) => {
    const rango = rangoFechas(sp);
    return { workbook: await generarEstadoCambiosPatrimonio(tx, rango), periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'estado-flujos-efectivo': async (tx, sp) => {
    const rango = rangoFechas(sp);
    return { workbook: await generarEstadoFlujosEfectivo(tx, rango), periodo: `${rango.desde}_a_${rango.hasta}` };
  },
  'notas-estados-financieros': async (tx, sp) => {
    const rango = rangoFechas(sp);
    const presentacion = presentacionOpcional(sp);
    const workbook = await generarNotasEstadosFinancieros(tx, { ...rango, presentacion });
    return { workbook, periodo: `${rango.desde}_a_${rango.hasta}` };
  },

  // ---- Información exógena (A11) ----
  'exogena-1001': async (tx, sp) => {
    const rango = rangoExogena(sp);
    const { workbook } = await generarFormato1001(tx, rango);
    return { workbook, periodo: `AG${rango.anioGravable}` };
  },
  'exogena-1003': async (tx, sp) => {
    const rango = rangoExogena(sp);
    const { workbook } = await generarFormato1003(tx, rango);
    return { workbook, periodo: `AG${rango.anioGravable}` };
  },
  'exogena-1005': async (tx, sp) => {
    const rango = rangoExogena(sp);
    const { workbook } = await generarFormato1005(tx, rango);
    return { workbook, periodo: `AG${rango.anioGravable}` };
  },
  'exogena-1006': async (tx, sp) => {
    const rango = rangoExogena(sp);
    const { workbook } = await generarFormato1006(tx, rango);
    return { workbook, periodo: `AG${rango.anioGravable}` };
  },
  'exogena-1007': async (tx, sp) => {
    const rango = rangoExogena(sp);
    const { workbook } = await generarFormato1007(tx, rango);
    return { workbook, periodo: `AG${rango.anioGravable}` };
  },
  'exogena-1008': async (tx, sp) => {
    const fechaCorte = fechaRequerida(sp, 'fechaCorte');
    const anioGravable = enteroRequerido(sp, 'anioGravable', 2000, 2100);
    const { workbook } = await generarFormato1008(tx, fechaCorte, anioGravable);
    return { workbook, periodo: `AG${anioGravable}_corte_${fechaCorte}` };
  },
  'exogena-1009': async (tx, sp) => {
    const fechaCorte = fechaRequerida(sp, 'fechaCorte');
    const anioGravable = enteroRequerido(sp, 'anioGravable', 2000, 2100);
    const { workbook } = await generarFormato1009(tx, fechaCorte, anioGravable);
    return { workbook, periodo: `AG${anioGravable}_corte_${fechaCorte}` };
  },
};

// =============================================================================
// Nombre de archivo: razón social + NIT salen del propio libro generado
// (hoja "Papel de trabajo", filas 2 y 3 — ver `src/reports/excel.ts`), nunca
// de un parámetro de la petición.
// =============================================================================

function segmentoArchivo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function nombreDeArchivo(workbook: ExcelJS.Workbook, slug: string, periodo: string): string {
  const hoja = workbook.getWorksheet('Papel de trabajo');
  const razonSocialCruda = hoja?.getRow(2).getCell(1).value;
  const nitCrudo = hoja?.getRow(3).getCell(1).value;
  const razonSocial = typeof razonSocialCruda === 'string' && razonSocialCruda ? razonSocialCruda : 'empresa';
  const nit =
    typeof nitCrudo === 'string' ? nitCrudo.replace(/^NIT:\s*/i, '') : '';
  const partes = [segmentoArchivo(razonSocial), nit ? segmentoArchivo(nit) : null, slug, segmentoArchivo(periodo)].filter(
    (p): p is string => Boolean(p),
  );
  return `${partes.join('_')}.xlsx`;
}

function respuestaError(status: number, motivo: string, detalle: string): Response {
  return Response.json({ ok: false, motivo, detalle }, { status });
}

export async function GET(request: Request, ctx: { params: Promise<{ libro: string }> }): Promise<Response> {
  const { libro } = await ctx.params;
  // `Object.hasOwn` y no `REPORTES[libro]` a secas (hallazgo de A14, V-19):
  // con el acceso directo, un slug que sea una clave del PROTOTIPO de Object
  // (`__proto__`, `constructor`, `toString`...) devuelve algo truthy que no es
  // un generador, se salta este 404 y revienta más abajo con un 500 que expone
  // un mensaje interno. Un catálogo de rutas se consulta por clave PROPIA.
  const generar = Object.hasOwn(REPORTES, libro) ? REPORTES[libro] : undefined;
  if (!generar) {
    return respuestaError(
      404,
      'reporte_desconocido',
      `No existe el reporte "${libro}". Reportes disponibles: ${Object.keys(REPORTES).sort().join(', ')}.`,
    );
  }

  const sp = new URL(request.url).searchParams;

  try {
    const { workbook, periodo } = await conSesion(async (tx) => {
      const resultado = await generar(tx, sp);
      // Rastro EXPORT de la sección 14.1 (A12, migración 140). Va DENTRO de la
      // misma transacción y de la misma sesión verificada que autorizó la
      // lectura: si el rastro no se puede escribir, el archivo no se entrega.
      // Descargar el libro mayor completo de una empresa es una extracción en
      // bloque de datos contables, y hasta hoy no dejaba huella de ningún tipo.
      await tx.query('SELECT app.registrar_exportacion($1, $2::jsonb)', [
        libro,
        JSON.stringify({ periodo: resultado.periodo, parametros: Object.fromEntries(sp) }),
      ]);
      return resultado;
    });
    const buffer = await libroABuffer(workbook);
    const nombreArchivo = nombreDeArchivo(workbook, libro, periodo);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    if (error instanceof EmpresaNoAutorizadaError) {
      return respuestaError(403, 'empresa_no_autorizada', error.message);
    }
    if (error instanceof PermisoInsuficienteError) {
      return respuestaError(403, 'permiso_insuficiente', error.message);
    }
    if (error instanceof ParametroReporteInvalidoError) {
      return respuestaError(400, 'parametro_invalido', error.message);
    }
    return respuestaError(500, 'error', error instanceof Error ? error.message : String(error));
  }
}

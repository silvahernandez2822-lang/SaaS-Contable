'use server';

/**
 * A8 — D-088 · TAREA 3. Acciones de servidor de la parametrización de ICA por
 * municipio. Mismo flujo de dos pasos que el resto de `/parametros`:
 * `simular*` solo mide el impacto, `confirmar*` es la única que escribe y exige
 * el testigo del paso 1 (V-39).
 *
 * Tres cosas se editan aquí, cada una con su simulador bloqueante:
 *   · la regla del municipio (bases mínimas + tipo de medición + periodo)
 *     → `editarMunicipioIcaRule`, impacto por `simularImpactoMunicipioIca`.
 *   · una tarifa por actividad (incluida la marca gravada/no gravada)
 *     → `editarTarifaTaxRule` / `crearOReemplazarTaxRule`, impacto por
 *       `simularImpactoTarifa` sobre el concepto de ReteICA.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import {
  editarMunicipioIcaRule,
  editarTarifaTaxRule,
  exigirTestigoImpacto,
  simularImpactoMunicipioIca,
  simularImpactoTarifa,
  EdicionRetroactivaError,
  ImpactoNoSimuladoError,
  NormaDeRespaldoRequeridaError,
  ParametroNoEncontradoError,
  VigenciaInvalidaError,
} from '../../../src/services/parametrizacion';
import { crearOReemplazarTaxRule, resolverTaxConcept } from '../../../src/services/catalogos';
import {
  importarIcaMunicipio,
  ArchivoIlegibleError,
  CargaIcaRechazadaError,
  type ResultadoCargaIca,
} from '../../../src/services/carga-masiva/ica-municipio';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

const BASE = '/parametros/ica-municipios';
const CONCEPTO_RETEICA = 'reteica_tarifa_general_municipio';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function mensajeDeError(e: unknown): string {
  if (
    e instanceof EdicionRetroactivaError ||
    e instanceof ImpactoNoSimuladoError ||
    e instanceof NormaDeRespaldoRequeridaError ||
    e instanceof VigenciaInvalidaError ||
    e instanceof ParametroNoEncontradoError
  ) {
    return e.message;
  }
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para editar parámetros tributarios (se requiere administrador tributario).';
  }
  if (isPostgresError(e) && e.code === SQLSTATE.CHECK_VIOLATION) {
    return 'La combinación no cumple una restricción del esquema (por ejemplo, actividad no gravada con tarifa distinta de cero).';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando el parámetro.';
}

// =============================================================================
// REGLA DEL MUNICIPIO (bases mínimas, tipo de medición, periodo)
// =============================================================================

function camposBase(fd: FormData) {
  return {
    reglaAnteriorId: leer(fd, 'reglaAnteriorId'),
    baseMinimaComprasUvt: leer(fd, 'baseMinimaComprasUvt'),
    baseMinimaServiciosUvt: leer(fd, 'baseMinimaServiciosUvt'),
    tipoMedicionBaseMinima: leer(fd, 'tipoMedicionBaseMinima') || 'por_factura',
    periodoMeses: leer(fd, 'periodoMeses'),
    periodicidad: leer(fd, 'periodicidad') || 'mensual',
    practicaReteica: leer(fd, 'practicaReteica') || 'true',
    usaTarifaDeActividad: leer(fd, 'usaTarifaDeActividad') || 'true',
    vigenteDesde: leer(fd, 'vigenteDesde'),
    normaRespaldo: leer(fd, 'normaRespaldo'),
    alcanceNuevo: leer(fd, 'alcanceNuevo') || 'firma',
  };
}

export async function simularBaseAction(formData: FormData): Promise<void> {
  const municipalityId = leer(formData, 'municipalityId');
  const campos = camposBase(formData);
  let destino: string;
  try {
    const impacto = await conSesion((tx) => simularImpactoMunicipioIca(tx, municipalityId));
    destino = `${BASE}?${new URLSearchParams({
      municipio: municipalityId,
      editar: '1',
      confirmar: '1',
      municipalityId,
      ...campos,
      conceptos: String(impacto.conceptosAfectados),
      proveedores: String(impacto.proveedoresAfectados),
    }).toString()}`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({
      municipio: municipalityId,
      editar: '1',
      error: mensajeDeError(e),
    }).toString()}`;
  }
  redirect(destino);
}

export async function confirmarBaseAction(formData: FormData): Promise<void> {
  const municipalityId = leer(formData, 'municipalityId');
  const campos = camposBase(formData);
  let destino: string;
  try {
    const testigo = { conceptos: leer(formData, 'conceptos'), proveedores: leer(formData, 'proveedores') };
    await conSesion(async (tx) => {
      exigirTestigoImpacto(testigo, await simularImpactoMunicipioIca(tx, municipalityId));
      return editarMunicipioIcaRule(tx, {
        municipalityId,
        reglaAnteriorId: campos.reglaAnteriorId || null,
        practicaReteica: campos.practicaReteica === 'true',
        baseMinimaComprasUvt: campos.baseMinimaComprasUvt || null,
        baseMinimaServiciosUvt: campos.baseMinimaServiciosUvt || null,
        usaTarifaDeActividad: campos.usaTarifaDeActividad === 'true',
        tarifaGeneral: null,
        periodicidad: campos.periodicidad as 'mensual' | 'bimestral' | 'trimestral' | 'cuatrimestral' | 'anual',
        tipoMedicionBaseMinima: campos.tipoMedicionBaseMinima === 'por_periodo' ? 'por_periodo' : 'por_factura',
        periodoMeses: campos.periodoMeses ? Number(campos.periodoMeses) : null,
        vigenteDesde: campos.vigenteDesde,
        normaRespaldo: campos.normaRespaldo,
        alcanceNuevo: campos.alcanceNuevo === 'empresa' ? 'empresa' : 'firma',
      });
    });
    destino = `${BASE}?municipio=${municipalityId}&ok=1`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({
      municipio: municipalityId,
      editar: '1',
      confirmar: '1',
      municipalityId,
      ...campos,
      error: mensajeDeError(e),
    }).toString()}`;
  }
  redirect(destino);
}

// =============================================================================
// TARIFA POR ACTIVIDAD (editar existente o crear nueva) + marca gravada
// =============================================================================

function camposActividad(fd: FormData) {
  return {
    reglaAnteriorId: leer(fd, 'reglaAnteriorId'),
    municipioDane: leer(fd, 'municipioDane'),
    ciiuCodigo: leer(fd, 'ciiuCodigo'),
    gravada: leer(fd, 'gravada') === 'true' ? 'true' : 'false',
    tarifaPorMil: leer(fd, 'tarifaPorMil'),
    vigenteDesde: leer(fd, 'vigenteDesde'),
    normaRespaldo: leer(fd, 'normaRespaldo'),
    alcanceNuevo: leer(fd, 'alcanceNuevo') || 'firma',
  };
}

/** Tarifa "por mil" → fracción para `tax_rule.tarifa`. Si no está gravada, 0. */
function fraccionDe(campos: { gravada: string; tarifaPorMil: string }): string {
  if (campos.gravada !== 'true') return '0';
  const n = Number(campos.tarifaPorMil.replace(',', '.'));
  return (n / 1000).toFixed(6);
}

export async function simularActividadAction(formData: FormData): Promise<void> {
  const municipalityId = leer(formData, 'municipalityId');
  const taxConceptId = leer(formData, 'taxConceptId');
  const campos = camposActividad(formData);
  let destino: string;
  try {
    const impacto = await conSesion(async (tx) => {
      const conceptoId = taxConceptId || (await resolverTaxConcept(tx, 'reteica', CONCEPTO_RETEICA));
      if (!conceptoId) throw new VigenciaInvalidaError('No existe el concepto de ReteICA de municipio.');
      return simularImpactoTarifa(tx, conceptoId);
    });
    destino = `${BASE}?${new URLSearchParams({
      municipio: municipalityId,
      ...(campos.reglaAnteriorId ? { editarActividad: campos.reglaAnteriorId } : { nuevaActividad: '1' }),
      confirmarActividad: '1',
      municipalityId,
      taxConceptId,
      ...campos,
      conceptos: String(impacto.conceptosAfectados),
      proveedores: String(impacto.proveedoresAfectados),
    }).toString()}`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({
      municipio: municipalityId,
      error: mensajeDeError(e),
    }).toString()}`;
  }
  redirect(destino);
}

export async function confirmarActividadAction(formData: FormData): Promise<void> {
  const municipalityId = leer(formData, 'municipalityId');
  const taxConceptId = leer(formData, 'taxConceptId');
  const campos = camposActividad(formData);
  let destino: string;
  try {
    const testigo = { conceptos: leer(formData, 'conceptos'), proveedores: leer(formData, 'proveedores') };
    const gravada = campos.gravada === 'true';
    const tarifa = fraccionDe(campos);
    await conSesion(async (tx) => {
      const conceptoId = taxConceptId || (await resolverTaxConcept(tx, 'reteica', CONCEPTO_RETEICA));
      if (!conceptoId) throw new VigenciaInvalidaError('No existe el concepto de ReteICA de municipio.');
      exigirTestigoImpacto(testigo, await simularImpactoTarifa(tx, conceptoId));
      if (campos.reglaAnteriorId) {
        return editarTarifaTaxRule(tx, {
          reglaAnteriorId: campos.reglaAnteriorId,
          tarifa,
          gravada,
          vigenteDesde: campos.vigenteDesde,
          normaRespaldo: campos.normaRespaldo,
          alcanceNuevo: campos.alcanceNuevo === 'empresa' ? 'empresa' : 'firma',
        });
      }
      return crearOReemplazarTaxRule(tx, {
        tipo: 'reteica',
        conceptoCodigo: CONCEPTO_RETEICA,
        tarifa,
        gravada,
        municipioDane: campos.municipioDane,
        ciiuCodigo: campos.ciiuCodigo,
        vigenteDesde: campos.vigenteDesde,
        normaRespaldo: campos.normaRespaldo,
        alcance: campos.alcanceNuevo === 'empresa' ? 'empresa' : 'firma',
      });
    });
    destino = `${BASE}?municipio=${municipalityId}&ok=1`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({
      municipio: municipalityId,
      ...(campos.reglaAnteriorId ? { editarActividad: campos.reglaAnteriorId } : { nuevaActividad: '1' }),
      confirmarActividad: '1',
      municipalityId,
      taxConceptId,
      ...campos,
      error: mensajeDeError(e),
    }).toString()}`;
  }
  redirect(destino);
}

// =============================================================================
// CARGA MASIVA — un archivo = un municipio completo (D-088 · TAREA 4)
// =============================================================================

export interface EstadoCargaIca {
  ok: boolean;
  mensaje: string;
  resultado: ResultadoCargaIca | null;
}

const TAMANO_MAXIMO = 8 * 1024 * 1024;

export async function cargarIcaMunicipioAction(
  _previo: EstadoCargaIca | null,
  formData: FormData,
): Promise<EstadoCargaIca> {
  const archivo = formData.get('archivo');
  const vigenteDesde = leer(formData, 'vigenteDesde');
  const normaRespaldo = leer(formData, 'normaRespaldo');
  const periodicidad = (leer(formData, 'periodicidad') || 'mensual') as
    | 'mensual'
    | 'bimestral'
    | 'trimestral'
    | 'cuatrimestral'
    | 'anual';
  const alcance = leer(formData, 'alcance') === 'empresa' ? 'empresa' : 'firma';

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, mensaje: 'Adjunte el archivo .xlsx del municipio.', resultado: null };
  }
  if (archivo.size > TAMANO_MAXIMO) {
    return { ok: false, mensaje: 'El archivo supera los 8 MB.', resultado: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde) || !normaRespaldo) {
    return {
      ok: false,
      mensaje: 'La fecha de vigencia y la norma de respaldo son obligatorias (no van en el archivo).',
      resultado: null,
    };
  }

  const contenido = new Uint8Array(await archivo.arrayBuffer());
  try {
    const resultado = await conSesion((tx) =>
      importarIcaMunicipio(tx, archivo.name, contenido, {
        vigenteDesde,
        normaRespaldo,
        periodicidad,
        alcance,
      }),
    );
    return {
      ok: true,
      mensaje:
        `Municipio ${resultado.municipioDane}: se cargaron ${resultado.filasInsertadas} actividades. ` +
        (resultado.filasConError > 0
          ? `${resultado.filasConError} fila(s) quedaron sin cargar (ver detalle).`
          : ''),
      resultado,
    };
  } catch (e) {
    if (e instanceof CargaIcaRechazadaError) {
      return {
        ok: false,
        mensaje: 'No se cargó nada: revise los errores del archivo.',
        resultado: e.resultado,
      };
    }
    if (e instanceof ArchivoIlegibleError) {
      return { ok: false, mensaje: e.message, resultado: null };
    }
    console.error('[ica-municipios] carga masiva', e);
    return {
      ok: false,
      mensaje: mensajeDeError(e) + ' No se guardó nada.',
      resultado: null,
    };
  }
}

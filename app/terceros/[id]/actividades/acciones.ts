'use server';

/**
 * A8 — Registrar (o versionar) la actividad económica de un tercero en un
 * municipio (ReteICA multimunicipio, casos dorados 9 y 10). Mismo flujo de
 * dos pasos que atributos fiscales.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../../lib/sesion';
import {
  registrarActividad,
  simularImpactoActividad,
  AtributoFiscalIncompletoError,
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  TerceroNoEncontradoError,
  VigenciaInvalidaError,
} from '../../../../src/services/terceros';
import { isPostgresError, SQLSTATE } from '../../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function leerBandera(fd: FormData, campo: string): boolean | undefined {
  const v = leer(fd, campo);
  if (v === 'si') return true;
  if (v === 'no') return false;
  return undefined;
}

function mensajeDeError(e: unknown): string {
  if (
    e instanceof AtributoFiscalIncompletoError ||
    e instanceof EdicionRetroactivaError ||
    e instanceof NormaDeRespaldoRequeridaError ||
    e instanceof TerceroNoEncontradoError ||
    e instanceof VigenciaInvalidaError
  ) {
    return e.message;
  }
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para editar actividades de terceros (se requiere "tercero.atributos_fiscales"; y "parametro.editar" si fija una tarifa de ICA propia).';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando la actividad.';
}

function base(terceroId: string): string {
  return `/terceros/${terceroId}/actividades`;
}

export async function simularAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  const campos = {
    municipalityId: leer(formData, 'municipalityId'),
    ciiuActivityId: leer(formData, 'ciiuActivityId'),
    tarifaIcaOverride: leer(formData, 'tarifaIcaOverride'),
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    notas: leer(formData, 'notas'),
  };
  const esPrincipal = leerBandera(formData, 'esPrincipal');

  let destino: string;
  try {
    if (esPrincipal === undefined) throw new AtributoFiscalIncompletoError('es la actividad principal en este municipio');
    if (!campos.municipalityId) throw new VigenciaInvalidaError('Debe seleccionar un municipio.');
    if (!campos.ciiuActivityId) throw new VigenciaInvalidaError('Debe seleccionar una actividad CIIU.');

    const impacto = await conSesion((tx) => simularImpactoActividad(tx, terceroId, campos.municipalityId));
    const qs = new URLSearchParams({
      confirmar: '1',
      terceroId,
      esPrincipal: esPrincipal ? 'si' : 'no',
      ...campos,
      documentosPendientes: String(impacto.documentosPendientes),
      asientosPublicados: String(impacto.asientosPublicados),
    });
    destino = `${base(terceroId)}?${qs.toString()}`;
  } catch (e) {
    destino = `${base(terceroId)}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

export async function confirmarAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  const campos = {
    municipalityId: leer(formData, 'municipalityId'),
    ciiuActivityId: leer(formData, 'ciiuActivityId'),
    tarifaIcaOverride: leer(formData, 'tarifaIcaOverride'),
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    notas: leer(formData, 'notas'),
  };
  const esPrincipal = leerBandera(formData, 'esPrincipal');

  let destino: string;
  try {
    await conSesion((tx) =>
      registrarActividad(tx, {
        terceroId,
        municipalityId: campos.municipalityId,
        ciiuActivityId: campos.ciiuActivityId,
        esPrincipal,
        tarifaIcaOverride: campos.tarifaIcaOverride || null,
        vigenteDesde: campos.vigenteDesde,
        normaRespaldo: campos.normaRespaldo,
        notas: campos.notas || null,
      }),
    );
    destino = `/terceros/${terceroId}?ok=1`;
  } catch (e) {
    destino = `${base(terceroId)}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

'use server';

/**
 * A8 — Editar los datos generales (NO versionados) de un tercero ya creado.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import {
  editarTercero,
  TerceroInvalidoError,
  TerceroNoEncontradoError,
  type TipoDocumentoTercero,
} from '../../../src/services/terceros';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function mensajeDeError(e: unknown): string {
  if (e instanceof TerceroInvalidoError || e instanceof TerceroNoEncontradoError) return e.message;
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para editar terceros (se requiere el permiso "tercero.editar").';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando el tercero.';
}

export async function editarDatosAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  const esDelExterior = leer(formData, 'esDelExterior') === 'true';

  let destino: string;
  try {
    await conSesion((tx) =>
      editarTercero(tx, terceroId, {
        tipoDocumento: (leer(formData, 'tipoDocumento') || 'NIT') as TipoDocumentoTercero,
        numeroDocumento: leer(formData, 'numeroDocumento'),
        digitoVerificacion: leer(formData, 'digitoVerificacion') ? Number(leer(formData, 'digitoVerificacion')) : null,
        tipoPersona: (leer(formData, 'tipoPersona') || 'juridica') as 'natural' | 'juridica',
        razonSocial: leer(formData, 'razonSocial'),
        direccion: esDelExterior ? null : leer(formData, 'direccion'),
        municipalityId: esDelExterior ? null : leer(formData, 'municipalityId') || null,
        pais: esDelExterior ? leer(formData, 'pais') || 'CO' : 'CO',
        esDelExterior,
        email: leer(formData, 'email') || null,
        telefono: leer(formData, 'telefono') || null,
      }),
    );
    destino = `/terceros/${terceroId}?ok=1`;
  } catch (e) {
    destino = `/terceros/${terceroId}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

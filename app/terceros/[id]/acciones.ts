'use server';

/**
 * A8 — Editar los datos generales (NO versionados) de un tercero ya creado.
 *
 * D-084 · TAREA 1 — acciones de ELIMINAR / INACTIVAR / REACTIVAR. Eliminar solo
 * procede si el tercero nunca tuvo movimientos; el motor lo impone con el
 * trigger `third_party_restrict_delete` (SQLSTATE `TP001`) y el servicio lo
 * comprueba antes. Si tiene movimientos, el único camino es inactivarlo.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import {
  DireccionDianInvalidaError,
  editarTercero,
  eliminarTercero,
  fijarActivoTercero,
  TerceroConMovimientosError,
  TerceroInvalidoError,
  TerceroNoEncontradoError,
  type DireccionDian,
  type TipoDocumentoTercero,
} from '../../../src/services/terceros';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function leerDireccionDian(fd: FormData): DireccionDian | null {
  const crudo = leer(fd, 'direccionDian');
  if (!crudo) return null;
  try {
    return JSON.parse(crudo) as DireccionDian;
  } catch {
    return null;
  }
}

function mensajeDeError(e: unknown): string {
  if (e instanceof DireccionDianInvalidaError) return `Dirección DIAN: ${e.errores.join(' · ')}`;
  if (
    e instanceof TerceroInvalidoError ||
    e instanceof TerceroNoEncontradoError ||
    e instanceof TerceroConMovimientosError
  ) {
    return e.message;
  }
  if (isPostgresError(e) && e.code === SQLSTATE.TERCERO_CON_MOVIMIENTOS) {
    return 'El tercero ya tiene movimientos asociados: no se puede borrar, solo inactivar.';
  }
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para editar terceros (se requiere el permiso "tercero.editar").';
  }
  if (isPostgresError(e) && e.code === SQLSTATE.FOREIGN_KEY_VIOLATION) {
    return 'El tercero tiene datos dependientes y no se puede borrar. Inactívelo en su lugar.';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado con el tercero.';
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
        direccionDian: esDelExterior ? null : leerDireccionDian(formData),
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

export async function eliminarTerceroAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  let destino: string;
  try {
    await conSesion((tx) => eliminarTercero(tx, terceroId));
    destino = `/terceros?eliminado=1`;
  } catch (e) {
    destino = `/terceros/${terceroId}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

export async function inactivarTerceroAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  let destino: string;
  try {
    await conSesion((tx) => fijarActivoTercero(tx, terceroId, false));
    destino = `/terceros?inactivado=1`;
  } catch (e) {
    destino = `/terceros/${terceroId}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

export async function reactivarTerceroAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  let destino: string;
  try {
    await conSesion((tx) => fijarActivoTercero(tx, terceroId, true));
    destino = `/terceros/${terceroId}?ok=1`;
  } catch (e) {
    destino = `/terceros/${terceroId}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

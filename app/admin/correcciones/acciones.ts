'use server';

/**
 * A16 — Revisión de correcciones pendientes (Ola 4, Tarea 7, D-068).
 *
 * El permiso `documento.aprobar_correccion` NO se comprueba aquí: lo exige el
 * trigger `document_correction_revision` (migración 170) sobre el UPDATE del
 * estado. Así, cualquier camino futuro que escriba en esa tabla —otro servicio,
 * una tarea programada, un `psql`— topa con la misma puerta.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import { revisarCorreccion, AdministracionInvalidaError } from '../../../src/services/administracion';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function mensajeDeError(e: unknown): string {
  if (e instanceof AdministracionInvalidaError) return e.message;
  if (isPostgresError(e)) {
    if (e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
      return 'Su sesión no tiene el permiso "documento.aprobar_correccion": es justo el que separa a quien corrige de quien aprueba.';
    }
    if (e.code === 'RL002') {
      return `El motor rechazó la revisión: ${e.message}`;
    }
  }
  console.error('[admin/correcciones] fallo técnico', e);
  return 'La revisión falló por un problema técnico y no se guardó nada. El detalle quedó en el registro del servidor.';
}

export async function revisarAction(formData: FormData): Promise<void> {
  const decision = leer(formData, 'decision') === 'aprobado' ? 'aprobado' : 'rechazado';
  let destino: string;
  try {
    await conSesion((tx) => revisarCorreccion(tx, leer(formData, 'correccionId'), decision, leer(formData, 'motivo')));
    destino =
      '/admin/correcciones?ok=' +
      encodeURIComponent(
        decision === 'aprobado'
          ? 'Corrección aprobada. El motor la usará la próxima vez que se cause ese documento; si ya estaba causado, hay que reprocesarlo desde la bandeja.'
          : 'Corrección rechazada. Queda registrada con su motivo: no se borra nada.',
      );
  } catch (e) {
    destino = '/admin/correcciones?error=' + encodeURIComponent(mensajeDeError(e));
  }
  redirect(destino);
}

/**
 * A16 — Traducción de los errores de administración a un mensaje que se pueda
 * leer (Ola 4, Tarea 7).
 *
 * POR QUÉ ESTÁ EN SU PROPIO ARCHIVO Y NO JUNTO A LAS ACCIONES: un módulo con
 * `'use server'` solo puede exportar funciones asíncronas — todo lo que exporta
 * se convierte en un punto de entrada invocable desde el navegador. Esta
 * función es una utilidad síncrona compartida por las acciones de `/admin/**`,
 * así que vive fuera de esa frontera. (Lo detectó `next build`, no una
 * suposición: exportarla desde el archivo de acciones rompía la compilación.)
 *
 * Criterio de los mensajes, el mismo de D-073 para los reportes: lo que el
 * usuario puede arreglar se le dice con nombre y apellido; el fallo técnico se
 * le resume y el detalle va al registro del servidor.
 */
import {
  AdministracionInvalidaError,
  RolBlindadoError,
  RolNoEncontradoError,
  UsuarioNoEncontradoError,
} from '../../src/services/administracion';
import { PasswordDebilError } from '../../src/auth/password';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import { isPostgresError, SQLSTATE } from '../../src/db/types';

export function mensajeDeError(e: unknown): string {
  if (
    e instanceof AdministracionInvalidaError ||
    e instanceof RolBlindadoError ||
    e instanceof RolNoEncontradoError ||
    e instanceof UsuarioNoEncontradoError ||
    e instanceof PasswordDebilError ||
    e instanceof PermisoInsuficienteError
  ) {
    return e.message;
  }
  if (isPostgresError(e)) {
    if (e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
      return 'Su sesión no tiene el permiso "usuario.administrar": es el que el motor exige para tocar usuarios, roles y accesos.';
    }
    if (e.code === 'RL001') {
      return `El motor rechazó la operación por el blindaje del rol todopoderoso: ${e.message}`;
    }
    if (e.code === SQLSTATE.UNIQUE_VIOLATION) {
      return 'Ya existe un registro con esos datos (correo o código de rol repetido).';
    }
    if (e.code === SQLSTATE.FK_ALCANCE_AJENO) {
      return 'Ese rol o esa empresa pertenecen a otra firma. No se otorgó nada.';
    }
  }
  console.error('[admin] fallo técnico', e);
  return 'La operación falló por un problema técnico y no se guardó nada. El detalle quedó en el registro del servidor.';
}

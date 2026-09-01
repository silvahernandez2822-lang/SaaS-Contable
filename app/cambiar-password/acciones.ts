'use server';

/**
 * A16 — Cambiar la propia contraseña (Ola 4, D-069).
 *
 * Usa `conSesionEmpresa('')` —sesión de firma, sin empresa— a propósito: un
 * usuario recién creado todavía no tiene acceso a ninguna empresa, y si esta
 * acción exigiera una, la persona a la que MÁS le urge cambiar la contraseña
 * sería justo la que no podría hacerlo.
 *
 * Ni la contraseña actual ni la nueva viajan en ninguna URL: la acción redirige
 * con un mensaje, nunca con un secreto.
 */
import { redirect } from 'next/navigation';
import { conSesionEmpresa } from '../lib/sesion';
import { cambiarMiPassword, AdministracionInvalidaError } from '../../src/services/administracion';
import { PasswordDebilError } from '../../src/auth/password';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v : '';
}

export async function cambiarMiPasswordAction(formData: FormData): Promise<void> {
  const actual = leer(formData, 'actual');
  const nueva = leer(formData, 'nueva');
  const repetida = leer(formData, 'repetida');

  let destino: string;
  try {
    if (nueva !== repetida) {
      throw new AdministracionInvalidaError('Las dos contraseñas nuevas no coinciden.');
    }
    await conSesionEmpresa('', (tx) => cambiarMiPassword(tx, actual, nueva));
    destino = '/?ok=' + encodeURIComponent('Contraseña cambiada.');
  } catch (e) {
    const mensaje =
      e instanceof AdministracionInvalidaError || e instanceof PasswordDebilError
        ? e.message
        : (() => {
            console.error('[cambiar-password] fallo técnico', e);
            return 'No se pudo cambiar la contraseña por un problema técnico. No se cambió nada.';
          })();
    destino = '/cambiar-password?error=' + encodeURIComponent(mensaje);
  }
  redirect(destino);
}

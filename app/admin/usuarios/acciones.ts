'use server';

/**
 * A16 — Acciones de administración de usuarios (Ola 4, Tarea 7).
 *
 * POR QUÉ LAS DOS ACCIONES QUE DEVUELVEN CONTRASEÑA NO REDIRIGEN CON LA
 * CONTRASEÑA EN LA URL. El resto de `app/**` usa el patrón «redirect con
 * ?ok=…», que aquí sería un error de seguridad de libro: una contraseña en la
 * barra de direcciones queda en el historial del navegador, en el registro de
 * accesos del proxy y en la cabecera `Referer` de la siguiente petición. Esas
 * dos acciones son de estado (`useActionState`) y devuelven la contraseña en el
 * CUERPO de la respuesta, que se pinta una vez y no queda en ninguna parte.
 *
 * Ninguna de estas acciones autoriza nada: `usuario.administrar` lo exige el
 * trigger `user_permiso` de la migración 016 y lo vuelve a exigir cada función
 * de `src/services/administracion.ts` para dar un mensaje claro (D-025).
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import {
  asignarRol,
  cambiarEstadoUsuario,
  crearUsuario,
  fijarPasswordDeUsuario,
  forzarRestablecimiento,
  revocarAcceso,
} from '../../../src/services/administracion';
import { mensajeDeError } from '../_errores';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function destino(parametros: Record<string, string>): string {
  return `/admin/usuarios?${new URLSearchParams(parametros).toString()}`;
}

// =============================================================================
// Acciones con estado: devuelven la contraseña UNA vez, en el cuerpo.
// =============================================================================

export interface EstadoAdmin {
  ok: boolean;
  mensaje: string;
  /** Solo cuando la generó el sistema. Se enseña una vez y no se vuelve a ver. */
  passwordGenerada: string | null;
}

export async function crearUsuarioAction(
  _previo: EstadoAdmin | null,
  formData: FormData,
): Promise<EstadoAdmin> {
  try {
    const companyId = leer(formData, 'companyId');
    const roleId = leer(formData, 'roleId');
    const { passwordGenerada } = await conSesion((tx) =>
      crearUsuario(tx, {
        email: leer(formData, 'email'),
        nombreCompleto: leer(formData, 'nombreCompleto'),
        documento: leer(formData, 'documento') || null,
        password: leer(formData, 'password') || null,
        companyId: companyId || null,
        roleId: roleId || null,
      }),
    );
    return {
      ok: true,
      mensaje:
        `Usuario creado. Tendrá que cambiar la contraseña la primera vez que entre: quien se la fija la ` +
        'conoce, y una contraseña conocida por dos personas no identifica a ninguna.',
      passwordGenerada,
    };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e), passwordGenerada: null };
  }
}

export async function fijarPasswordAction(
  _previo: EstadoAdmin | null,
  formData: FormData,
): Promise<EstadoAdmin> {
  try {
    const userId = leer(formData, 'userId');
    const { passwordGenerada } = await conSesion((tx) =>
      fijarPasswordDeUsuario(tx, userId, leer(formData, 'password') || null),
    );
    return {
      ok: true,
      mensaje:
        'Contraseña cambiada. Se cerraron todas las sesiones abiertas de ese usuario y tendrá que cambiarla ' +
        'al entrar.',
      passwordGenerada,
    };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e), passwordGenerada: null };
  }
}

// =============================================================================
// Acciones sin secreto: patrón habitual de redirect con mensaje.
// =============================================================================

export async function cambiarEstadoAction(formData: FormData): Promise<void> {
  const estadoPedido = leer(formData, 'estado');
  let a: string;
  try {
    const estado = estadoPedido === 'activo' ? 'activo' : estadoPedido === 'suspendido' ? 'suspendido' : 'inactivo';
    await conSesion((tx) => cambiarEstadoUsuario(tx, leer(formData, 'userId'), estado));
    a = destino({
      ok:
        estado === 'activo'
          ? 'Usuario reactivado.'
          : 'Usuario inactivado y sus sesiones abiertas revocadas. No se borró nada: sigue en la auditoría.',
    });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

export async function forzarRestablecimientoAction(formData: FormData): Promise<void> {
  let a: string;
  try {
    await conSesion((tx) => forzarRestablecimiento(tx, leer(formData, 'userId')));
    a = destino({
      ok: 'Se cerraron sus sesiones y se le exigirá cambiar la contraseña al entrar.',
    });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

export async function asignarRolAction(formData: FormData): Promise<void> {
  let a: string;
  try {
    await conSesion((tx) =>
      asignarRol(tx, {
        userId: leer(formData, 'userId'),
        companyId: leer(formData, 'companyId'),
        roleId: leer(formData, 'roleId'),
      }),
    );
    a = destino({ ok: 'Rol otorgado sobre esa empresa.' });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

export async function revocarAccesoAction(formData: FormData): Promise<void> {
  let a: string;
  try {
    await conSesion((tx) => revocarAcceso(tx, leer(formData, 'accesoId')));
    a = destino({
      ok: 'Acceso revocado. La fila queda con su fecha de revocación: se puede responder quién tenía acceso y cuándo.',
    });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

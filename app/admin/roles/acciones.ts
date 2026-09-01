'use server';

/**
 * A16 — Acciones de roles y permisos (Ola 4, Tarea 7).
 *
 * El conjunto de permisos llega como casillas repetidas `permisos`, así que se
 * lee con `getAll`: lo que NO viene marcado es lo que se quita. Es un reemplazo
 * completo del conjunto, no un parche — y por eso `fijarPermisosDeRol` lo aplica
 * por diferencia, para que el `audit_log` registre solo lo que cambió de verdad.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import { crearRol, editarRol, eliminarRol } from '../../../src/services/administracion';
import { mensajeDeError } from '../_errores';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function permisosDe(fd: FormData): string[] {
  return fd
    .getAll('permisos')
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

function destino(parametros: Record<string, string>): string {
  return `/admin/roles?${new URLSearchParams(parametros).toString()}`;
}

export async function crearRolAction(formData: FormData): Promise<void> {
  let a: string;
  try {
    const { id } = await conSesion((tx) =>
      crearRol(tx, {
        codigo: leer(formData, 'codigo'),
        nombre: leer(formData, 'nombre'),
        descripcion: leer(formData, 'descripcion'),
        permisos: permisosDe(formData),
      }),
    );
    a = destino({ ok: 'Rol creado.', rol: id });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

export async function editarRolAction(formData: FormData): Promise<void> {
  const roleId = leer(formData, 'roleId');
  let a: string;
  try {
    await conSesion((tx) =>
      editarRol(tx, roleId, {
        nombre: leer(formData, 'nombre'),
        descripcion: leer(formData, 'descripcion'),
        activo: leer(formData, 'activo') === 'si',
        permisos: permisosDe(formData),
      }),
    );
    a = destino({ ok: 'Rol actualizado.', rol: roleId });
  } catch (e) {
    a = destino({ error: mensajeDeError(e), rol: roleId });
  }
  redirect(a);
}

export async function eliminarRolAction(formData: FormData): Promise<void> {
  const roleId = leer(formData, 'roleId');
  let a: string;
  try {
    const { borrado, usos } = await conSesion((tx) => eliminarRol(tx, roleId));
    a = destino({
      ok: borrado
        ? 'Rol eliminado: no lo tenía nadie.'
        : `El rol NO se borró porque ${usos} acceso(s) vigente(s) lo usan; se dejó inactivo. Un borrado ` +
          'dejaría a esas personas sin rol de golpe, sin que nadie lo pidiera. Quíteselo primero a quien lo tenga.',
    });
  } catch (e) {
    a = destino({ error: mensajeDeError(e), rol: roleId });
  }
  redirect(a);
}

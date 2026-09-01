'use server';

/**
 * A16 — Acciones del plan de cuentas (Ola 4, Tarea 4).
 *
 * Ninguna de las tres decide nada: `guardarCuenta`, `ocultarCuentaGenerica` y
 * `fijarModoPuc` viven en `src/services/puc.ts` y la autorización la impone el
 * trigger `account_permiso` (`puc.editar`, migración 016). Aquí solo se traduce
 * el `FormData` y el error del motor a un mensaje en la URL, igual que hace el
 * resto de `app/parametros/**`.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import {
  fijarModoPuc,
  guardarCuenta,
  ocultarCuentaGenerica,
  CuentaInvalidaError,
  CuentaNoEncontradaError,
  ContextoSinEmpresaError,
  ModoPucInvalidoError,
} from '../../../src/services/puc';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

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
    e instanceof CuentaInvalidaError ||
    e instanceof CuentaNoEncontradaError ||
    e instanceof ContextoSinEmpresaError ||
    e instanceof ModoPucInvalidoError
  ) {
    return e.message;
  }
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene el permiso "puc.editar", que es el que el motor exige para tocar el plan de cuentas.';
  }
  if (isPostgresError(e) && e.code === SQLSTATE.CHECK_VIOLATION) {
    return `El motor rechazó la cuenta por una restricción del esquema: ${e.message}`;
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando la cuenta.';
}

function destino(parametros: Record<string, string>): string {
  const qs = new URLSearchParams(parametros);
  return `/parametros/puc?${qs.toString()}`;
}

export async function guardarCuentaAction(formData: FormData): Promise<void> {
  const codigo = leer(formData, 'codigo');
  let a: string;
  try {
    const permiteMovimiento = leerBandera(formData, 'permiteMovimiento');
    if (permiteMovimiento === undefined) {
      throw new CuentaInvalidaError(
        'Declare explícitamente si la cuenta admite movimiento (Sí/No). No hay valor por defecto: una cuenta ' +
          'de agrupación marcada por error como imputable deja imputar partidas donde no se debe.',
      );
    }
    const { creada } = await conSesion((tx) =>
      guardarCuenta(tx, {
        codigo,
        nombre: leer(formData, 'nombre'),
        naturaleza: leer(formData, 'naturaleza') === 'credito' ? 'credito' : 'debito',
        permiteMovimiento,
        requiereTercero: leerBandera(formData, 'requiereTercero') ?? false,
        requiereCentroCosto: leerBandera(formData, 'requiereCentroCosto') ?? false,
        requiereBaseGravable: leerBandera(formData, 'requiereBaseGravable') ?? false,
        activo: leerBandera(formData, 'activo') ?? true,
        alcance: leer(formData, 'alcance') === 'firma' ? 'firma' : 'empresa',
      }),
    );
    a = destino({ ok: creada ? `Cuenta ${codigo} creada.` : `Cuenta ${codigo} actualizada.` });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

export async function ocultarCuentaAction(formData: FormData): Promise<void> {
  const codigo = leer(formData, 'codigo');
  let a: string;
  try {
    await conSesion((tx) => ocultarCuentaGenerica(tx, codigo));
    a = destino({
      ok:
        `La cuenta ${codigo} queda oculta para esta empresa. No se borró nada: se creó una cuenta propia con ` +
        'el mismo código marcada como inactiva, y las demás empresas de la firma la siguen viendo.',
    });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

export async function fijarModoPucAction(formData: FormData): Promise<void> {
  const modo = leer(formData, 'modo') === 'solo_propio' ? 'solo_propio' : 'generico';
  let a: string;
  try {
    await conSesion((tx) => fijarModoPuc(tx, modo));
    a = destino({
      ok:
        modo === 'solo_propio'
          ? 'Esta empresa pasa a usar EXCLUSIVAMENTE su propio plan de cuentas. Ya no hereda el genérico.'
          : 'Esta empresa vuelve a heredar el PUC genérico y a sobreescribirlo cuenta por cuenta con el suyo.',
    });
  } catch (e) {
    a = destino({ error: mensajeDeError(e) });
  }
  redirect(a);
}

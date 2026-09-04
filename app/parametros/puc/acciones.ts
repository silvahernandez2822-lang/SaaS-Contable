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
  resolverCuentaPorCodigo,
  simularImpactoCambioCuenta,
  CuentaInvalidaError,
  CuentaNoEncontradaError,
  ContextoSinEmpresaError,
  ModoPucInvalidoError,
  type DatosCuenta,
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
  // D-089 · TAREA 4 — traducción de los guardias de la migración 179. Los
  // mensajes del motor ya explican el hecho y el remedio; aquí se les antepone
  // el contexto de pantalla y se garantiza un texto claro aunque cambie el
  // wording de la base.
  if (isPostgresError(e)) {
    switch (e.code) {
      case SQLSTATE.CUENTA_EN_USO: // PU001
        return `No se puede borrar esta cuenta: está en uso (partidas del ledger, conceptos de causación, cuentas hijas o mapeos NIIF/exógena). Inactívela en su lugar. ${e.message}`;
      case SQLSTATE.CUENTA_NATURALEZA_INMUTABLE: // PU002
        return `No se puede cambiar la naturaleza de una cuenta con movimientos: invertiría el signo de todos los reportes del pasado. Cree una cuenta nueva y traslade el saldo con un asiento. ${e.message}`;
      case SQLSTATE.CUENTA_CON_MOVIMIENTOS: // PU003
        return `No se puede convertir en cuenta de agrupación una cuenta que ya tiene partidas. Si no quiere seguir usándola, inactívela. ${e.message}`;
      case SQLSTATE.CUENTA_CODIGO_INMUTABLE: // PU004
        return `No se puede renumerar una cuenta con movimientos: reclasificaría en silencio los reportes y la exógena ya emitidos. Cree la cuenta nueva y traslade el saldo. ${e.message}`;
      case SQLSTATE.CUENTA_REFERENCIADA_POR_CONCEPTO: // PU005
        return `Hay conceptos de causación activos que apuntan a esta cuenta: retirarla o cambiarla rompería la causación automática. Reasigne primero esos conceptos. ${e.message}`;
      case SQLSTATE.CUENTA_INACTIVA: // LG009
        return `Esa cuenta está inactiva en el plan y no admite partidas nuevas. Reactívela o use la cuenta que la sustituyó. ${e.message}`;
      case SQLSTATE.CUENTA_NO_IMPUTABLE: // LG004
        return `Esa cuenta es de agrupación y no admite movimiento: impute sobre una subcuenta o auxiliar. ${e.message}`;
      case SQLSTATE.CHECK_VIOLATION:
        return `El motor rechazó la cuenta por una restricción del esquema: ${e.message}`;
    }
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando la cuenta.';
}

/** Valores crudos del formulario, para volver a pintarlos en el paso "simular". */
function camposCrudos(fd: FormData): Record<string, string> {
  return {
    codigo: leer(fd, 'codigo'),
    nombre: leer(fd, 'nombre'),
    naturaleza: leer(fd, 'naturaleza'),
    alcance: leer(fd, 'alcance'),
    permiteMovimiento: leer(fd, 'permiteMovimiento'),
    requiereTercero: leer(fd, 'requiereTercero'),
    requiereCentroCosto: leer(fd, 'requiereCentroCosto'),
    requiereBaseGravable: leer(fd, 'requiereBaseGravable'),
    activo: leer(fd, 'activo'),
  };
}

function destino(parametros: Record<string, string>): string {
  const qs = new URLSearchParams(parametros);
  return `/parametros/puc?${qs.toString()}`;
}

export async function guardarCuentaAction(formData: FormData): Promise<void> {
  const codigo = leer(formData, 'codigo');
  const confirmado = leer(formData, 'confirmado') === '1';
  const alcance = leer(formData, 'alcance') === 'firma' ? 'firma' : 'empresa';
  let a: string;
  try {
    const permiteMovimiento = leerBandera(formData, 'permiteMovimiento');
    if (permiteMovimiento === undefined) {
      throw new CuentaInvalidaError(
        'Declare explícitamente si la cuenta admite movimiento (Sí/No). No hay valor por defecto: una cuenta ' +
          'de agrupación marcada por error como imputable deja imputar partidas donde no se debe.',
      );
    }
    const datos: DatosCuenta = {
      codigo,
      nombre: leer(formData, 'nombre'),
      naturaleza: leer(formData, 'naturaleza') === 'credito' ? 'credito' : 'debito',
      permiteMovimiento,
      requiereTercero: leerBandera(formData, 'requiereTercero') ?? false,
      requiereCentroCosto: leerBandera(formData, 'requiereCentroCosto') ?? false,
      requiereBaseGravable: leerBandera(formData, 'requiereBaseGravable') ?? false,
      activo: leerBandera(formData, 'activo') ?? true,
      alcance,
    };

    const resultado = await conSesion(async (tx) => {
      // D-089 · TAREA 4 — simulador de impacto BLOQUEANTE antes de guardar.
      // Solo cuando es una edición real de la MISMA fila (mismo alcance): crear
      // una cuenta propia que sobreescribe una global es un INSERT nuevo y los
      // guardias de `account` no aplican.
      const actual = await resolverCuentaPorCodigo(tx, codigo);
      const esEdicionReal = actual != null && actual.alcance === alcance;
      if (esEdicionReal && !confirmado) {
        const impacto = await simularImpactoCambioCuenta(tx, actual, datos);
        if (impacto.bloqueadoPorMotor || impacto.requiereConfirmacion) {
          return { tipo: 'simular' as const };
        }
      }
      const g = await guardarCuenta(tx, datos);
      return { tipo: 'guardada' as const, creada: g.creada };
    });

    a =
      resultado.tipo === 'simular'
        ? destino({ simular: codigo, ...camposCrudos(formData) })
        : destino({ ok: resultado.creada ? `Cuenta ${codigo} creada.` : `Cuenta ${codigo} actualizada.` });
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

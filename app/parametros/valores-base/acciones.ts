'use server';

/**
 * A8 — Acciones de servidor de UVT, SMMLV y redondeo general.
 *
 * A diferencia de una tarifa de `tax_rule` (cuyo impacto depende de QUÉ
 * concepto se edita), el impacto de estos tres valores es siempre el mismo:
 * "todos los conceptos y proveedores con actividad en la firma" — por eso la
 * página los muestra en un solo paso (el número ya está a la vista antes de
 * que exista el botón "Guardar"), y no en el paso intermedio que sí necesita
 * el editor de tarifas. El simulador (`simularImpactoValorBase`) igual corre
 * ANTES de que el usuario pueda enviar el formulario, tal como exige la
 * sección 6.2, punto 6 — solo que no hace falta un segundo viaje al servidor
 * porque el número no cambia según lo que el usuario escriba.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion.js';
import {
  editarRoundingRule,
  editarSmmlvValue,
  editarUvtValue,
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  ParametroNoEncontradoError,
  VigenciaInvalidaError,
} from '../../../src/services/parametrizacion.js';
import { isPostgresError, SQLSTATE } from '../../../src/db/types.js';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function mensajeDeError(e: unknown): string {
  if (
    e instanceof EdicionRetroactivaError ||
    e instanceof NormaDeRespaldoRequeridaError ||
    e instanceof VigenciaInvalidaError ||
    e instanceof ParametroNoEncontradoError
  ) {
    return e.message;
  }
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para editar parámetros tributarios (se requiere administrador tributario).';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando el parámetro.';
}

const BASE = '/parametros/valores-base';

export async function guardarUvtAction(formData: FormData): Promise<void> {
  let destino: string;
  try {
    // El valor lo escribe el contador en PESOS; se guarda en centavos (D-005).
    const valorPesos = Number(leer(formData, 'valorPesos'));
    const centavos = String(Math.round(valorPesos * 100));
    await conSesion((tx) =>
      editarUvtValue(tx, {
        reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
        anio: Number(leer(formData, 'anio')),
        valorCentavos: centavos,
        vigenteDesde: leer(formData, 'vigenteDesde'),
        normaRespaldo: leer(formData, 'normaRespaldo'),
        alcanceNuevo: leer(formData, 'alcanceNuevo') === 'empresa' ? 'empresa' : 'firma',
      }),
    );
    destino = `${BASE}?ok=uvt`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

export async function guardarSmmlvAction(formData: FormData): Promise<void> {
  let destino: string;
  try {
    const valorMensualPesos = Number(leer(formData, 'valorMensualPesos'));
    const auxTransportePesos = leer(formData, 'auxilioTransportePesos');
    await conSesion((tx) =>
      editarSmmlvValue(tx, {
        reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
        anio: Number(leer(formData, 'anio')),
        valorMensualCentavos: String(Math.round(valorMensualPesos * 100)),
        auxilioTransporteCentavos: auxTransportePesos ? String(Math.round(Number(auxTransportePesos) * 100)) : null,
        vigenteDesde: leer(formData, 'vigenteDesde'),
        normaRespaldo: leer(formData, 'normaRespaldo'),
        alcanceNuevo: leer(formData, 'alcanceNuevo') === 'empresa' ? 'empresa' : 'firma',
      }),
    );
    destino = `${BASE}?ok=smmlv`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

export async function guardarRedondeoAction(formData: FormData): Promise<void> {
  let destino: string;
  try {
    const modo = leer(formData, 'modo') as 'half_up' | 'half_even' | 'truncar' | 'techo' | 'piso';
    await conSesion((tx) =>
      editarRoundingRule(tx, {
        reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
        modo,
        multiplo: Number(leer(formData, 'multiplo')),
        vigenteDesde: leer(formData, 'vigenteDesde'),
        normaRespaldo: leer(formData, 'normaRespaldo'),
        alcanceNuevo: leer(formData, 'alcanceNuevo') === 'empresa' ? 'empresa' : 'firma',
      }),
    );
    destino = `${BASE}?ok=redondeo`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

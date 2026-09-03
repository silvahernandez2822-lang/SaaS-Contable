'use server';

/**
 * A8 — Acciones de servidor de UVT, SMMLV y redondeo general.
 *
 * D-087 · TAREA 3 — flujo de DOS pasos, igual que el editor de tarifas
 * (sección 6.2, punto 6: el simulador corre ANTES de guardar, nunca junto):
 *   1. `simular*Action`   — calcula el impacto (conceptos/proveedores de la
 *      firma), no escribe nada; redirige al paso de confirmación.
 *   2. `confirmar*Action` — el usuario ya vio el impacto (y su detalle) y
 *      confirma; ahí sí se llama a `editar*Value` / `editarRoundingRule`.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import {
  editarRoundingRule,
  editarSmmlvValue,
  editarUvtValue,
  exigirTestigoImpacto,
  simularImpactoValorBase,
  EdicionRetroactivaError,
  ImpactoNoSimuladoError,
  NormaDeRespaldoRequeridaError,
  ParametroNoEncontradoError,
  VigenciaInvalidaError,
} from '../../../src/services/parametrizacion';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function mensajeDeError(e: unknown): string {
  if (
    e instanceof EdicionRetroactivaError ||
    e instanceof ImpactoNoSimuladoError ||
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

/** Campos comunes a los tres formularios. */
const COMUNES = ['reglaAnteriorId', 'vigenteDesde', 'normaRespaldo', 'alcanceNuevo'] as const;

/** Paso 1 genérico: simula el impacto y redirige al paso de confirmación con
 *  todos los campos del formulario en el query string. */
async function simular(formData: FormData, cual: 'uvt' | 'smmlv' | 'redondeo', extra: string[]): Promise<void> {
  const campos: Record<string, string> = { cual, confirmar: '1', editar: cual };
  for (const c of [...COMUNES, ...extra]) campos[c] = leer(formData, c);
  if (!campos.alcanceNuevo) campos.alcanceNuevo = 'firma';

  let destino: string;
  try {
    const impacto = await conSesion((tx) => simularImpactoValorBase(tx));
    destino = `${BASE}?${new URLSearchParams({
      ...campos,
      conceptos: String(impacto.conceptosAfectados),
      proveedores: String(impacto.proveedoresAfectados),
    }).toString()}`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

export async function simularUvtAction(formData: FormData): Promise<void> {
  await simular(formData, 'uvt', ['anio', 'valorPesos']);
}
export async function simularSmmlvAction(formData: FormData): Promise<void> {
  await simular(formData, 'smmlv', ['anio', 'valorMensualPesos', 'auxilioTransportePesos']);
}
export async function simularRedondeoAction(formData: FormData): Promise<void> {
  await simular(formData, 'redondeo', ['modo', 'multiplo']);
}

/** V-39 (A14): el paso 2 exige el TESTIGO del paso 1. Sin él —POST directo
 *  saltándose `simular*Action`— o con un testigo que ya no coincide con el
 *  impacto real, no se abre ninguna vigencia. */
function testigoDe(formData: FormData): { conceptos: string; proveedores: string } {
  return { conceptos: leer(formData, 'conceptos'), proveedores: leer(formData, 'proveedores') };
}

export async function confirmarUvtAction(formData: FormData): Promise<void> {
  let destino: string;
  try {
    const valorPesos = Number(leer(formData, 'valorPesos'));
    const testigo = testigoDe(formData);
    await conSesion(async (tx) => {
      exigirTestigoImpacto(testigo, await simularImpactoValorBase(tx));
      return editarUvtValue(tx, {
        reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
        anio: Number(leer(formData, 'anio')),
        valorCentavos: String(Math.round(valorPesos * 100)),
        vigenteDesde: leer(formData, 'vigenteDesde'),
        normaRespaldo: leer(formData, 'normaRespaldo'),
        alcanceNuevo: leer(formData, 'alcanceNuevo') === 'empresa' ? 'empresa' : 'firma',
      });
    });
    destino = `${BASE}?ok=uvt`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

export async function confirmarSmmlvAction(formData: FormData): Promise<void> {
  let destino: string;
  try {
    const valorMensualPesos = Number(leer(formData, 'valorMensualPesos'));
    const auxTransportePesos = leer(formData, 'auxilioTransportePesos');
    const testigo = testigoDe(formData);
    await conSesion(async (tx) => {
      exigirTestigoImpacto(testigo, await simularImpactoValorBase(tx));
      return editarSmmlvValue(tx, {
        reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
        anio: Number(leer(formData, 'anio')),
        valorMensualCentavos: String(Math.round(valorMensualPesos * 100)),
        auxilioTransporteCentavos: auxTransportePesos
          ? String(Math.round(Number(auxTransportePesos) * 100))
          : null,
        vigenteDesde: leer(formData, 'vigenteDesde'),
        normaRespaldo: leer(formData, 'normaRespaldo'),
        alcanceNuevo: leer(formData, 'alcanceNuevo') === 'empresa' ? 'empresa' : 'firma',
      });
    });
    destino = `${BASE}?ok=smmlv`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

export async function confirmarRedondeoAction(formData: FormData): Promise<void> {
  let destino: string;
  try {
    const modo = leer(formData, 'modo') as 'half_up' | 'half_even' | 'truncar' | 'techo' | 'piso';
    const testigo = testigoDe(formData);
    await conSesion(async (tx) => {
      exigirTestigoImpacto(testigo, await simularImpactoValorBase(tx));
      return editarRoundingRule(tx, {
        reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
        modo,
        multiplo: Number(leer(formData, 'multiplo')),
        vigenteDesde: leer(formData, 'vigenteDesde'),
        normaRespaldo: leer(formData, 'normaRespaldo'),
        alcanceNuevo: leer(formData, 'alcanceNuevo') === 'empresa' ? 'empresa' : 'firma',
      });
    });
    destino = `${BASE}?ok=redondeo`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

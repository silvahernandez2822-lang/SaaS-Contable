'use server';

/**
 * A8 — Acciones de servidor de las bases mínimas / tarifa general de ReteICA
 * por municipio (`municipality_ica_rule`). La tarifa POR ACTIVIDAD del
 * municipio es `tax_rule` y se edita desde `/parametros/tarifas/reteica`.
 *
 * Mismo flujo de dos pasos que el editor de tarifas: `simularAction` solo
 * calcula impacto, `confirmarAction` es la única que escribe.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion.js';
import {
  editarMunicipioIcaRule,
  simularImpactoMunicipioIca,
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

const BASE = '/parametros/reteica-municipios';

export async function simularAction(formData: FormData): Promise<void> {
  const municipalityId = leer(formData, 'municipalityId');
  const campos = {
    reglaAnteriorId: leer(formData, 'reglaAnteriorId'),
    practicaReteica: leer(formData, 'practicaReteica') || 'true',
    baseMinimaServiciosUvt: leer(formData, 'baseMinimaServiciosUvt'),
    baseMinimaComprasUvt: leer(formData, 'baseMinimaComprasUvt'),
    usaTarifaDeActividad: leer(formData, 'usaTarifaDeActividad') || 'true',
    tarifaGeneralPorMil: leer(formData, 'tarifaGeneralPorMil'),
    periodicidad: leer(formData, 'periodicidad') || 'mensual',
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    alcanceNuevo: leer(formData, 'alcanceNuevo') || 'firma',
  };

  let destino: string;
  try {
    const impacto = await conSesion((tx) => simularImpactoMunicipioIca(tx, municipalityId));
    const qs = new URLSearchParams({
      editar: municipalityId,
      confirmar: '1',
      municipalityId,
      ...campos,
      conceptos: String(impacto.conceptosAfectados),
      proveedores: String(impacto.proveedoresAfectados),
    });
    destino = `${BASE}?${qs.toString()}`;
  } catch (e) {
    destino = `${BASE}?${new URLSearchParams({ editar: municipalityId, error: mensajeDeError(e) }).toString()}`;
  }
  redirect(destino);
}

export async function confirmarAction(formData: FormData): Promise<void> {
  const municipalityId = leer(formData, 'municipalityId');
  const reglaAnteriorId = leer(formData, 'reglaAnteriorId');
  const campos = {
    practicaReteica: leer(formData, 'practicaReteica'),
    baseMinimaServiciosUvt: leer(formData, 'baseMinimaServiciosUvt'),
    baseMinimaComprasUvt: leer(formData, 'baseMinimaComprasUvt'),
    usaTarifaDeActividad: leer(formData, 'usaTarifaDeActividad'),
    tarifaGeneralPorMil: leer(formData, 'tarifaGeneralPorMil'),
    periodicidad: leer(formData, 'periodicidad'),
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    alcanceNuevo: leer(formData, 'alcanceNuevo'),
  };

  let destino: string;
  try {
    const usaTarifaDeActividad = campos.usaTarifaDeActividad === 'true';
    // Tarifa general expresada por el contador "por mil" (la convención de la
    // sección 7.5); se guarda como fracción (D-005): 2‰ = 0.002.
    const tarifaGeneral = campos.tarifaGeneralPorMil
      ? (Number(campos.tarifaGeneralPorMil) / 1000).toFixed(6)
      : null;

    await conSesion((tx) =>
      editarMunicipioIcaRule(tx, {
        municipalityId,
        reglaAnteriorId: reglaAnteriorId || null,
        practicaReteica: campos.practicaReteica === 'true',
        baseMinimaServiciosUvt: campos.baseMinimaServiciosUvt || null,
        baseMinimaComprasUvt: campos.baseMinimaComprasUvt || null,
        usaTarifaDeActividad,
        tarifaGeneral: usaTarifaDeActividad ? null : tarifaGeneral,
        periodicidad: campos.periodicidad as 'mensual' | 'bimestral' | 'trimestral' | 'cuatrimestral' | 'anual',
        vigenteDesde: campos.vigenteDesde,
        normaRespaldo: campos.normaRespaldo,
        alcanceNuevo: campos.alcanceNuevo === 'empresa' ? 'empresa' : 'firma',
      }),
    );
    destino = `${BASE}?ok=1`;
  } catch (e) {
    const qs = new URLSearchParams({
      editar: municipalityId,
      confirmar: '1',
      municipalityId,
      reglaAnteriorId,
      ...campos,
      error: mensajeDeError(e),
    });
    destino = `${BASE}?${qs.toString()}`;
  }
  redirect(destino);
}

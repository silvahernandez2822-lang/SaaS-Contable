'use server';

/**
 * A8 — Acciones de servidor del editor de tarifas (`tax_rule`): cubre
 * retefuente, retefuente_salarios, autorretención, ReteIVA, ReteICA por
 * actividad e IVA (todas comparten la misma tabla y el mismo formulario).
 *
 * Flujo en DOS pasos, tal como exige la sección 6.2, punto 6 (el simulador
 * corre ANTES de guardar, nunca junto con el guardado):
 *   1. `simularAction`  — calcula impacto + fecha mínima, no escribe nada.
 *   2. `confirmarAction` — el usuario ya vio el impacto y confirma; ahí sí
 *      se llama a `editarTarifaTaxRule`, que hace el cierre + inserción.
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../../lib/sesion.js';
import {
  editarTarifaTaxRule,
  fechaMinimaVigenciaTaxRule,
  simularImpactoTarifa,
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  ParametroNoEncontradoError,
  VigenciaInvalidaError,
} from '../../../../src/services/parametrizacion.js';
import { isPostgresError, SQLSTATE } from '../../../../src/db/types.js';
import type { SqlClient } from '../../../../src/db/types.js';

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
    return 'Su sesión no tiene permiso para editar parámetros tributarios (se requiere el rol administrador tributario).';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando el parámetro.';
}

async function resolverCuentaPorCodigo(tx: SqlClient, codigo: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM account WHERE codigo = $1
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    [codigo],
  );
  if (!rows[0]) {
    throw new Error(`No existe ninguna cuenta del PUC con código "${codigo}" visible para esta sesión.`);
  }
  return rows[0].id;
}

/** Paso 1: solo simula. Nunca llama a `editarTarifaTaxRule`. */
export async function simularAction(formData: FormData): Promise<void> {
  const tipo = leer(formData, 'tipo');
  const reglaAnteriorId = leer(formData, 'reglaAnteriorId');
  const taxConceptId = leer(formData, 'taxConceptId');
  const base = `/parametros/tarifas/${tipo}`;

  const campos = {
    tarifaPorcentaje: leer(formData, 'tarifaPorcentaje'),
    baseMinimaUvt: leer(formData, 'baseMinimaUvt'),
    cuentaCodigo: leer(formData, 'cuentaCodigo'),
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    alcanceNuevo: leer(formData, 'alcanceNuevo') || 'firma',
  };

  let destino: string;
  const tarifaNumero = Number(campos.tarifaPorcentaje);
  if (campos.tarifaPorcentaje === '' || Number.isNaN(tarifaNumero)) {
    destino = `${base}?${new URLSearchParams({ editar: reglaAnteriorId, error: 'La tarifa debe ser un número en puntos porcentuales (ej.: cuatro para cuatro por ciento).' }).toString()}`;
  } else {
    try {
      const [impacto, fechaMinima] = await conSesion(async (tx) => [
        await simularImpactoTarifa(tx, taxConceptId),
        await fechaMinimaVigenciaTaxRule(tx, reglaAnteriorId),
      ] as const);

      const qs = new URLSearchParams({
        editar: reglaAnteriorId,
        confirmar: '1',
        taxConceptId,
        ...campos,
        conceptos: String(impacto.conceptosAfectados),
        proveedores: String(impacto.proveedoresAfectados),
        fechaMinima: fechaMinima ?? '',
      });
      destino = `${base}?${qs.toString()}`;
    } catch (e) {
      const qs = new URLSearchParams({ editar: reglaAnteriorId, error: mensajeDeError(e) });
      destino = `${base}?${qs.toString()}`;
    }
  }
  redirect(destino);
}

/** Paso 2: el usuario ya vio "esta tarifa afecta N conceptos y M proveedores"
 * y confirma. Aquí sí se escribe. */
export async function confirmarAction(formData: FormData): Promise<void> {
  const tipo = leer(formData, 'tipo');
  const reglaAnteriorId = leer(formData, 'reglaAnteriorId');
  const base = `/parametros/tarifas/${tipo}`;
  const vigenteDesde = leer(formData, 'vigenteDesde');

  const campos = {
    tarifaPorcentaje: leer(formData, 'tarifaPorcentaje'),
    baseMinimaUvt: leer(formData, 'baseMinimaUvt'),
    cuentaCodigo: leer(formData, 'cuentaCodigo'),
    vigenteDesde,
    normaRespaldo: leer(formData, 'normaRespaldo'),
    alcanceNuevo: leer(formData, 'alcanceNuevo') || 'firma',
  };

  let destino: string;
  try {
    const tarifa = (Number(campos.tarifaPorcentaje) / 100).toFixed(6);
    const resultado = await conSesion(async (tx) => {
      const accountId = campos.cuentaCodigo ? await resolverCuentaPorCodigo(tx, campos.cuentaCodigo) : undefined;
      return editarTarifaTaxRule(tx, {
        reglaAnteriorId,
        vigenteDesde: campos.vigenteDesde,
        normaRespaldo: campos.normaRespaldo,
        tarifa,
        baseMinimaUvt: campos.baseMinimaUvt || null,
        accountId,
        alcanceNuevo: campos.alcanceNuevo === 'empresa' ? 'empresa' : 'firma',
      });
    });
    destino = `${base}?${new URLSearchParams({ ok: resultado.reglaNuevaId }).toString()}`;
  } catch (e) {
    const qs = new URLSearchParams({
      editar: reglaAnteriorId,
      confirmar: '1',
      ...campos,
      error: mensajeDeError(e),
    });
    destino = `${base}?${qs.toString()}`;
  }
  redirect(destino);
}

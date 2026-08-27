/**
 * A3 — Persistencia de la traza (paso 8 de la sección 9.2).
 *
 * Se escribe una fila de `retention_applied` por cada retención EVALUADA, haya
 * aplicado o no. La que no aplicó lleva `aplicada = false`, `valor = 0` y el
 * motivo en texto: es lo que la sección 9.3 exige y lo que el contador abre
 * cuando pregunta «¿y por qué esta factura no retuvo?».
 *
 * La fila amarra la regla Y su vigencia con la FK compuesta
 * `(tax_rule_id, regla_vigente_desde)` y la base verifica con un CHECK que esa
 * vigencia cubría la fecha del hecho (D-017). La traza no puede mentir aunque
 * este archivo se equivoque.
 */
import type { SqlClient } from '../db/types';
import type { FechaIso, ResultadoResolucion, RetencionResuelta } from './tipos';

export interface ContextoPersistencia {
  tenantId: string;
  companyId: string;
  sourceDocumentId: string;
  /** Asiento al que quedará amarrada. A6 lo enlaza después si aquí va null. */
  journalEntryId?: string | null;
}

export interface FilaRetencionPersistida {
  id: string;
  tipo: string;
  base: string;
  tarifa: string;
  valor: string;
  tax_rule_id: string;
  regla_vigente_desde: string;
  regla_vigente_hasta: string | null;
  norma_respaldo: string;
  account_id: string;
  aplicada: boolean;
  motivo_no_aplica: string | null;
}

async function insertar(
  tx: SqlClient,
  ctx: ContextoPersistencia,
  r: RetencionResuelta,
  fechaHecho: FechaIso,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO retention_applied (
       tenant_id, company_id, source_document_id, journal_entry_id, concepto_causacion_id,
       third_party_id, tipo, base, tarifa, valor, valor_sin_redondeo,
       tax_rule_id, regla_vigente_desde, regla_vigente_hasta, norma_respaldo, account_id,
       municipality_id, ciiu_activity_id, rounding_rule_id, fecha_hecho_economico,
       uvt_valor_usado, base_minima_uvt_usada, base_minima_valor_usada, aplicada, motivo_no_aplica)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11,$12,$13::date,$14::date,$15,$16,
             $17,$18,$19,$20::date,$21,$22::numeric,$23,$24,$25)
     RETURNING id`,
    [
      ctx.tenantId,
      ctx.companyId,
      ctx.sourceDocumentId,
      ctx.journalEntryId ?? null,
      r.conceptoCausacionId,
      r.terceroId,
      r.tipo,
      r.base,
      r.tarifa,
      r.valor,
      r.valorSinRedondeo,
      r.regla.taxRuleId,
      r.regla.vigenteDesde,
      r.regla.vigenteHasta,
      r.normaRespaldo,
      r.accountId,
      r.municipalityId,
      r.ciiuActivityId,
      r.roundingRuleId,
      fechaHecho,
      r.uvtValorUsado,
      r.baseMinimaUvtUsada,
      r.baseMinimaValorUsada,
      r.aplicada,
      r.motivoNoAplica,
    ],
  );
  return rows[0]!.id;
}

/**
 * Persiste todas las evaluaciones de una resolución. Devuelve los ids en el
 * mismo orden en que vienen, que es el orden determinista del motor.
 */
export async function persistirRetenciones(
  tx: SqlClient,
  ctx: ContextoPersistencia,
  resultado: ResultadoResolucion,
): Promise<string[]> {
  const ids: string[] = [];
  for (const r of resultado.retenciones) {
    ids.push(await insertar(tx, ctx, r, r.fechaHechoEconomico));
  }
  return ids;
}

/** Persiste una lista suelta de retenciones (la usa la reversa de nota crédito). */
export async function persistirLista(
  tx: SqlClient,
  ctx: ContextoPersistencia,
  retenciones: readonly RetencionResuelta[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const r of retenciones) {
    ids.push(await insertar(tx, ctx, r, r.fechaHechoEconomico));
  }
  return ids;
}

/** Lee la traza de un documento, en orden estable, para comparar o reversar. */
export async function leerRetenciones(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<FilaRetencionPersistida[]> {
  const { rows } = await tx.query<FilaRetencionPersistida>(
    `SELECT id, tipo, base::text, tarifa::text, valor::text, tax_rule_id,
            regla_vigente_desde::text, regla_vigente_hasta::text, norma_respaldo, account_id,
            aplicada, motivo_no_aplica
       FROM retention_applied
      WHERE source_document_id = $1
      ORDER BY tipo, tax_rule_id, id`,
    [sourceDocumentId],
  );
  return rows;
}

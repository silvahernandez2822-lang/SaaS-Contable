/**
 * A3 — Nota crédito: reversa PROPORCIONAL de las retenciones del documento
 * original (sección 9.3, caso dorado 15).
 *
 * Dos cosas que no se hacen aquí, a propósito:
 *
 *  · No se toca ni una fila del documento original. La Regla de Oro 1 dice que
 *    lo publicado no se modifica: la reversa son filas NUEVAS de
 *    `retention_applied` colgadas de la nota crédito, y A6 les cuelga un
 *    asiento de reversa que referencia al original.
 *
 *  · No se vuelve a resolver la regla a la fecha de la nota. Se reversa lo que
 *    se retuvo, con la MISMA regla, la MISMA vigencia y la MISMA tarifa con la
 *    que se retuvo. Reversar con la tarifa de hoy una retención practicada en
 *    junio dejaría un saldo imposible de explicar.
 *
 * Por eso la fila de reversa conserva `fecha_hecho_economico` del documento
 * original: es la fecha que hace vigente a la regla que se está reversando, y
 * el CHECK de la base de datos (D-017) lo exige. La nota crédito queda
 * identificada por `source_document_id`.
 */
import type { SqlClient } from '../db/types.js';
import { aEntero, esModoRedondeo, proporcion } from './dinero.js';
import type { FechaIso, RetencionResuelta, TipoRetencion } from './tipos.js';

export interface EntradaNotaCredito {
  /** Documento original ya causado, cuyas retenciones se reversan. */
  documentoOriginalId: string;
  /** Base gravable del documento original, en centavos. */
  baseOriginal: number;
  /** Base gravable que ampara la nota crédito, en centavos. */
  baseNota: number;
  /** IVA del documento original y de la nota, si la nota afecta el IVA. */
  ivaOriginal?: number | null;
  ivaNota?: number | null;
}

export interface ResultadoReversa {
  /** Retenciones a registrar contra la nota crédito. Positivas: el signo lo da el asiento. */
  reversas: RetencionResuelta[];
  /** True si la nota crédito anula el documento completo. */
  total: boolean;
  motivos: { codigo: string; detalle: string }[];
}

interface FilaOriginal {
  id: string;
  concepto_causacion_id: string | null;
  third_party_id: string | null;
  tipo: TipoRetencion;
  base: string;
  tarifa: string;
  valor: string;
  valor_sin_redondeo: string | null;
  tax_rule_id: string;
  regla_vigente_desde: string;
  regla_vigente_hasta: string | null;
  norma_respaldo: string;
  account_id: string;
  municipality_id: string | null;
  ciiu_activity_id: string | null;
  rounding_rule_id: string | null;
  fecha_hecho_economico: string;
  uvt_valor_usado: string | null;
  base_minima_uvt_usada: string | null;
  base_minima_valor_usada: string | null;
  modo_redondeo: string | null;
  multiplo_redondeo: string | null;
}

export async function resolverReversaNotaCredito(
  tx: SqlClient,
  entrada: EntradaNotaCredito,
): Promise<ResultadoReversa> {
  const motivos: { codigo: string; detalle: string }[] = [];
  const baseOriginal = BigInt(entrada.baseOriginal);
  const baseNota = BigInt(entrada.baseNota);

  if (baseOriginal <= 0n) {
    return {
      reversas: [],
      total: false,
      motivos: [
        {
          codigo: 'base_original_no_positiva',
          detalle: 'No se puede repartir una reversa sobre una base original que no es positiva.',
        },
      ],
    };
  }
  if (baseNota > baseOriginal) {
    return {
      reversas: [],
      total: false,
      motivos: [
        {
          codigo: 'nota_mayor_que_el_original',
          detalle:
            `La nota crédito ampara una base mayor que la del documento original. Reversar más de ` +
            'lo retenido dejaría un saldo a favor que nadie practicó.',
        },
      ],
    };
  }

  const { rows } = await tx.query<FilaOriginal>(
    `SELECT ra.id, ra.concepto_causacion_id, ra.third_party_id, ra.tipo, ra.base::text,
            ra.tarifa::text, ra.valor::text, ra.valor_sin_redondeo::text, ra.tax_rule_id,
            ra.regla_vigente_desde::text, ra.regla_vigente_hasta::text, ra.norma_respaldo,
            ra.account_id, ra.municipality_id, ra.ciiu_activity_id, ra.rounding_rule_id,
            ra.fecha_hecho_economico::text, ra.uvt_valor_usado::text,
            ra.base_minima_uvt_usada::text, ra.base_minima_valor_usada::text,
            rr.modo AS modo_redondeo, rr.multiplo::text AS multiplo_redondeo
       FROM retention_applied ra
       LEFT JOIN rounding_rule rr ON rr.id = ra.rounding_rule_id
      WHERE ra.source_document_id = $1 AND ra.aplicada AND ra.valor > 0
      ORDER BY ra.tipo, ra.tax_rule_id, ra.id`,
    [entrada.documentoOriginalId],
  );

  const total = baseNota === baseOriginal;
  const reversas: RetencionResuelta[] = [];

  for (const o of rows) {
    if (o.modo_redondeo === null || !esModoRedondeo(o.modo_redondeo) || o.multiplo_redondeo === null) {
      motivos.push({
        codigo: 'reversa_sin_regla_de_redondeo',
        detalle:
          `La retención ${o.id} no conserva la regla de redondeo con la que se calculó, así que la ` +
          'reversa proporcional no se puede reproducir. Va a revisión manual.',
      });
      continue;
    }
    const multiplo = aEntero(o.multiplo_redondeo)!;
    const modo = o.modo_redondeo;

    // ReteIVA se reparte por el IVA, no por la base gravable: son magnitudes
    // distintas y la nota crédito puede afectar una sin afectar la otra.
    const usaIva =
      o.tipo === 'reteiva' &&
      entrada.ivaOriginal !== null &&
      entrada.ivaOriginal !== undefined &&
      entrada.ivaNota !== null &&
      entrada.ivaNota !== undefined;
    const numerador = usaIva ? BigInt(entrada.ivaNota!) : baseNota;
    const denominador = usaIva ? BigInt(entrada.ivaOriginal!) : baseOriginal;
    if (denominador <= 0n) {
      motivos.push({
        codigo: 'reversa_sin_denominador',
        detalle: `La retención ${o.id} no tiene contra qué prorratearse.`,
      });
      continue;
    }

    const baseOrig = aEntero(o.base)!;
    const valorOrig = aEntero(o.valor)!;
    const baseReversa = proporcion(baseOrig, numerador, denominador, 1n, modo);
    const valorReversa = proporcion(valorOrig, numerador, denominador, multiplo, modo);

    reversas.push({
      tipo: o.tipo,
      base: Number(baseReversa),
      tarifa: o.tarifa,
      regla: {
        taxRuleId: o.tax_rule_id,
        vigenteDesde: o.regla_vigente_desde,
        vigenteHasta: o.regla_vigente_hasta,
      },
      valor: Number(valorReversa),
      accountId: o.account_id,
      normaRespaldo: o.norma_respaldo,
      aplicada: true,
      motivoNoAplica: null,
      valorSinRedondeo: Number(valorReversa),
      conceptoCausacionId: o.concepto_causacion_id!,
      terceroId: o.third_party_id!,
      municipalityId: o.municipality_id,
      ciiuActivityId: o.ciiu_activity_id,
      roundingRuleId: o.rounding_rule_id,
      uvtValorUsado: o.uvt_valor_usado === null ? null : Number(o.uvt_valor_usado),
      baseMinimaUvtUsada: o.base_minima_uvt_usada,
      baseMinimaValorUsada:
        o.base_minima_valor_usada === null ? null : Number(o.base_minima_valor_usada),
      fechaHechoEconomico: o.fecha_hecho_economico as FechaIso,
      nota:
        `Reversa ${total ? 'total' : 'proporcional'} de la retención ${o.id} del documento ` +
        `${entrada.documentoOriginalId}. Se conserva la regla y la vigencia originales.`,
    });
  }

  return { reversas, total, motivos };
}

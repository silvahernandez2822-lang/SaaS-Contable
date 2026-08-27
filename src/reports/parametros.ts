/**
 * A9 — Hoja "Parámetros" (sección 11.2): los valores paramétricos REALMENTE
 * usados por el reporte, con su vigencia. Nada se calcula aquí: se lee lo que
 * el motor de reglas (A3) ya dejó denormalizado en `retention_applied`
 * (Regla de Oro 6 — D-017), o se consultan las tablas paramétricas de A1
 * directamente para los reportes que no pasan por el motor de retenciones.
 */
import type { SqlClient } from '../db/types';
import { centavosATextoPesos, tarifaATextoPorcentaje } from './formato';
import type { FilaParametro } from './tipos';
import type { FilaRetencionAplicada } from './consulta';

/**
 * Deduplica por (tax_rule_id, vigente_desde): la misma regla puede haberse
 * aplicado a decenas de facturas del período, pero es un solo parámetro.
 */
export function parametrosDesdeRetenciones(retenciones: readonly FilaRetencionAplicada[]): FilaParametro[] {
  const vistos = new Map<string, FilaParametro>();
  for (const r of retenciones) {
    const clave = `${r.taxRuleId}|${r.vigenteDesde}`;
    if (!vistos.has(clave)) {
      vistos.set(clave, {
        parametro: `Tarifa ${r.tipo}${r.conceptoNombre ? ` — ${r.conceptoNombre}` : ''}`,
        valor: tarifaATextoPorcentaje(r.tarifa),
        vigenteDesde: r.vigenteDesde,
        vigenteHasta: r.vigenteHasta,
        normaRespaldo: r.normaRespaldo,
        notas: r.municipioNombre ? `Municipio: ${r.municipioNombre}` : null,
      });
    }
    if (r.uvtValorUsado) {
      const claveUvt = `uvt|${r.vigenteDesde}|${r.uvtValorUsado}`;
      if (!vistos.has(claveUvt)) {
        vistos.set(claveUvt, {
          parametro: 'UVT usada para la base mínima',
          valor: `$${centavosATextoPesos(r.uvtValorUsado)}`,
          vigenteDesde: r.vigenteDesde,
          vigenteHasta: r.vigenteHasta,
          normaRespaldo: r.normaRespaldo,
          notas:
            r.baseMinimaUvtUsada !== null
              ? `Base mínima: ${r.baseMinimaUvtUsada} UVT`
              : r.baseMinimaValorUsada !== null
                ? `Base mínima: $${centavosATextoPesos(r.baseMinimaValorUsada)}`
                : null,
        });
      }
    }
  }
  return [...vistos.values()];
}

/**
 * Reglas de redondeo vigentes al cierre del rango consultado (`hasta`), para
 * los reportes que no pasan por `retention_applied` pero cuyos importes sí
 * se calcularon con una regla de redondeo parametrizada (Regla de Oro 5).
 */
export async function parametrosDeRedondeoVigente(
  tx: SqlClient,
  opciones: { hasta: string; aplicaA?: string },
): Promise<FilaParametro[]> {
  const { rows } = await tx.query<{
    codigo: string;
    nombre: string;
    modo: string;
    multiplo: string;
    aplica_a: string;
    vigente_desde: string;
    vigente_hasta: string | null;
    norma_respaldo: string;
  }>(
    `SELECT codigo, nombre, modo, multiplo::text, aplica_a,
            vigente_desde::text, vigente_hasta::text, norma_respaldo
       FROM rounding_rule
      WHERE vigente_desde <= $1
        AND (vigente_hasta IS NULL OR vigente_hasta >= $1)
        AND ($2::text IS NULL OR aplica_a IN ('todos', $2))
      ORDER BY aplica_a, codigo`,
    [opciones.hasta, opciones.aplicaA ?? null],
  );
  return rows.map((r) => ({
    parametro: `Redondeo (${r.aplica_a}) — ${r.nombre}`,
    valor: `${r.modo}, múltiplo de $${centavosATextoPesos(r.multiplo)}`,
    vigenteDesde: r.vigente_desde,
    vigenteHasta: r.vigente_hasta,
    normaRespaldo: r.norma_respaldo,
    notas: null,
  }));
}

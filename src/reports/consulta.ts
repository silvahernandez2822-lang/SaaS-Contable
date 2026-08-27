/**
 * A9 — Consultas crudas de los ocho reportes obligatorios (sección 11.3).
 *
 * Todo aquí es SELECT sobre `v_journal_line_reporte` (110_a9_vistas_reportes.sql,
 * `security_invoker`, solo asientos `posted`), `retention_applied` y
 * `third_party`. Ni un filtro de tenant/empresa a mano: RLS decide qué fila es
 * visible (D-021, Regla de Oro 7), igual que en `src/services/consulta.ts`.
 *
 * Nada de esto lee `xml_crudo` directamente: los ocho reportes son de datos ya
 * estructurados en el ledger, no del documento fuente. Si algún día un reporte
 * necesitara el XML original, el accesor correcto es
 * `leerXmlDocumento` (`src/ingest/persistencia.ts`), que tolera el archivado
 * frío (031_ingest_archivado_frio.sql) — no `source_document.xml_crudo` a pelo.
 */
import type { SqlClient } from '../db/types';

export interface RangoFechas {
  desde: string;
  hasta: string;
}

// =============================================================================
// 1. Libro diario / 2. Libro mayor — misma fuente, distinto orden de "Datos"
// =============================================================================

export interface FilaMovimiento {
  journalLineId: string;
  fecha: string;
  asientoNumero: string;
  asientoTipo: string;
  asientoDescripcion: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaNaturaleza: string;
  linea: number;
  side: 'debito' | 'credito';
  monto: string;
  terceroDocumento: string | null;
  terceroRazonSocial: string | null;
  costCenterCodigo: string | null;
  descripcion: string | null;
  sourceDocumentId: string;
  retentionAppliedId: string | null;
}

const SELECT_MOVIMIENTO = `
  SELECT
    v.journal_line_id  AS "journalLineId",
    v.fecha_hecho_economico::text AS fecha,
    v.asiento_numero::text AS "asientoNumero",
    v.asiento_tipo AS "asientoTipo",
    v.asiento_descripcion AS "asientoDescripcion",
    v.cuenta_codigo AS "cuentaCodigo",
    v.cuenta_nombre AS "cuentaNombre",
    v.cuenta_naturaleza AS "cuentaNaturaleza",
    v.linea,
    v.side,
    v.monto::text AS monto,
    tp.numero_documento AS "terceroDocumento",
    tp.razon_social AS "terceroRazonSocial",
    cc.codigo AS "costCenterCodigo",
    v.linea_descripcion AS descripcion,
    v.source_document_id AS "sourceDocumentId",
    v.retention_applied_id AS "retentionAppliedId"
  FROM v_journal_line_reporte v
  LEFT JOIN third_party tp ON tp.id = v.third_party_id
  LEFT JOIN cost_center cc ON cc.id = v.cost_center_id
  WHERE v.fecha_hecho_economico BETWEEN $1 AND $2
`;

/** Libro diario: cronológico por fecha, número de asiento y línea. */
export async function libroDiario(tx: SqlClient, rango: RangoFechas): Promise<FilaMovimiento[]> {
  const { rows } = await tx.query<FilaMovimiento>(
    `${SELECT_MOVIMIENTO} ORDER BY v.fecha_hecho_economico, v.asiento_numero, v.linea`,
    [rango.desde, rango.hasta],
  );
  return rows;
}

/** Libro mayor: el mismo movimiento, agrupado en el orden de lectura por cuenta y fecha. */
export async function libroMayor(tx: SqlClient, rango: RangoFechas): Promise<FilaMovimiento[]> {
  const { rows } = await tx.query<FilaMovimiento>(
    `${SELECT_MOVIMIENTO} ORDER BY v.cuenta_codigo, v.fecha_hecho_economico, v.asiento_numero, v.linea`,
    [rango.desde, rango.hasta],
  );
  return rows;
}

// =============================================================================
// 3. Libro auxiliar por cuenta y por tercero
// =============================================================================

export interface FilaAuxiliar extends FilaMovimiento {
  saldoAcumulado: string;
}

export interface FiltroAuxiliar extends RangoFechas {
  accountId: string;
  terceroId?: string | null;
}

/** Saldo de la cuenta (y tercero, si se filtra) ANTES de `desde`, en centavos. */
async function saldoInicialCuenta(
  tx: SqlClient,
  filtro: FiltroAuxiliar,
): Promise<bigint> {
  const { rows } = await tx.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(CASE WHEN side = 'debito' THEN monto ELSE -monto END), 0)::text AS saldo
       FROM v_journal_line_reporte
      WHERE account_id = $1
        AND fecha_hecho_economico < $2
        AND ($3::uuid IS NULL OR third_party_id = $3)`,
    [filtro.accountId, filtro.desde, filtro.terceroId ?? null],
  );
  return BigInt(rows[0]?.saldo ?? '0');
}

/**
 * Libro auxiliar: movimientos de UNA cuenta (opcionalmente de un tercero
 * concreto dentro de ella) con saldo corriente. El saldo corriente es
 * `débitos - créditos` acumulado; el signo real lo interpreta el contador
 * según `cuentaNaturaleza` de la primera fila, exactamente como en un kárdex.
 */
export async function libroAuxiliar(tx: SqlClient, filtro: FiltroAuxiliar): Promise<FilaAuxiliar[]> {
  const { rows } = await tx.query<FilaMovimiento>(
    `${SELECT_MOVIMIENTO}
       AND v.account_id = $3
       AND ($4::uuid IS NULL OR v.third_party_id = $4)
     ORDER BY v.fecha_hecho_economico, v.asiento_numero, v.linea`,
    [filtro.desde, filtro.hasta, filtro.accountId, filtro.terceroId ?? null],
  );

  let saldo = await saldoInicialCuenta(tx, filtro);
  return rows.map((r) => {
    saldo += r.side === 'debito' ? BigInt(r.monto) : -BigInt(r.monto);
    return { ...r, saldoAcumulado: saldo.toString() };
  });
}

// =============================================================================
// 4. Balance de prueba a cualquier nivel del PUC
// =============================================================================

/** Nivel del PUC colombiano: 1 clase, 2 grupo, 3 cuenta, 4 subcuenta, 5 auxiliar. */
export type NivelPuc = 1 | 2 | 3 | 4 | 5;

export interface FilaBalancePrueba {
  codigoGrupo: string;
  nombreGrupo: string;
  saldoInicial: string;
  debitosPeriodo: string;
  creditosPeriodo: string;
  saldoFinal: string;
}

const LONGITUD_SQL_POR_NIVEL: Record<NivelPuc, string> = {
  1: 'left(v.cuenta_codigo, 1)',
  2: 'left(v.cuenta_codigo, 2)',
  3: 'left(v.cuenta_codigo, 4)',
  4: 'left(v.cuenta_codigo, 6)',
  5: 'v.cuenta_codigo',
};

/**
 * Balance de prueba agrupado al nivel del PUC pedido. Se arma directamente
 * sobre `v_journal_line_reporte` (que a su vez es `journal_line` de asientos
 * `posted`, sin ningún filtro adicional): la suma de `debitosPeriodo` y de
 * `creditosPeriodo` de TODAS las filas de este reporte es, por construcción,
 * la misma suma que arrojaría un `SELECT SUM(monto) ... GROUP BY side`
 * ejecutado directamente contra `journal_line` — es la comprobación que exige
 * la sección 12 ("balance de prueba contra suma directa del ledger").
 */
export async function balanceDePrueba(
  tx: SqlClient,
  opciones: RangoFechas & { nivel: NivelPuc },
): Promise<FilaBalancePrueba[]> {
  const expresion = LONGITUD_SQL_POR_NIVEL[opciones.nivel];
  const { rows } = await tx.query<{
    codigo_grupo: string;
    saldo_inicial: string;
    debitos_periodo: string;
    creditos_periodo: string;
  }>(
    `SELECT
       ${expresion} AS codigo_grupo,
       COALESCE(SUM(CASE WHEN v.fecha_hecho_economico < $1
                          THEN (CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END)
                          ELSE 0 END), 0)::text AS saldo_inicial,
       COALESCE(SUM(CASE WHEN v.fecha_hecho_economico BETWEEN $1 AND $2 AND v.side = 'debito'
                          THEN v.monto ELSE 0 END), 0)::text AS debitos_periodo,
       COALESCE(SUM(CASE WHEN v.fecha_hecho_economico BETWEEN $1 AND $2 AND v.side = 'credito'
                          THEN v.monto ELSE 0 END), 0)::text AS creditos_periodo
     FROM v_journal_line_reporte v
     WHERE v.fecha_hecho_economico <= $2
     GROUP BY ${expresion}
     ORDER BY ${expresion}`,
    [opciones.desde, opciones.hasta],
  );

  const codigos = rows.map((r) => r.codigo_grupo);
  const nombres = new Map<string, string>();
  if (codigos.length > 0) {
    const { rows: cuentas } = await tx.query<{ codigo: string; nombre: string }>(
      `SELECT codigo, nombre FROM account WHERE codigo = ANY($1::text[])`,
      [codigos],
    );
    for (const c of cuentas) nombres.set(c.codigo, c.nombre);
  }

  return rows.map((r) => {
    const saldoFinal = BigInt(r.saldo_inicial) + BigInt(r.debitos_periodo) - BigInt(r.creditos_periodo);
    return {
      codigoGrupo: r.codigo_grupo,
      nombreGrupo: nombres.get(r.codigo_grupo) ?? '',
      saldoInicial: r.saldo_inicial,
      debitosPeriodo: r.debitos_periodo,
      creditosPeriodo: r.creditos_periodo,
      saldoFinal: saldoFinal.toString(),
    };
  });
}

/** Suma directa del ledger en el rango, sin agrupar: el patrón contra el que A14 compara el balance de prueba. */
export async function sumaDirectaLedger(
  tx: SqlClient,
  rango: RangoFechas,
): Promise<{ totalDebito: string; totalCredito: string }> {
  const { rows } = await tx.query<{ total_debito: string; total_credito: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN side = 'debito'  THEN monto ELSE 0 END), 0)::text AS total_debito,
       COALESCE(SUM(CASE WHEN side = 'credito' THEN monto ELSE 0 END), 0)::text AS total_credito
     FROM v_journal_line_reporte
     WHERE fecha_hecho_economico BETWEEN $1 AND $2`,
    [rango.desde, rango.hasta],
  );
  return { totalDebito: rows[0]!.total_debito, totalCredito: rows[0]!.total_credito };
}

// =============================================================================
// 5. Movimiento de terceros
// =============================================================================

export interface FilaResumenTercero {
  terceroId: string;
  numeroDocumento: string;
  razonSocial: string;
  totalDebito: string;
  totalCredito: string;
  saldo: string;
  movimientos: number;
}

export async function movimientoTercerosResumen(
  tx: SqlClient,
  rango: RangoFechas,
): Promise<FilaResumenTercero[]> {
  const { rows } = await tx.query<{
    tercero_id: string;
    numero_documento: string;
    razon_social: string;
    total_debito: string;
    total_credito: string;
    movimientos: string;
  }>(
    `SELECT
       tp.id AS tercero_id, tp.numero_documento, tp.razon_social,
       COALESCE(SUM(CASE WHEN v.side = 'debito'  THEN v.monto ELSE 0 END), 0)::text AS total_debito,
       COALESCE(SUM(CASE WHEN v.side = 'credito' THEN v.monto ELSE 0 END), 0)::text AS total_credito,
       COUNT(*)::text AS movimientos
     FROM v_journal_line_reporte v
     JOIN third_party tp ON tp.id = v.third_party_id
     WHERE v.fecha_hecho_economico BETWEEN $1 AND $2
     GROUP BY tp.id, tp.numero_documento, tp.razon_social
     ORDER BY tp.razon_social`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({
    terceroId: r.tercero_id,
    numeroDocumento: r.numero_documento,
    razonSocial: r.razon_social,
    totalDebito: r.total_debito,
    totalCredito: r.total_credito,
    saldo: (BigInt(r.total_debito) - BigInt(r.total_credito)).toString(),
    movimientos: Number(r.movimientos),
  }));
}

/** Detalle crudo (una fila por partida) de los movimientos con tercero, para la hoja "Datos". */
export async function movimientoTercerosDetalle(
  tx: SqlClient,
  rango: RangoFechas & { terceroId?: string | null },
): Promise<FilaMovimiento[]> {
  const { rows } = await tx.query<FilaMovimiento>(
    `${SELECT_MOVIMIENTO}
       AND v.third_party_id IS NOT NULL
       AND ($3::uuid IS NULL OR v.third_party_id = $3)
     ORDER BY tp.razon_social, v.fecha_hecho_economico, v.asiento_numero, v.linea`,
    [rango.desde, rango.hasta, rango.terceroId ?? null],
  );
  return rows;
}

// =============================================================================
// 6. Certificado de retenciones por tercero / 7. Relación por período y tipo
// =============================================================================

export interface FilaRetencionAplicada {
  id: string;
  sourceDocumentId: string;
  journalEntryId: string | null;
  terceroId: string | null;
  terceroDocumento: string | null;
  terceroRazonSocial: string | null;
  tipo: string;
  base: string;
  tarifa: string;
  valor: string;
  taxRuleId: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  municipioNombre: string | null;
  conceptoCodigo: string | null;
  conceptoNombre: string | null;
  fechaHechoEconomico: string;
  aplicada: boolean;
  motivoNoAplica: string | null;
  uvtValorUsado: string | null;
  baseMinimaUvtUsada: string | null;
  baseMinimaValorUsada: string | null;
}

const SELECT_RETENCION = `
  SELECT
    ra.id, ra.source_document_id AS "sourceDocumentId", ra.journal_entry_id AS "journalEntryId",
    ra.third_party_id AS "terceroId", tp.numero_documento AS "terceroDocumento", tp.razon_social AS "terceroRazonSocial",
    ra.tipo, ra.base::text AS base, ra.tarifa::text AS tarifa, ra.valor::text AS valor,
    ra.tax_rule_id AS "taxRuleId", ra.regla_vigente_desde::text AS "vigenteDesde",
    ra.regla_vigente_hasta::text AS "vigenteHasta", ra.norma_respaldo AS "normaRespaldo",
    m.nombre AS "municipioNombre", cc.codigo AS "conceptoCodigo", cc.nombre AS "conceptoNombre",
    ra.fecha_hecho_economico::text AS "fechaHechoEconomico", ra.aplicada, ra.motivo_no_aplica AS "motivoNoAplica",
    ra.uvt_valor_usado::text AS "uvtValorUsado", ra.base_minima_uvt_usada::text AS "baseMinimaUvtUsada",
    ra.base_minima_valor_usada::text AS "baseMinimaValorUsada"
  FROM retention_applied ra
  LEFT JOIN third_party tp ON tp.id = ra.third_party_id
  LEFT JOIN municipality m ON m.id = ra.municipality_id
  LEFT JOIN concepto_causacion cc ON cc.id = ra.concepto_causacion_id
`;

/** Certificado de retenciones: todas las retenciones APLICADAS a un tercero en el rango. */
export async function retencionesPorTercero(
  tx: SqlClient,
  opciones: RangoFechas & { terceroId: string },
): Promise<FilaRetencionAplicada[]> {
  const { rows } = await tx.query<FilaRetencionAplicada>(
    `${SELECT_RETENCION}
     WHERE ra.third_party_id = $1
       AND ra.fecha_hecho_economico BETWEEN $2 AND $3
       AND ra.aplicada = true
     ORDER BY ra.tipo, ra.fecha_hecho_economico`,
    [opciones.terceroId, opciones.desde, opciones.hasta],
  );
  return rows;
}

/** Relación de retenciones practicadas por período y tipo: TODO tercero, aplicada o no (para ver el motivo). */
export async function retencionesPorPeriodo(
  tx: SqlClient,
  rango: RangoFechas,
): Promise<FilaRetencionAplicada[]> {
  const { rows } = await tx.query<FilaRetencionAplicada>(
    `${SELECT_RETENCION}
     WHERE ra.fecha_hecho_economico BETWEEN $1 AND $2
     ORDER BY ra.tipo, tp.razon_social, ra.fecha_hecho_economico`,
    [rango.desde, rango.hasta],
  );
  return rows;
}

// =============================================================================
// 8. Detalle de IVA generado y descontable
// =============================================================================

export interface FilaIva extends FilaMovimiento {
  /** `descontable` = cuenta de naturaleza débito (IVA que la empresa puede descontar);
   *  `generado` = cuenta de naturaleza crédito (IVA por pagar). Convención contable
   *  estándar, no un valor tributario: no depende de ninguna tarifa ni código PUC fijo. */
  tipoIva: 'descontable' | 'generado';
}

/**
 * Identifica las cuentas de IVA por su NOMBRE (dato ya cargado en el PUC de
 * cada empresa, sea cual sea su numeración), no por un código PUC quemado en
 * el código fuente: una firma puede tener el IVA descontable en una subcuenta
 * distinta a otra sin que este reporte deje de encontrarlo.
 */
export async function detalleIva(tx: SqlClient, rango: RangoFechas): Promise<FilaIva[]> {
  const { rows } = await tx.query<FilaMovimiento>(
    `${SELECT_MOVIMIENTO} AND v.cuenta_nombre ILIKE '%iva%'
     ORDER BY v.fecha_hecho_economico, v.asiento_numero, v.linea`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({ ...r, tipoIva: r.cuentaNaturaleza === 'debito' ? 'descontable' : 'generado' }));
}

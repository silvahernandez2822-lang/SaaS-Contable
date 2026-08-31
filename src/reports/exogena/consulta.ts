/**
 * A11 — Consultas crudas de los siete formatos núcleo de exógena (1001, 1003,
 * 1005, 1006, 1007, 1008, 1009 — sección 7.7). Todo `SELECT`, ninguna
 * escritura. Fuente siempre `v_journal_line_reporte` (A9: `journal_line` de
 * asientos `posted`, `security_invoker`) o `retention_applied`: ni un filtro
 * de tenant/empresa a mano, decide la RLS (Regla de Oro 7).
 *
 * `app.niif_de_cuenta` y `app.esta_vigente` son funciones YA EXISTENTES
 * (A2/A10, `001_fundacion.sql` y `003_catalogos_contables.sql`): se reutilizan
 * aquí en vez de reimplementar la resolución de vigencia.
 */
import type { SqlClient } from '../../db/types';
import type { RangoExogena } from './tipos';

// =============================================================================
// Formato 1001 — pagos o abonos en cuenta y retenciones practicadas
// =============================================================================

export interface FilaPago1001 {
  terceroId: string;
  valorPagoOAbono: string;
  numeroOperaciones: number;
}

/**
 * Por la partida doble, la suma de las partidas de CRÉDITO de una CAUSACIÓN
 * DE COMPRA (contrapartida + cada retención que le practicaron) es
 * exactamente el "valor del pago o abono en cuenta": la misma cifra que la
 * suma de las partidas de débito de esas mismas causaciones (gasto + IVA
 * descontable). No hay una segunda fuente (`source_document.total_neto`) que
 * pudiera divergir del ledger.
 *
 * Se restringe a créditos con `retention_applied_id` o a la(s) cuenta(s) de
 * contrapartida de compra (`cuentasCandidatas('cuenta_por_pagar', ...)`,
 * la misma lista que usa el Formato 1009): un tercero puede recibir OTROS
 * créditos ajenos a una compra (p. ej. un ingreso registrado manualmente si
 * ese mismo tercero también es cliente) y esos NO son "pago o abono en
 * cuenta" del Formato 1001.
 */
export async function pagosPorTercero1001(tx: SqlClient, rango: RangoExogena): Promise<FilaPago1001[]> {
  const cuentasPago = [...(await cuentasCandidatas(tx, 'cuenta_por_pagar', rango.hasta))];
  const { rows } = await tx.query<{ third_party_id: string; total: string; n: string }>(
    `SELECT v.third_party_id, SUM(v.monto)::text AS total, COUNT(DISTINCT v.journal_entry_id)::text AS n
       FROM v_journal_line_reporte v
      WHERE v.side = 'credito'
        AND v.third_party_id IS NOT NULL
        AND v.fecha_hecho_economico BETWEEN $1 AND $2
        AND (v.retention_applied_id IS NOT NULL OR v.account_id = ANY($3::uuid[]))
      GROUP BY v.third_party_id`,
    [rango.desde, rango.hasta, cuentasPago],
  );
  return rows.map((r) => ({ terceroId: r.third_party_id, valorPagoOAbono: r.total, numeroOperaciones: Number(r.n) }));
}

export interface FilaRetencionPorTipo {
  terceroId: string;
  tipo: string;
  total: string;
  n: number;
}

/** Retenciones APLICADAS (retefuente/reteiva/reteica) agrupadas por tercero y tipo. */
export async function retencionesPorTerceroYTipo(
  tx: SqlClient,
  rango: RangoExogena,
): Promise<FilaRetencionPorTipo[]> {
  const { rows } = await tx.query<{ third_party_id: string; tipo: string; total: string; n: string }>(
    `SELECT third_party_id, tipo, SUM(valor)::text AS total, COUNT(*)::text AS n
       FROM retention_applied
      WHERE aplicada = true
        AND third_party_id IS NOT NULL
        AND tipo IN ('retefuente','reteiva','reteica')
        AND fecha_hecho_economico BETWEEN $1 AND $2
      GROUP BY third_party_id, tipo`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({ terceroId: r.third_party_id, tipo: r.tipo, total: r.total, n: Number(r.n) }));
}

// =============================================================================
// Formato 1003 — retenciones que le practicaron a la empresa informante
// =============================================================================

export interface FilaAutorretencion1003 {
  terceroId: string;
  tipo: string;
  base: string;
  valor: string;
  n: number;
}

/**
 * ADVERTENCIA DE ALCANCE (ver `formatos.ts` y el reporte de este agente): el
 * único cálculo que el motor de reglas (sección 9) produce en la dirección
 * "retención que le practicaron A LA EMPRESA" es la autorretención sobre sus
 * propias compras. El producto no procesa ventas, así que no existe en el
 * ledger la otra fuente natural del Formato 1003 (lo que un CLIENTE retuvo
 * al pagarle a la empresa). Esta consulta trae solo lo primero.
 */
export async function autorretencionPorTercero1003(
  tx: SqlClient,
  rango: RangoExogena,
): Promise<FilaAutorretencion1003[]> {
  const { rows } = await tx.query<{ third_party_id: string; base: string; valor: string; n: string }>(
    `SELECT third_party_id, SUM(base)::text AS base, SUM(valor)::text AS valor, COUNT(*)::text AS n
       FROM retention_applied
      WHERE aplicada = true
        AND third_party_id IS NOT NULL
        AND tipo = 'autorretencion'
        AND fecha_hecho_economico BETWEEN $1 AND $2
      GROUP BY third_party_id`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({ terceroId: r.third_party_id, tipo: 'autorretencion', base: r.base, valor: r.valor, n: Number(r.n) }));
}

/** Movimientos sobre cuentas que el contador mapeó como
 * `retencion_practicada_a_la_empresa` (`exogena_account_mapping`, 130). Vacío
 * si la firma no ha configurado ninguna — no es un error, es la ausencia
 * documentada de esa fuente hasta que se configure. */
export async function retencionMapeadaPorTercero1003(
  tx: SqlClient,
  rango: RangoExogena,
): Promise<FilaAutorretencion1003[]> {
  const { rows } = await tx.query<{ third_party_id: string; valor: string; n: string }>(
    `SELECT v.third_party_id, SUM(v.monto)::text AS valor, COUNT(*)::text AS n
       FROM v_journal_line_reporte v
       JOIN exogena_account_mapping m ON m.account_id = v.account_id
      WHERE m.formato_codigo = '1003'
        AND m.concepto_exogena = 'retencion_practicada_a_la_empresa'
        AND app.esta_vigente(m.vigente_desde, m.vigente_hasta, v.fecha_hecho_economico)
        AND v.side = 'debito'
        AND v.third_party_id IS NOT NULL
        AND v.fecha_hecho_economico BETWEEN $1 AND $2
      GROUP BY v.third_party_id`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({
    terceroId: r.third_party_id,
    tipo: 'mapeada_por_contador',
    base: r.valor,
    valor: r.valor,
    n: Number(r.n),
  }));
}

// =============================================================================
// Formato 1005 (IVA descontable) y 1006 (IVA generado)
// =============================================================================

export interface FilaIvaPorTercero {
  terceroId: string | null;
  valorIva: string;
  n: number;
}

/**
 * Identifica las cuentas de IVA por NOMBRE (`ILIKE '%iva%'`) y clasifica
 * generado/descontable por `naturaleza` de la cuenta — EXACTAMENTE el mismo
 * criterio de `detalleIva` (`src/reports/consulta.ts`, A9): se reimplementa
 * aquí en vez de importarlo porque esta versión agrega por tercero
 * directamente en SQL en lugar de traer el crudo fila por fila.
 */
export async function ivaPorTercero(
  tx: SqlClient,
  rango: RangoExogena,
  tipo: 'descontable' | 'generado',
): Promise<FilaIvaPorTercero[]> {
  const naturaleza = tipo === 'descontable' ? 'debito' : 'credito';
  const { rows } = await tx.query<{ third_party_id: string | null; total: string; n: string }>(
    `SELECT v.third_party_id, SUM(v.monto)::text AS total, COUNT(*)::text AS n
       FROM v_journal_line_reporte v
      WHERE v.cuenta_nombre ILIKE '%iva%'
        AND v.cuenta_naturaleza = $3
        AND v.fecha_hecho_economico BETWEEN $1 AND $2
      GROUP BY v.third_party_id`,
    [rango.desde, rango.hasta, naturaleza],
  );
  return rows.map((r) => ({ terceroId: r.third_party_id, valorIva: r.total, n: Number(r.n) }));
}

// =============================================================================
// Formato 1007 — ingresos recibidos
// =============================================================================

export interface FilaIngreso1007 {
  terceroId: string | null;
  valorIngreso: string;
  n: number;
}

/**
 * `app.niif_de_cuenta(account_id, fecha)` (A10) resuelve la clasificación
 * NIIF vigente A LA FECHA DEL HECHO, con herencia desde un ancestro del PUC
 * si la cuenta hoja no tiene mapeo propio: se reutiliza tal cual, no se
 * reimplementa la resolución de vigencia.
 */
export async function ingresosPorTercero1007(tx: SqlClient, rango: RangoExogena): Promise<FilaIngreso1007[]> {
  const { rows } = await tx.query<{ third_party_id: string | null; total: string; n: string }>(
    `SELECT v.third_party_id, SUM(CASE WHEN v.side = 'credito' THEN v.monto ELSE -v.monto END)::text AS total,
            COUNT(*)::text AS n
       FROM v_journal_line_reporte v
       JOIN LATERAL app.niif_de_cuenta(v.account_id, v.fecha_hecho_economico::date) n ON true
      WHERE n.clasificacion_niif = 'ingreso'
        AND v.fecha_hecho_economico BETWEEN $1 AND $2
      GROUP BY v.third_party_id`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({ terceroId: r.third_party_id, valorIngreso: r.total, n: Number(r.n) }));
}

// =============================================================================
// Formato 1008 (cuentas por cobrar) y 1009 (cuentas por pagar) — saldo al corte
// =============================================================================

export interface FilaSaldoConcepto {
  terceroId: string | null;
  accountId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
}

/**
 * Cuentas candidatas para "cuentas por pagar" (1009): las que el motor de
 * causación (`concepto_causacion.cuenta_contrapartida_id`) usa como
 * contrapartida al causar una compra, más las que el contador mapee
 * explícitamente (`exogena_account_mapping`). Para "cuentas por cobrar"
 * (1008) el producto no causa ninguna venta, así que la ÚNICA fuente posible
 * es el mapeo explícito del contador — si no hay ninguno, la lista es vacía
 * (no es un error: es que la firma no ha configurado esa cuenta todavía).
 */
export async function cuentasCandidatas(
  tx: SqlClient,
  concepto: 'cuenta_por_cobrar' | 'cuenta_por_pagar',
  fechaCorte: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (concepto === 'cuenta_por_pagar') {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT DISTINCT cuenta_contrapartida_id AS id
         FROM concepto_causacion
        WHERE cuenta_contrapartida_id IS NOT NULL AND activo = true`,
    );
    for (const r of rows) ids.add(r.id);
  }
  const { rows: mapeadas } = await tx.query<{ account_id: string }>(
    `SELECT account_id FROM exogena_account_mapping
      WHERE concepto_exogena = $1
        AND app.esta_vigente(vigente_desde, vigente_hasta, $2::date)`,
    [concepto, fechaCorte],
  );
  for (const r of mapeadas) ids.add(r.account_id);
  return ids;
}

/**
 * Saldo NATURAL de cada cuenta candidata (positivo = a favor de la
 * naturaleza contable de la cuenta: débito para CxC, crédito para CxP) al
 * corte `hasta`, por tercero. No asume qué lado es débito o crédito: lo lee
 * de `account.naturaleza`, ya cargada en el PUC de cada empresa.
 */
export async function saldosPorConcepto(
  tx: SqlClient,
  concepto: 'cuenta_por_cobrar' | 'cuenta_por_pagar',
  fechaCorte: string,
): Promise<FilaSaldoConcepto[]> {
  const cuentas = [...(await cuentasCandidatas(tx, concepto, fechaCorte))];
  if (cuentas.length === 0) return [];
  const { rows } = await tx.query<{
    third_party_id: string | null;
    account_id: string;
    cuenta_codigo: string;
    cuenta_nombre: string;
    saldo: string;
  }>(
    `SELECT v.third_party_id, v.account_id, v.cuenta_codigo, v.cuenta_nombre,
            SUM(CASE WHEN v.side = v.cuenta_naturaleza THEN v.monto ELSE -v.monto END)::text AS saldo
       FROM v_journal_line_reporte v
      WHERE v.account_id = ANY($1::uuid[])
        AND v.fecha_hecho_economico <= $2
      GROUP BY v.third_party_id, v.account_id, v.cuenta_codigo, v.cuenta_nombre
      HAVING SUM(CASE WHEN v.side = v.cuenta_naturaleza THEN v.monto ELSE -v.monto END) <> 0`,
    [cuentas, fechaCorte],
  );
  return rows.map((r) => ({
    terceroId: r.third_party_id,
    accountId: r.account_id,
    cuentaCodigo: r.cuenta_codigo,
    cuentaNombre: r.cuenta_nombre,
    saldo: r.saldo,
  }));
}

/**
 * A10 — Consultas de los estados financieros. Todo es `SELECT` sobre
 * `v_journal_line_reporte` (la vista de A9: partidas de asientos PUBLICADOS,
 * `security_invoker`) resuelto contra `niif_mapping` con las dos funciones de
 * la migración 120. Ni un filtro de tenant/empresa a mano: decide la RLS.
 *
 * Este archivo no escribe una sola fila. El único módulo de A10 que escribe en
 * el ledger es el cierre de resultados, que vive en `src/services/cierre.ts`
 * porque escribir es un caso de uso, no un reporte.
 */
import type { SqlClient } from '../../db/types';
import type {
  ActividadEfe,
  AsientoPatrimonio,
  ClasificacionNiif,
  PartidaFlujo,
  SaldoCuenta,
} from './tipos';

export interface RangoEstados {
  desde: string;
  hasta: string;
}

// =============================================================================
// Saldos por cuenta, resueltos contra el mapeo NIIF
// =============================================================================

interface FilaSaldoSql {
  account_id: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_naturaleza: 'debito' | 'credito';
  saldo_inicial: string;
  debitos: string;
  creditos: string;
  saldo_final: string;
  clasificacion_niif: ClasificacionNiif | null;
  seccion_niif: string | null;
  rubro_esf: string | null;
  rubro_eri: string | null;
  resolucion: string | null;
  origen_codigo: string | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  norma_respaldo: string | null;
  requiere_verificacion_humana: boolean | null;
  grupo_codigo: string | null;
  grupo_nombre: string | null;
  cuenta_puc_codigo: string | null;
  cuenta_puc_nombre: string | null;
}

/**
 * Un renglón por cuenta imputable con movimiento, con:
 *  - saldo acumulado al corte (`saldo_final`), signo DEUDOR positivo;
 *  - saldo al día anterior a `desde` (`saldo_inicial`) y movimientos del rango;
 *  - la clasificación NIIF vigente al corte, heredada del PUC si hace falta;
 *  - el grupo (nivel 2) y la cuenta (nivel 3) del PUC, con su nombre real.
 *
 * `excluirCierre` deja fuera los asientos de tipo `cierre`. El Estado de
 * Resultado Integral SIEMPRE los excluye: si no, después del cierre anual el
 * estado del año mostraría ceros, porque el cierre precisamente cancela las
 * cuentas de resultado. El Estado de Situación Financiera NUNCA los excluye:
 * el cierre es el hecho que traslada el resultado al patrimonio y el balance
 * tiene que verlo.
 */
export async function saldosPorCuenta(
  tx: SqlClient,
  opciones: RangoEstados & { excluirCierre: boolean },
): Promise<SaldoCuenta[]> {
  const { rows } = await tx.query<FilaSaldoSql>(
    `WITH saldos AS (
       SELECT
         v.account_id,
         v.cuenta_codigo,
         v.cuenta_nombre,
         v.cuenta_naturaleza,
         COALESCE(SUM(CASE WHEN v.fecha_hecho_economico < $1
                            THEN (CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END)
                            ELSE 0 END), 0) AS saldo_inicial,
         COALESCE(SUM(CASE WHEN v.fecha_hecho_economico BETWEEN $1 AND $2 AND v.side = 'debito'
                            THEN v.monto ELSE 0 END), 0) AS debitos,
         COALESCE(SUM(CASE WHEN v.fecha_hecho_economico BETWEEN $1 AND $2 AND v.side = 'credito'
                            THEN v.monto ELSE 0 END), 0) AS creditos,
         COALESCE(SUM(CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END), 0) AS saldo_final
       FROM v_journal_line_reporte v
       WHERE v.fecha_hecho_economico <= $2
         AND ($3::boolean IS NOT TRUE OR v.asiento_tipo <> 'cierre')
       GROUP BY v.account_id, v.cuenta_codigo, v.cuenta_nombre, v.cuenta_naturaleza
     )
     SELECT
       s.account_id,
       s.cuenta_codigo,
       s.cuenta_nombre,
       s.cuenta_naturaleza,
       s.saldo_inicial::text AS saldo_inicial,
       s.debitos::text       AS debitos,
       s.creditos::text      AS creditos,
       s.saldo_final::text   AS saldo_final,
       n.clasificacion_niif,
       n.seccion_niif,
       n.rubro_esf,
       n.rubro_eri,
       n.resolucion,
       n.origen_codigo,
       n.vigente_desde::text AS vigente_desde,
       n.vigente_hasta::text AS vigente_hasta,
       n.norma_respaldo,
       n.requiere_verificacion_humana,
       g.codigo AS grupo_codigo,
       g.nombre AS grupo_nombre,
       c.codigo AS cuenta_puc_codigo,
       c.nombre AS cuenta_puc_nombre
     FROM saldos s
     LEFT JOIN LATERAL app.niif_de_cuenta(s.account_id, $2::date) n ON true
     LEFT JOIN LATERAL app.ancestro_puc(s.account_id, 2::smallint) g ON true
     LEFT JOIN LATERAL app.ancestro_puc(s.account_id, 3::smallint) c ON true
     ORDER BY s.cuenta_codigo`,
    [opciones.desde, opciones.hasta, opciones.excluirCierre],
  );

  return rows.map((r) => mapearSaldo(r));
}

function mapearSaldo(r: FilaSaldoSql): SaldoCuenta {
  const rubroDeclarado = r.rubro_esf ?? r.rubro_eri;
  const rubroCatalogo = r.grupo_nombre ?? `Grupo PUC ${r.grupo_codigo ?? ''}`.trim();
  return {
    accountId: r.account_id,
    cuentaCodigo: r.cuenta_codigo,
    cuentaNombre: r.cuenta_nombre,
    cuentaNaturaleza: r.cuenta_naturaleza,
    clasificacionNiif: r.clasificacion_niif,
    seccionNiif: r.seccion_niif,
    rubro: rubroDeclarado ?? rubroCatalogo,
    grupoCodigo: r.grupo_codigo ?? '',
    grupoNombre: r.grupo_nombre,
    resolucionNiif:
      r.clasificacion_niif === null
        ? 'sin_mapeo'
        : r.resolucion === 'directa'
          ? 'directa'
          : 'heredada',
    origenCodigo: r.origen_codigo,
    vigenteDesde: r.vigente_desde,
    vigenteHasta: r.vigente_hasta,
    normaRespaldo: r.norma_respaldo,
    requiereVerificacionHumana: r.requiere_verificacion_humana === true,
    saldoFinal: r.saldo_final,
    saldoInicial: r.saldo_inicial,
    debitos: r.debitos,
    creditos: r.creditos,
  };
}

/**
 * El mismo saldo, más el nombre de la cuenta PUC de nivel 3, que es el rótulo
 * del desglose de gastos POR NATURALEZA (sección 5.11(b)): "Gastos de
 * personal", "Honorarios", "Depreciaciones". El nombre sale del catálogo, no
 * de una tabla escrita en TypeScript.
 */
export async function saldosPorCuentaConNaturaleza(
  tx: SqlClient,
  opciones: RangoEstados & { excluirCierre: boolean },
): Promise<{ saldo: SaldoCuenta; naturalezaCodigo: string; naturalezaNombre: string | null }[]> {
  const { rows } = await tx.query<FilaSaldoSql>(
    `WITH saldos AS (
       SELECT
         v.account_id, v.cuenta_codigo, v.cuenta_nombre, v.cuenta_naturaleza,
         0::bigint AS saldo_inicial,
         COALESCE(SUM(CASE WHEN v.side = 'debito'  THEN v.monto ELSE 0 END), 0) AS debitos,
         COALESCE(SUM(CASE WHEN v.side = 'credito' THEN v.monto ELSE 0 END), 0) AS creditos,
         COALESCE(SUM(CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END), 0) AS saldo_final
       FROM v_journal_line_reporte v
       WHERE v.fecha_hecho_economico BETWEEN $1 AND $2
         AND ($3::boolean IS NOT TRUE OR v.asiento_tipo <> 'cierre')
       GROUP BY v.account_id, v.cuenta_codigo, v.cuenta_nombre, v.cuenta_naturaleza
     )
     SELECT
       s.account_id, s.cuenta_codigo, s.cuenta_nombre, s.cuenta_naturaleza,
       s.saldo_inicial::text AS saldo_inicial,
       s.debitos::text AS debitos, s.creditos::text AS creditos,
       s.saldo_final::text AS saldo_final,
       n.clasificacion_niif, n.seccion_niif, n.rubro_esf, n.rubro_eri,
       n.resolucion, n.origen_codigo,
       n.vigente_desde::text AS vigente_desde, n.vigente_hasta::text AS vigente_hasta,
       n.norma_respaldo, n.requiere_verificacion_humana,
       g.codigo AS grupo_codigo, g.nombre AS grupo_nombre,
       c.codigo AS cuenta_puc_codigo, c.nombre AS cuenta_puc_nombre
     FROM saldos s
     LEFT JOIN LATERAL app.niif_de_cuenta(s.account_id, $2::date) n ON true
     LEFT JOIN LATERAL app.ancestro_puc(s.account_id, 2::smallint) g ON true
     LEFT JOIN LATERAL app.ancestro_puc(s.account_id, 3::smallint) c ON true
     ORDER BY s.cuenta_codigo`,
    [opciones.desde, opciones.hasta, opciones.excluirCierre],
  );
  return rows.map((r) => ({
    saldo: mapearSaldo(r),
    naturalezaCodigo: r.cuenta_puc_codigo ?? r.cuenta_codigo,
    naturalezaNombre: r.cuenta_puc_nombre,
  }));
}

// =============================================================================
// Estado de Cambios en el Patrimonio — detalle de asientos
// =============================================================================

/**
 * Los asientos del período que tocaron patrimonio, uno por partida. El ECP
 * exige (sección 6.3) separar el resultado integral, los cambios de política
 * contable, la corrección de errores, los aportes de los propietarios y los
 * dividendos. El LEDGER sabe cuánto se movió y contra qué cuenta; NO sabe si
 * un cargo a resultados acumulados es una corrección de error o una
 * distribución. Esa clasificación es juicio profesional y va al papel de
 * trabajo, con una columna en blanco.
 */
export async function asientosDePatrimonio(
  tx: SqlClient,
  rango: RangoEstados,
): Promise<AsientoPatrimonio[]> {
  const { rows } = await tx.query<{
    journal_entry_id: string;
    asiento_numero: string;
    asiento_tipo: string;
    fecha: string;
    descripcion: string;
    cuenta_codigo: string;
    cuenta_nombre: string;
    side: 'debito' | 'credito';
    monto: string;
  }>(
    `SELECT
       v.journal_entry_id,
       v.asiento_numero::text AS asiento_numero,
       v.asiento_tipo,
       v.fecha_hecho_economico::text AS fecha,
       v.asiento_descripcion AS descripcion,
       v.cuenta_codigo,
       v.cuenta_nombre,
       v.side,
       v.monto::text AS monto
     FROM v_journal_line_reporte v
     LEFT JOIN LATERAL app.niif_de_cuenta(v.account_id, $2::date) n ON true
     WHERE v.fecha_hecho_economico BETWEEN $1 AND $2
       AND n.clasificacion_niif = 'patrimonio'
     ORDER BY v.fecha_hecho_economico, v.asiento_numero, v.linea`,
    [rango.desde, rango.hasta],
  );
  return rows.map((r) => ({
    journalEntryId: r.journal_entry_id,
    asientoNumero: r.asiento_numero,
    asientoTipo: r.asiento_tipo,
    fecha: r.fecha,
    descripcion: r.descripcion,
    cuentaCodigo: r.cuenta_codigo,
    cuentaNombre: r.cuenta_nombre,
    side: r.side,
    monto: r.monto,
  }));
}

// =============================================================================
// Estado de Flujos de Efectivo — método directo
// =============================================================================

/**
 * Las cuentas que el contador marcó como efectivo y equivalentes de efectivo
 * en `niif_mapping.rubro_efe`. Qué es un equivalente de efectivo es una
 * política contable de la entidad (sección 7.2: inversión de alta liquidez,
 * a corto plazo, convertible en efectivo sin riesgo significativo, mantenida
 * para cumplir compromisos de corto plazo): no se deduce del código de la
 * cuenta, la decide un humano. Por eso se lee y no se adivina.
 *
 * Se resuelve a la FECHA DE CORTE (no a la de cada asiento) para que la
 * conciliación «efectivo inicial + flujos = efectivo final» cuadre al centavo
 * aunque la clasificación haya cambiado a mitad del período.
 */
export async function cuentasDeEfectivo(
  tx: SqlClient,
  fechaCorte: string,
): Promise<{ accountId: string; codigo: string; nombre: string }[]> {
  const { rows } = await tx.query<{ account_id: string; codigo: string; nombre: string }>(
    `SELECT DISTINCT v.account_id, v.cuenta_codigo AS codigo, v.cuenta_nombre AS nombre
       FROM v_journal_line_reporte v
       JOIN LATERAL app.niif_de_cuenta(v.account_id, $1::date) n ON true
      WHERE n.es_efectivo
      ORDER BY v.cuenta_codigo`,
    [fechaCorte],
  );
  return rows.map((r) => ({ accountId: r.account_id, codigo: r.codigo, nombre: r.nombre }));
}

/** Saldo de efectivo y equivalentes a una fecha, con la clasificación resuelta al corte. */
export async function saldoDeEfectivo(
  tx: SqlClient,
  opciones: { fecha: string; fechaClasificacion: string },
): Promise<string> {
  const { rows } = await tx.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END), 0)::text AS saldo
       FROM v_journal_line_reporte v
       JOIN LATERAL app.niif_de_cuenta(v.account_id, $2::date) n ON true
      WHERE v.fecha_hecho_economico <= $1
        AND n.es_efectivo`,
    [opciones.fecha, opciones.fechaClasificacion],
  );
  return rows[0]?.saldo ?? '0';
}

/**
 * Las partidas del EFE por método directo.
 *
 * IDENTIDAD QUE LO HACE EXACTO, sin prorrateos ni redondeos: en un asiento
 * balanceado la suma de todas las partidas con signo (débito +, crédito −) es
 * cero. Luego, en cualquier asiento que toque efectivo, la suma de las
 * partidas de NO efectivo es exactamente el negativo del movimiento de
 * efectivo. Así, clasificar cada contrapartida por su actividad y cambiarle el
 * signo descompone el flujo de caja al centavo, sin repartir nada a prorrata.
 *
 * Un traslado entre dos cuentas de efectivo no genera ninguna fila (no tiene
 * contrapartidas fuera del efectivo), que es justo lo que exige la sección 7.3.
 */
export async function partidasDeFlujo(
  tx: SqlClient,
  rango: RangoEstados,
): Promise<PartidaFlujo[]> {
  const { rows } = await tx.query<{
    journal_entry_id: string;
    asiento_numero: string;
    fecha: string;
    cuenta_codigo: string;
    cuenta_nombre: string;
    rubro: string | null;
    grupo_nombre: string | null;
    grupo_codigo: string | null;
    actividad: string | null;
    actividad_origen: string | null;
    flujo: string;
    tercero_razon_social: string | null;
  }>(
    `WITH lineas AS (
       SELECT v.journal_entry_id, v.asiento_numero, v.linea, v.side, v.monto,
              v.account_id, v.cuenta_codigo, v.cuenta_nombre, v.third_party_id,
              v.fecha_hecho_economico,
              n.clasificacion_niif, n.rubro_efe, n.es_efectivo,
              n.actividad_efe, n.actividad_efe_origen
         FROM v_journal_line_reporte v
         LEFT JOIN LATERAL app.niif_de_cuenta(v.account_id, $2::date) n ON true
        WHERE v.fecha_hecho_economico BETWEEN $1 AND $2
     ),
     asientos_con_efectivo AS (
       SELECT DISTINCT journal_entry_id FROM lineas WHERE es_efectivo IS TRUE
     )
     SELECT
       l.journal_entry_id,
       l.asiento_numero::text AS asiento_numero,
       l.fecha_hecho_economico::text AS fecha,
       l.cuenta_codigo,
       l.cuenta_nombre,
       l.rubro_efe AS rubro,
       g.nombre AS grupo_nombre,
       g.codigo AS grupo_codigo,
       l.actividad_efe AS actividad,
       CASE WHEN l.clasificacion_niif IS NULL THEN 'sin_mapeo' ELSE l.actividad_efe_origen END AS actividad_origen,
       (-1 * (CASE WHEN l.side = 'debito' THEN l.monto ELSE -l.monto END))::text AS flujo,
       tp.razon_social AS tercero_razon_social
     FROM lineas l
     JOIN asientos_con_efectivo ae ON ae.journal_entry_id = l.journal_entry_id
     LEFT JOIN LATERAL app.ancestro_puc(l.account_id, 2::smallint) g ON true
     LEFT JOIN third_party tp ON tp.id = l.third_party_id
     WHERE COALESCE(l.es_efectivo, false) = false
     ORDER BY l.fecha_hecho_economico, l.asiento_numero, l.linea`,
    [rango.desde, rango.hasta],
  );

  return rows.map((r) => ({
    journalEntryId: r.journal_entry_id,
    asientoNumero: r.asiento_numero,
    fecha: r.fecha,
    cuentaCodigo: r.cuenta_codigo,
    cuentaNombre: r.cuenta_nombre,
    rubro: r.rubro ?? r.grupo_nombre ?? `Grupo PUC ${r.grupo_codigo ?? ''}`.trim(),
    actividad: normalizarActividad(r.actividad_origen, r.actividad),
    actividadOrigen:
      r.actividad_origen === 'declarada'
        ? 'declarada'
        : r.actividad_origen === 'presumida'
          ? 'presumida'
          : 'sin_mapeo',
    flujo: r.flujo,
    terceroRazonSocial: r.tercero_razon_social,
  }));
}

function normalizarActividad(origen: string | null, actividad: string | null): ActividadEfe {
  if (origen === 'sin_mapeo' || actividad === null) return 'sin_clasificar';
  if (actividad === 'operacion' || actividad === 'inversion' || actividad === 'financiacion') {
    return actividad;
  }
  return 'sin_clasificar';
}

// =============================================================================
// Hoja "Parámetros" (sección 11.2) — el mapeo NIIF ES el parámetro
// =============================================================================

/**
 * Los mapeos NIIF realmente usados por los estados del corte, con su vigencia
 * y su norma de respaldo. Es lo que hace el reporte autoexplicativo dentro de
 * seis meses: sin esto, un estado financiero de hace un año no dice bajo qué
 * clasificación se armó, y `niif_mapping` es paramétrico y versionado — pudo
 * cambiar desde entonces.
 */
export interface FilaMapeoNiifUsado {
  origenCodigo: string;
  origenNombre: string | null;
  clasificacionNiif: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  requiereVerificacionHumana: boolean;
  cuentasAfectadas: number;
}

export async function mapeosNiifUsados(
  tx: SqlClient,
  fechaCorte: string,
): Promise<FilaMapeoNiifUsado[]> {
  const { rows } = await tx.query<{
    origen_codigo: string;
    origen_nombre: string | null;
    clasificacion_niif: string;
    vigente_desde: string;
    vigente_hasta: string | null;
    norma_respaldo: string;
    requiere_verificacion_humana: boolean;
    cuentas_afectadas: number;
  }>(
    `WITH cuentas AS (
       SELECT DISTINCT v.account_id
         FROM v_journal_line_reporte v
        WHERE v.fecha_hecho_economico <= $1
     ),
     resueltas AS (
       SELECT c.account_id, n.*
         FROM cuentas c
         JOIN LATERAL app.niif_de_cuenta(c.account_id, $1::date) n ON true
     )
     SELECT
       r.origen_codigo,
       a.nombre AS origen_nombre,
       r.clasificacion_niif,
       r.vigente_desde::text AS vigente_desde,
       r.vigente_hasta::text AS vigente_hasta,
       r.norma_respaldo,
       bool_or(r.requiere_verificacion_humana) AS requiere_verificacion_humana,
       count(*)::int AS cuentas_afectadas
     FROM resueltas r
     LEFT JOIN account a ON a.id = r.origen_account_id
     GROUP BY r.origen_codigo, a.nombre, r.clasificacion_niif,
              r.vigente_desde, r.vigente_hasta, r.norma_respaldo
     ORDER BY r.origen_codigo`,
    [fechaCorte],
  );
  return rows.map((r) => ({
    origenCodigo: r.origen_codigo,
    origenNombre: r.origen_nombre,
    clasificacionNiif: r.clasificacion_niif,
    vigenteDesde: r.vigente_desde,
    vigenteHasta: r.vigente_hasta,
    normaRespaldo: r.norma_respaldo,
    requiereVerificacionHumana: r.requiere_verificacion_humana === true,
    cuentasAfectadas: r.cuentas_afectadas,
  }));
}

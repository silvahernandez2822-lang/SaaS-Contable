-- =============================================================================
-- 110_a9_vistas_reportes.sql — A9, Ola 3: vista base para los libros exportables
--
-- Los ocho reportes obligatorios de la sección 11.3 (libro auxiliar, diario,
-- mayor, balance de prueba, certificado de retenciones, relación de
-- retenciones, movimiento de terceros y detalle de IVA) leen todos la misma
-- forma: una partida de un asiento PUBLICADO, con su cuenta y su asiento ya
-- desnormalizados. En vez de repetir el mismo JOIN de tres tablas en ocho
-- consultas distintas, se deja una sola vista.
--
-- `security_invoker = true` (igual que 011_vistas.sql): sin esa opción la
-- vista correría con los privilegios de su dueño y saltaría la RLS de
-- `journal_line`/`journal_entry`/`account` — una puerta trasera al
-- aislamiento entre tenants (Regla de Oro 7). Con ella, cualquier consulta
-- sobre la vista queda tan restringida como si se consultaran las tablas
-- base directamente: es exactamente por eso que el balance de prueba armado
-- sobre esta vista cuadra al centavo contra la suma directa del ledger — no
-- hay ninguna fila que la vista vea y la tabla base no, ni al revés.
--
-- Solo asientos 'posted': un borrador no es un hecho contable todavía, y esta
-- vista es la que alimenta reportes fiscales/financieros, nunca la bandeja de
-- trabajo en curso (esa la sirve A6/A7 directamente sobre journal_entry).
-- =============================================================================

CREATE VIEW v_journal_line_reporte WITH (security_invoker = true) AS
SELECT
  jl.id                   AS journal_line_id,
  jl.tenant_id,
  jl.company_id,
  jl.journal_entry_id,
  jl.linea,
  jl.account_id,
  a.codigo                AS cuenta_codigo,
  a.nombre                AS cuenta_nombre,
  a.naturaleza             AS cuenta_naturaleza,
  a.nivel                 AS cuenta_nivel,
  jl.side,
  jl.monto,
  jl.third_party_id,
  jl.cost_center_id,
  jl.retention_applied_id,
  jl.base_gravable,
  jl.descripcion          AS linea_descripcion,
  je.numero               AS asiento_numero,
  je.tipo                 AS asiento_tipo,
  je.fecha_hecho_economico,
  je.descripcion          AS asiento_descripcion,
  je.source_document_id,
  je.fiscal_period_id,
  je.posted_at,
  je.reverses_entry_id
FROM journal_line jl
JOIN journal_entry je ON je.id = jl.journal_entry_id
JOIN account a        ON a.id = jl.account_id
WHERE je.estado = 'posted';

COMMENT ON VIEW v_journal_line_reporte IS
  'A9 (Ola 3): partidas de asientos PUBLICADOS con cuenta y asiento desnormalizados. Base de los ocho reportes de la sección 11.3. RLS heredada por security_invoker: nunca ve más filas que las tablas base.';

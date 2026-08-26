-- =============================================================================
-- 011_vistas.sql — Vistas de lectura
--
-- TODAS llevan `security_invoker = true`. Sin esa opción una vista se ejecuta
-- con los privilegios de su dueño y SALTA la RLS de las tablas base: sería una
-- puerta trasera al aislamiento entre tenants (Regla de Oro 7).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_journal_entry — el asiento con su reversa derivada.
-- `reversed_by` no existe como columna física porque marcarla exigiría un
-- UPDATE sobre un asiento publicado. Aquí se deriva del asiento de reversa.
-- -----------------------------------------------------------------------------
CREATE VIEW v_journal_entry WITH (security_invoker = true) AS
SELECT
  je.*,
  rev.id        AS reversed_by,
  rev.numero    AS reversed_by_numero,
  rev.posted_at AS reversed_at,
  (rev.id IS NOT NULL) AS esta_reversado
FROM journal_entry je
LEFT JOIN journal_entry rev
       ON rev.reverses_entry_id = je.id
      AND rev.estado = 'posted';

COMMENT ON VIEW v_journal_entry IS
  'journal_entry + reversed_by derivado. Usar esta vista para consultar; el ledger físico es append-only.';

-- -----------------------------------------------------------------------------
-- v_journal_entry_balance — control de cuadre por asiento (A9 y A14).
-- -----------------------------------------------------------------------------
CREATE VIEW v_journal_entry_balance WITH (security_invoker = true) AS
SELECT
  je.id            AS journal_entry_id,
  je.tenant_id,
  je.company_id,
  je.numero,
  je.estado,
  count(jl.id)                                                              AS partidas,
  COALESCE(SUM(CASE WHEN jl.side = 'debito'  THEN jl.monto ELSE 0 END), 0)  AS total_debito,
  COALESCE(SUM(CASE WHEN jl.side = 'credito' THEN jl.monto ELSE 0 END), 0)  AS total_credito,
  COALESCE(SUM(CASE WHEN jl.side = 'debito'  THEN jl.monto ELSE -jl.monto END), 0) AS descuadre
FROM journal_entry je
LEFT JOIN journal_line jl ON jl.journal_entry_id = je.id
GROUP BY je.id, je.tenant_id, je.company_id, je.numero, je.estado;

-- -----------------------------------------------------------------------------
-- v_third_party_vigente — el tercero con sus atributos fiscales de HOY.
-- Es la forma que describe la sección 15. El motor de reglas NO debe usar esta
-- vista: debe resolver por la fecha del hecho económico contra
-- third_party_fiscal_attribute (Regla de Oro 3).
-- -----------------------------------------------------------------------------
CREATE VIEW v_third_party_vigente WITH (security_invoker = true) AS
SELECT
  tp.*,
  fa.id                        AS fiscal_attribute_id,
  fa.es_declarante_renta,
  fa.es_autorretenedor_renta,
  fa.es_gran_contribuyente,
  fa.es_regimen_simple,
  fa.es_responsable_iva,
  fa.es_agente_retencion_renta,
  fa.es_agente_retencion_iva,
  fa.es_agente_retencion_ica,
  fa.es_autorretenedor_ica,
  fa.regimen_tributario,
  fa.vigente_desde  AS atributos_vigentes_desde,
  fa.vigente_hasta  AS atributos_vigentes_hasta,
  fa.norma_respaldo AS atributos_norma_respaldo
FROM third_party tp
LEFT JOIN third_party_fiscal_attribute fa
       ON fa.third_party_id = tp.id
      AND app.esta_vigente(fa.vigente_desde, fa.vigente_hasta, CURRENT_DATE);

COMMENT ON VIEW v_third_party_vigente IS
  'Solo para interfaz. El motor de reglas resuelve los atributos por fecha del hecho económico, no por CURRENT_DATE.';

-- -----------------------------------------------------------------------------
-- v_user_permission — permisos efectivos de cada usuario por empresa.
-- Base para el control de acceso que implementa A12.
-- -----------------------------------------------------------------------------
CREATE VIEW v_user_permission WITH (security_invoker = true) AS
SELECT
  uca.tenant_id,
  uca.company_id,
  uca.user_id,
  r.id      AS role_id,
  r.codigo  AS role_codigo,
  rp.permission_codigo,
  p.modulo
FROM user_company_access uca
JOIN role r            ON r.id = uca.role_id
JOIN role_permission rp ON rp.role_id = r.id
JOIN permission p      ON p.codigo = rp.permission_codigo
WHERE uca.revocado_en IS NULL;

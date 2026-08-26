-- =============================================================================
-- 012_rls.sql — Row Level Security de doble nivel (Regla de Oro 7)
--
-- Todas las tablas llevan ENABLE + FORCE ROW LEVEL SECURITY. Sin FORCE, el
-- dueño de la tabla queda exento y la política se vuelve decorativa.
--
-- Un SUPERUSUARIO sigue saltándose RLS: por eso la aplicación se conecta como
-- `app_user` (D-004) y por eso las pruebas de aislamiento corren con SET ROLE.
-- Las migraciones y los seeds sí requieren superusuario o BYPASSRLS, porque
-- escriben las filas globales (tenant_id IS NULL) que ninguna política permite
-- escribir desde la aplicación.
--
-- Tres formas de política:
--   A. tenant+company estrictos  -> datos de una empresa
--   B. tenant estricto           -> datos de la firma sin empresa
--   C. híbrida                   -> catálogo global legible + override propio
-- =============================================================================

CREATE OR REPLACE FUNCTION app.instalar_rls_tenant_company(p_tabla text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_tabla);
  EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', p_tabla);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL
       USING      (tenant_id = app.current_tenant_id() AND company_id = app.current_company_id())
       WITH CHECK (tenant_id = app.current_tenant_id() AND company_id = app.current_company_id())',
    p_tabla || '_rls', p_tabla);
END $$;

CREATE OR REPLACE FUNCTION app.instalar_rls_tenant(p_tabla text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_tabla);
  EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', p_tabla);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL
       USING      (tenant_id = app.current_tenant_id())
       WITH CHECK (tenant_id = app.current_tenant_id())',
    p_tabla || '_rls', p_tabla);
END $$;

CREATE OR REPLACE FUNCTION app.instalar_rls_hibrida(p_tabla text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_tabla);
  EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', p_tabla);
  -- Lee lo global y lo propio; solo escribe lo propio.
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL
       USING      ((tenant_id IS NULL OR tenant_id = app.current_tenant_id())
                   AND (company_id IS NULL OR company_id = app.current_company_id()))
       WITH CHECK (tenant_id = app.current_tenant_id()
                   AND (company_id IS NULL OR company_id = app.current_company_id()))',
    p_tabla || '_rls', p_tabla);
END $$;

CREATE OR REPLACE FUNCTION app.instalar_rls_hibrida_tenant(p_tabla text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_tabla);
  EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', p_tabla);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL
       USING      (tenant_id IS NULL OR tenant_id = app.current_tenant_id())
       WITH CHECK (tenant_id = app.current_tenant_id())',
    p_tabla || '_rls', p_tabla);
END $$;

-- -----------------------------------------------------------------------------
-- A. Datos de una empresa: tenant Y company obligatorios
-- -----------------------------------------------------------------------------
SELECT app.instalar_rls_tenant_company('fiscal_period');
SELECT app.instalar_rls_tenant_company('user_company_access');
SELECT app.instalar_rls_tenant_company('cost_center');
SELECT app.instalar_rls_tenant_company('third_party');
SELECT app.instalar_rls_tenant_company('third_party_fiscal_attribute');
SELECT app.instalar_rls_tenant_company('third_party_activity');
SELECT app.instalar_rls_tenant_company('memoria_clasificacion');
SELECT app.instalar_rls_tenant_company('company_setting');
SELECT app.instalar_rls_tenant_company('source_document');
SELECT app.instalar_rls_tenant_company('extraction');
SELECT app.instalar_rls_tenant_company('retention_applied');
SELECT app.instalar_rls_tenant_company('approval');
SELECT app.instalar_rls_tenant_company('journal_entry');
SELECT app.instalar_rls_tenant_company('journal_line');

-- -----------------------------------------------------------------------------
-- B. Datos de la firma sin empresa
-- -----------------------------------------------------------------------------
SELECT app.instalar_rls_tenant('company');
SELECT app.instalar_rls_tenant('user');
SELECT app.instalar_rls_tenant('user_session');

-- La firma solo se ve a sí misma.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_rls ON tenant FOR ALL
  USING      (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

-- -----------------------------------------------------------------------------
-- C. Catálogos híbridos: fila global (tenant_id IS NULL) legible por todos,
--    override propio escribible por su dueño.
-- -----------------------------------------------------------------------------
SELECT app.instalar_rls_hibrida('account');
SELECT app.instalar_rls_hibrida('niif_mapping');
SELECT app.instalar_rls_hibrida('municipality');
SELECT app.instalar_rls_hibrida('municipality_ica_rule');
SELECT app.instalar_rls_hibrida('ciiu_activity');
SELECT app.instalar_rls_hibrida('uvt_value');
SELECT app.instalar_rls_hibrida('smmlv_value');
SELECT app.instalar_rls_hibrida('rounding_rule');
SELECT app.instalar_rls_hibrida('tax_concept');
SELECT app.instalar_rls_hibrida('tax_rule');
SELECT app.instalar_rls_hibrida('tax_calendar');
SELECT app.instalar_rls_hibrida('concepto_causacion');

SELECT app.instalar_rls_hibrida_tenant('role');

-- -----------------------------------------------------------------------------
-- Casos particulares
-- -----------------------------------------------------------------------------

-- permission: catálogo de código, no dato de negocio. Solo lectura (ver 013).
ALTER TABLE permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission FORCE  ROW LEVEL SECURITY;
CREATE POLICY permission_rls ON permission FOR ALL
  USING (true) WITH CHECK (false);

-- role_permission: se ve y se edita a través del alcance de su rol.
ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permission FORCE  ROW LEVEL SECURITY;
CREATE POLICY role_permission_rls ON role_permission FOR ALL
  USING (EXISTS (
    SELECT 1 FROM role r
     WHERE r.id = role_permission.role_id
       AND (r.tenant_id IS NULL OR r.tenant_id = app.current_tenant_id())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM role r
     WHERE r.id = role_permission.role_id
       AND r.tenant_id = app.current_tenant_id()));

-- audit_log: company_id opcional (hay acciones de firma, no de empresa).
-- Las filas globales (tenant_id NULL) son de administración del sistema y no
-- las ve ningún tenant.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY audit_log_rls ON audit_log FOR ALL
  USING      (tenant_id = app.current_tenant_id()
              AND (company_id IS NULL OR company_id = app.current_company_id()))
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND (company_id IS NULL OR company_id = app.current_company_id()));

-- =============================================================================
-- 009_control.sql — approval y audit_log
--
-- `approval` es la aprobación humana obligatoria: además de ser el control que
-- exige la sección 14.1, es la defensa legal de la sección 8 y la razón por la
-- que `journal_entry.approval_id` es NOT NULL.
--
-- `audit_log` es estrictamente append-only a nivel de base de datos: ni el
-- dueño de la tabla puede hacer UPDATE o DELETE sobre él.
-- =============================================================================

CREATE TABLE approval (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  company_id          uuid NOT NULL REFERENCES company(id),
  entidad             text NOT NULL CHECK (entidad IN (
                        'source_document','journal_entry','cambio_parametro',
                        'cierre_periodo','memoria_clasificacion')),
  entidad_id          uuid NOT NULL,
  source_document_id  uuid REFERENCES source_document(id),
  decision            text NOT NULL CHECK (decision IN ('aprobado','rechazado','devuelto')),
  user_id             uuid NOT NULL REFERENCES "user"(id),
  decidido_en         timestamptz NOT NULL DEFAULT now(),
  ip                  inet NOT NULL,
  user_agent          text,
  motivo              text,
  lote_id             uuid,   -- aprobación en lote desde la bandeja (A7)
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT approval_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT approval_user_fk FOREIGN KEY (user_id, tenant_id)
    REFERENCES "user" (id, tenant_id),
  CONSTRAINT approval_documento_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT approval_documento_ck
    CHECK (entidad <> 'source_document' OR source_document_id IS NOT NULL),
  CONSTRAINT approval_rechazo_ck
    CHECK (decision = 'aprobado' OR motivo IS NOT NULL)
);

CREATE INDEX approval_entidad_idx  ON approval (entidad, entidad_id);
CREATE INDEX approval_scope_idx    ON approval (tenant_id, company_id, decidido_en);
CREATE INDEX approval_documento_idx ON approval (source_document_id);

-- La aprobación también es inmutable: se aprueba o se rechaza, no se reescribe.
CREATE TRIGGER approval_append_only
  BEFORE UPDATE OR DELETE ON approval
  FOR EACH ROW EXECUTE FUNCTION app.trg_append_only();

-- -----------------------------------------------------------------------------
-- audit_log — toda acción sensible (sección 14.1): aprobaciones, ediciones de
-- parámetros, cambios de mapeo PUC, accesos a datos de otra empresa.
-- tenant_id es NULL solo para cambios sobre catálogos globales, que únicamente
-- puede hacer un administrador del sistema (rol con BYPASSRLS).
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid REFERENCES tenant(id),
  company_id      uuid REFERENCES company(id),
  user_id         uuid REFERENCES "user"(id),
  db_user         text NOT NULL DEFAULT current_user,
  accion          text NOT NULL CHECK (accion IN ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT','ACCESO_DENEGADO','APROBACION','PUBLICACION','REVERSA')),
  entidad         text NOT NULL,
  entidad_id      text,
  valor_anterior  jsonb,
  valor_nuevo     jsonb,
  norma_respaldo  text,
  ip              inet,
  user_agent      text,
  request_id      text,
  ocurrido_en     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_scope_idx   ON audit_log (tenant_id, company_id, ocurrido_en DESC);
CREATE INDEX audit_log_entidad_idx ON audit_log (entidad, entidad_id);
CREATE INDEX audit_log_user_idx    ON audit_log (user_id, ocurrido_en DESC);

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.trg_append_only();

COMMENT ON TABLE audit_log IS
  'Append-only impuesto por trigger (AU001). Ni UPDATE ni DELETE, ni siquiera para el dueño de la tabla.';

-- -----------------------------------------------------------------------------
-- Trigger genérico de auditoría. Se instala sobre las tablas paramétricas y de
-- control. Toma tenant/company de la propia fila cuando existen.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_audit() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_old  jsonb;
  v_new  jsonb;
  v_row  jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_new := NULL; v_row := v_old;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_row := v_new;
  ELSE
    v_old := NULL; v_new := to_jsonb(NEW); v_row := v_new;
  END IF;

  INSERT INTO audit_log (
    tenant_id, company_id, user_id, accion, entidad, entidad_id,
    valor_anterior, valor_nuevo, norma_respaldo, ip, user_agent, request_id
  ) VALUES (
    COALESCE(NULLIF(v_row->>'tenant_id',  '')::uuid, app.current_tenant_id()),
    COALESCE(NULLIF(v_row->>'company_id', '')::uuid, app.current_company_id()),
    app.current_user_id(),
    TG_OP,
    TG_TABLE_NAME,
    v_row->>'id',
    v_old,
    v_new,
    v_row->>'norma_respaldo',
    app.current_ip(),
    NULLIF(current_setting('app.user_agent', true), ''),
    app.current_request_id()
  );

  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.instalar_trigger_auditoria(p_tabla text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.trg_audit()',
    p_tabla || '_audit', p_tabla);
END $$;

-- Tablas paramétricas: toda edición queda auditada (sección 6.2, punto 4).
SELECT app.instalar_trigger_auditoria('tax_rule');
SELECT app.instalar_trigger_auditoria('tax_concept');
SELECT app.instalar_trigger_auditoria('tax_calendar');
SELECT app.instalar_trigger_auditoria('uvt_value');
SELECT app.instalar_trigger_auditoria('smmlv_value');
SELECT app.instalar_trigger_auditoria('rounding_rule');
SELECT app.instalar_trigger_auditoria('municipality_ica_rule');
SELECT app.instalar_trigger_auditoria('niif_mapping');
SELECT app.instalar_trigger_auditoria('third_party_fiscal_attribute');
SELECT app.instalar_trigger_auditoria('third_party_activity');
-- Catálogos contables y de clasificación
SELECT app.instalar_trigger_auditoria('account');
SELECT app.instalar_trigger_auditoria('concepto_causacion');
SELECT app.instalar_trigger_auditoria('memoria_clasificacion');
SELECT app.instalar_trigger_auditoria('company_setting');
-- Control de acceso
SELECT app.instalar_trigger_auditoria('user_company_access');
SELECT app.instalar_trigger_auditoria('role');
SELECT app.instalar_trigger_auditoria('role_permission');
SELECT app.instalar_trigger_auditoria('approval');

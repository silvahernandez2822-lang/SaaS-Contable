-- =============================================================================
-- 091_a13_integraciones_registro.sql — Agente A13, Ola 2 (rango 090-099)
--
-- `integration_call_log` — sección 13.3: "todo llamado entrante y saliente
-- queda registrado". Distinto de `email_ingest_log` (A4, 030): aquella es la
-- traza de negocio de UN correo (remitente, adjuntos, resultado del
-- pipeline). Esta es la traza de PROTOCOLO de la integración en sí (quién
-- llamó, con qué credencial, cuándo, con qué resultado HTTP) — incluye
-- llamadas que ni siquiera llegan a identificar un correo (token ausente o
-- inválido), que `email_ingest_log` no puede representar sin abrir de nuevo
-- el hueco de V-1 (no hay tenant que atribuirle a una llamada no autenticada).
--
-- `direccion`: 'entrante' para toda llamada que otro sistema (n8n) le hace a
-- esta aplicación (ingesta de correo, consultas de notificaciones); 'saliente'
-- queda MODELADA para cuando esta aplicación llame hacia afuera (un banco, un
-- proveedor tecnológico, un webhook de n8n) — sección 13.1 lo declara como
-- integración FUTURA. Ninguna fila 'saliente' se escribe todavía: declarar la
-- columna sin ejercitarla sería peor que no tenerla si se afirmara lo
-- contrario, así que se deja dicho aquí, sin adornar (mismo criterio que V-5).
--
-- MISMO PATRÓN DE `audit_log`/`email_ingest_log` para tenant_id NULL: una
-- llamada que no superó la autenticación (token ausente, inválido o
-- revocado) no tiene firma a la que atribuirle nada — se registra con
-- tenant_id/company_id NULL, invisible para cualquier tenant, solo legible en
-- contexto de administración. Append-only (Regla de Oro 6): una llamada ya
-- registrada no se corrige.
-- =============================================================================

CREATE TABLE integration_call_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenant(id),
  company_id         uuid REFERENCES company(id),
  direccion          text NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  canal              text NOT NULL CHECK (canal IN ('correo', 'notificaciones', 'mantenimiento')),
  endpoint           text NOT NULL,
  resultado          text NOT NULL CHECK (resultado IN (
                        'ok', 'rechazado', 'no_autenticado', 'error', 'buzon_no_reconocido'
                      )),
  http_status        integer,
  detalle            text,
  duracion_ms        integer CHECK (duracion_ms IS NULL OR duracion_ms >= 0),
  ip                 inet,
  user_agent         text,
  request_id         text,
  ocurrido_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_call_log_scope_ck
    CHECK ((tenant_id IS NULL AND company_id IS NULL) OR tenant_id IS NOT NULL),
  CONSTRAINT integration_call_log_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id)
);

CREATE INDEX integration_call_log_tenant_idx ON integration_call_log (tenant_id, ocurrido_en DESC);
CREATE INDEX integration_call_log_canal_idx  ON integration_call_log (canal, ocurrido_en DESC);

COMMENT ON TABLE integration_call_log IS
  'Registro append-only de todo llamado de integración, entrante o saliente (sección 13.3). tenant_id NULL = llamada que no superó la autenticación (mismo patrón que audit_log/email_ingest_log): no la ve ningún tenant.';

SELECT app.instalar_guardia_alcance('integration_call_log', 'company_id', 'company');

-- RLS: copiada del mismo patrón de email_ingest_log (030) / audit_log (009).
ALTER TABLE integration_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_call_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY integration_call_log_rls ON integration_call_log FOR ALL
  USING      (tenant_id = app.current_tenant_id()
              AND (company_id IS NULL OR company_id = app.current_company_id()))
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND (company_id IS NULL OR company_id = app.current_company_id()));

CREATE TRIGGER integration_call_log_append_only
  BEFORE UPDATE OR DELETE ON integration_call_log
  FOR EACH ROW EXECUTE FUNCTION app.trg_append_only();

-- app_user registra sus propias llamadas ya autenticadas (tenant conocido);
-- app_auth registra las que fallan la autenticación (tenant NULL) — mismo
-- reparto que audit_log/ACCESO_DENEGADO (015/016).
GRANT SELECT, INSERT ON integration_call_log TO app_user, app_auth;

-- app_auth solo puede insertar filas sin atribuir a ninguna firma: el mismo
-- perímetro que ya tiene sobre audit_log (015, audit_log_evento_autenticacion).
CREATE POLICY integration_call_log_no_autenticado ON integration_call_log FOR INSERT TO app_auth
  WITH CHECK (tenant_id IS NULL AND company_id IS NULL AND resultado = 'no_autenticado');

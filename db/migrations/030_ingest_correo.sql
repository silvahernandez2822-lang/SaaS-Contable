-- =============================================================================
-- 030_ingest_correo.sql — A4, Ola 1: registro del pipeline de recepción de
-- correo (sección 10.1 y 10.3).
--
-- El esquema de negocio está CONGELADO (Ola 0). Esta migración NO toca
-- `source_document`, `extraction` ni el espacio RADIAN que A2 dejó reservado
-- en 008_documentos.sql: solo agrega las dos tablas de auditoría del canal de
-- correo que la sección 10.3 exige y que Ola 0 no modeló porque el ingest es
-- trabajo de la Ola 1.
--
-- `email_ingest_log` — una fila por correo recibido en un buzón dedicado,
-- SIEMPRE, incluido el correo dirigido a un buzón que no existe (D-006/D-015:
-- el rechazo también se registra, sección 10.3 "registro de todo correo
-- recibido, procesado o rechazado, con motivo"). Por eso `tenant_id` y
-- `company_id` son NULOS aquí — a diferencia de toda tabla de datos de
-- negocio, que exige NOT NULL — exactamente el mismo patrón que `audit_log`
-- (009_control.sql): un correo a un buzón no reconocido no tiene firma que le
-- pertenezca, y la política RLS de abajo, copiada literalmente de la de
-- `audit_log`, hace esas filas invisibles a cualquier tenant y solo
-- consultables por un administrador (`asAdmin`). No es una tabla de catálogo
-- híbrido (D-015): NULL no significa "global y legible por todos", significa
-- "no se pudo atribuir", así que NO se usa `instalar_rls_hibrida`.
--
-- `email_ingest_attachment` — una fila por adjunto de ese correo, solo cuando
-- el buzón SÍ se reconoció (si no, no hay company_id con qué acotarla, y no
-- tiene sentido procesar adjuntos de un buzón ajeno al sistema). Aquí
-- `tenant_id`/`company_id` SÍ son NOT NULL y usa el mecanismo estándar
-- (`instalar_rls_tenant_company`, D-016).
--
-- Ambas son append-only: un correo o un adjunto ya registrado no se corrige,
-- se registra un evento nuevo (mismo criterio que `audit_log`, Regla de Oro 6).
--
-- Límite de tasa por buzón (sección 10.3): NO es una tabla nueva. Se calcula
-- contando filas recientes de `email_ingest_log` por `company_id` en una
-- ventana de tiempo (`src/ingest/correo/limites.ts`). Una tabla de contadores
-- sería otra fuente de verdad que mantener sincronizada sin necesidad.
-- =============================================================================

CREATE TABLE email_ingest_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL cuando el buzón de destino no corresponde a ninguna empresa activa.
  tenant_id             uuid REFERENCES tenant(id),
  company_id            uuid REFERENCES company(id),
  buzon_destino         text NOT NULL,
  message_id            text,
  remitente_email       text NOT NULL,
  remitente_nombre      text,
  asunto                text,
  tamano_bytes          integer NOT NULL CHECK (tamano_bytes >= 0),
  spf_resultado         text NOT NULL DEFAULT 'no_verificado'
                          CHECK (spf_resultado IN
                            ('pass','fail','softfail','neutral','none','temperror','permerror','no_verificado')),
  dkim_resultado        text NOT NULL DEFAULT 'no_verificado'
                          CHECK (dkim_resultado IN ('pass','fail','none','no_verificado')),
  cantidad_adjuntos     integer NOT NULL DEFAULT 0 CHECK (cantidad_adjuntos >= 0),
  resultado             text NOT NULL CHECK (resultado IN
                          ('procesado','procesado_parcial','en_cuarentena','rechazado')),
  motivo                text,
  limite_tasa_excedido  boolean NOT NULL DEFAULT false,
  recibido_en           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_ingest_log_scope_ck
    CHECK ((tenant_id IS NULL) = (company_id IS NULL)),
  CONSTRAINT email_ingest_log_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT email_ingest_log_motivo_ck
    CHECK (resultado NOT IN ('rechazado','en_cuarentena') OR motivo IS NOT NULL)
);

CREATE INDEX email_ingest_log_company_idx   ON email_ingest_log (company_id, recibido_en DESC);
CREATE INDEX email_ingest_log_remitente_idx ON email_ingest_log (remitente_email);
CREATE INDEX email_ingest_log_msgid_idx     ON email_ingest_log (message_id);

COMMENT ON TABLE email_ingest_log IS
  'Registro append-only de todo correo entrante a un buzón dedicado (sección 10.3), procesado o no. tenant_id/company_id NULL = buzón no reconocido: la fila se sigue guardando, pero ningún tenant la ve (mismo patrón que audit_log).';
COMMENT ON COLUMN email_ingest_log.spf_resultado IS
  'Resultado tal como lo entrega el proveedor de correo entrante en la cabecera Authentication-Results. Este sistema no resuelve SPF/DKIM por sí mismo (exigiría DNS): confía en la verificación del MTA/proveedor, documentado como límite en docs/ingest-correo.md.';

-- -----------------------------------------------------------------------------
-- Nota FK: company_id es NULLABLE, así que no puede llevar la FK compuesta
-- (columna, tenant_id, company_id) que exige D-016 para tablas de alcance
-- estricto. Se usa el guardia genérico de alcance de la migración 018
-- (D-037), que SÍ tolera NULL: si `company_id` está presente, exige que el
-- `tenant_id` de la fila coincida con el de esa empresa. Es exactamente el
-- mismo mecanismo que ya protege `audit_log.company_id`.
-- -----------------------------------------------------------------------------
SELECT app.instalar_guardia_alcance('email_ingest_log', 'company_id', 'company');

-- RLS: copiada literalmente de la política de audit_log (012_rls.sql). NO se
-- usa instalar_rls_hibrida a propósito: aquí tenant_id NULL no es "catálogo
-- global legible por todos", es "sin atribuir", y debe ser invisible para
-- cualquier tenant.
ALTER TABLE email_ingest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_ingest_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY email_ingest_log_rls ON email_ingest_log FOR ALL
  USING      (tenant_id = app.current_tenant_id()
              AND (company_id IS NULL OR company_id = app.current_company_id()))
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND (company_id IS NULL OR company_id = app.current_company_id()));

-- Append-only: un correo ya registrado no se corrige (Regla de Oro 6).
CREATE TRIGGER email_ingest_log_append_only
  BEFORE UPDATE OR DELETE ON email_ingest_log
  FOR EACH ROW EXECUTE FUNCTION app.trg_append_only();

GRANT SELECT, INSERT ON email_ingest_log TO app_user;

-- -----------------------------------------------------------------------------
-- email_ingest_attachment — un adjunto de un correo YA atribuido a una
-- empresa. tenant_id/company_id NOT NULL: sigue el patrón estándar (D-016).
-- -----------------------------------------------------------------------------
CREATE TABLE email_ingest_attachment (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  company_id                uuid NOT NULL REFERENCES company(id),
  email_ingest_log_id       uuid NOT NULL REFERENCES email_ingest_log(id),
  nombre_archivo            text,
  tamano_bytes              integer NOT NULL CHECK (tamano_bytes >= 0),
  hash_sha256               text NOT NULL,
  tipo_documento_detectado  text CHECK (tipo_documento_detectado IS NULL OR tipo_documento_detectado IN (
                              'Invoice','CreditNote','DebitNote','ApplicationResponse',
                              'AttachedDocument','desconocido')),
  contenedor_attached_document boolean NOT NULL DEFAULT false,
  resultado                 text NOT NULL CHECK (resultado IN ('procesado','en_cuarentena','duplicado')),
  motivo_cuarentena         text,
  source_document_id        uuid REFERENCES source_document(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_ingest_attachment_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT email_ingest_attachment_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT email_ingest_attachment_documento_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT email_ingest_attachment_cuarentena_ck
    CHECK (resultado <> 'en_cuarentena' OR motivo_cuarentena IS NOT NULL),
  CONSTRAINT email_ingest_attachment_procesado_ck
    CHECK (resultado <> 'procesado' OR source_document_id IS NOT NULL)
);

CREATE INDEX email_ingest_attachment_log_idx  ON email_ingest_attachment (email_ingest_log_id);
CREATE INDEX email_ingest_attachment_scope_idx ON email_ingest_attachment (tenant_id, company_id);
CREATE INDEX email_ingest_attachment_hash_idx  ON email_ingest_attachment (company_id, hash_sha256);

COMMENT ON COLUMN email_ingest_attachment.contenedor_attached_document IS
  'true cuando el XML raíz recibido era un AttachedDocument y el documento causable (Invoice/CreditNote/DebitNote/ApplicationResponse) venía embebido — el caso crítico de la sección 10.2.';
COMMENT ON CONSTRAINT email_ingest_attachment_documento_fk ON email_ingest_attachment IS
  'FK compuesta de alcance (D-016): un adjunto procesado solo puede citar un source_document de su misma empresa.';

SELECT app.instalar_guardia_alcance('email_ingest_attachment', 'email_ingest_log_id', 'email_ingest_log');

SELECT app.instalar_rls_tenant_company('email_ingest_attachment');

CREATE TRIGGER email_ingest_attachment_append_only
  BEFORE UPDATE OR DELETE ON email_ingest_attachment
  FOR EACH ROW EXECUTE FUNCTION app.trg_append_only();

GRANT SELECT, INSERT ON email_ingest_attachment TO app_user;

COMMENT ON TABLE email_ingest_attachment IS
  'Un adjunto por correo ya atribuido a una empresa (sección 10.3). Append-only. La deduplicación real por CUFE la impone el UNIQUE (company_id, cufe) de source_document (008_documentos.sql, D-003): esta tabla es la traza del intento, no el mecanismo de dedup.';

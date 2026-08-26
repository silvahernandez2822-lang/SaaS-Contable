-- =============================================================================
-- 008_documentos.sql — source_document, extraction, retention_applied
--
-- `source_document` reserva el espacio para eventos RADIAN (sección 10.4) sin
-- implementarlos: acuse de recibo, recibo del bien o servicio, y aceptación
-- expresa o tácita a los 3 días hábiles. Generarlos exige habilitación DIAN o
-- un proveedor tecnológico y NO entra en el alcance inicial.
-- =============================================================================

CREATE TABLE source_document (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  company_id            uuid NOT NULL REFERENCES company(id),
  tipo_documento        text NOT NULL CHECK (tipo_documento IN (
                          'Invoice','CreditNote','DebitNote',
                          'ApplicationResponse','AttachedDocument',
                          'DocumentoSoporte','Nomina','Otro')),
  -- CUFE: hash SHA-384 que identifica de forma única la factura electrónica.
  -- La deduplicación de la sección 10.3 es esta restricción, no un if.
  cufe                  text,
  prefijo               text,
  numero_documento      text NOT NULL,
  emisor_nit            text NOT NULL,
  emisor_nombre         text,
  adquirente_nit        text,
  third_party_id        uuid REFERENCES third_party(id),
  -- Regla de Oro 3: la vigencia se resuelve por esta fecha, no por la de proceso.
  fecha_hecho_economico date NOT NULL,
  fecha_emision         date,
  moneda                text NOT NULL DEFAULT 'COP' CHECK (moneda ~ '^[A-Z]{3}$'),
  tasa_cambio           numeric(18,6) CHECK (tasa_cambio IS NULL OR tasa_cambio > 0),
  -- Importes en centavos (D-005)
  total_bruto           bigint CHECK (total_bruto  IS NULL OR total_bruto  >= 0),
  total_descuentos      bigint CHECK (total_descuentos IS NULL OR total_descuentos >= 0),
  total_iva             bigint CHECK (total_iva    IS NULL OR total_iva    >= 0),
  total_neto            bigint CHECK (total_neto   IS NULL OR total_neto   >= 0),
  -- Documento crudo y su huella (Regla de Oro 6 y conservación 10 años)
  xml_crudo             text,
  hash_contenido        text NOT NULL,
  nombre_archivo        text,
  origen                text NOT NULL DEFAULT 'correo'
                          CHECK (origen IN ('correo','carga_manual','portal_dian','api','migracion')),
  remitente_email       text,
  spf_valido            boolean,
  dkim_valido           boolean,
  estado                text NOT NULL DEFAULT 'recibido'
                          CHECK (estado IN ('recibido','en_cuarentena','parseado','clasificado',
                                            'pendiente_aprobacion','aprobado','causado',
                                            'rechazado','anulado','duplicado')),
  motivo_rechazo        text,
  documento_referenciado_id uuid REFERENCES source_document(id),  -- nota crédito -> factura
  -- ---------------------------------------------------------------------------
  -- ESPACIO RESERVADO PARA RADIAN (sección 10.4). No se implementa en Ola 0.
  -- ---------------------------------------------------------------------------
  radian_aplica                    boolean NOT NULL DEFAULT false,
  radian_estado                    text NOT NULL DEFAULT 'no_aplica'
                                     CHECK (radian_estado IN (
                                       'no_aplica','pendiente','acuse_recibo',
                                       'recibo_bien_servicio','aceptacion_expresa',
                                       'aceptacion_tacita','reclamo')),
  radian_acuse_recibo_en           timestamptz,
  radian_recibo_bien_servicio_en   timestamptz,
  radian_aceptacion_en             timestamptz,
  radian_reclamo_en                timestamptz,
  radian_fecha_limite_aceptacion   date,
  radian_payload                   jsonb,
  -- ---------------------------------------------------------------------------
  recibido_en           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_document_cufe_uq  UNIQUE (company_id, cufe),
  CONSTRAINT source_document_hash_uq  UNIQUE (company_id, hash_contenido),
  CONSTRAINT source_document_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT source_document_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT source_document_tercero_fk FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id),
  CONSTRAINT source_document_rechazo_ck
    CHECK (estado NOT IN ('rechazado','en_cuarentena') OR motivo_rechazo IS NOT NULL)
);

CREATE INDEX source_document_scope_idx   ON source_document (tenant_id, company_id, fecha_hecho_economico);
CREATE INDEX source_document_estado_idx  ON source_document (company_id, estado);
CREATE INDEX source_document_tercero_idx ON source_document (third_party_id);

COMMENT ON CONSTRAINT source_document_cufe_uq ON source_document IS
  'Deduplicación por CUFE (sección 10.3) impuesta por la BD. Un CUFE ya procesado no se vuelve a causar.';
COMMENT ON COLUMN source_document.radian_estado IS
  'Reservado (sección 10.4). Ola 0 no genera eventos RADIAN; solo deja el espacio.';

-- -----------------------------------------------------------------------------
-- extraction — qué extrajo el parser y qué PROPUSO la IA, con su score.
-- La IA nunca calcula (Regla de Oro 4): aquí solo queda su propuesta y la traza.
-- -----------------------------------------------------------------------------
CREATE TABLE extraction (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  company_id            uuid NOT NULL REFERENCES company(id),
  source_document_id    uuid NOT NULL REFERENCES source_document(id),
  datos_extraidos       jsonb NOT NULL,
  concepto_propuesto_id uuid REFERENCES concepto_causacion(id),
  account_propuesta_id  uuid REFERENCES account(id),
  score_confianza       numeric(5,4) CHECK (score_confianza IS NULL
                                            OR (score_confianza >= 0 AND score_confianza <= 1)),
  origen                text NOT NULL
                          CHECK (origen IN ('parser_ubl','memoria','llm','manual')),
  -- Determinismo obligatorio (sección 8.4): el prompt es versionado y auditado.
  prompt_version        text,
  modelo                text,
  temperatura           numeric(4,3) CHECK (temperatura IS NULL OR temperatura >= 0),
  tokens_entrada        integer CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0),
  tokens_salida         integer CHECK (tokens_salida  IS NULL OR tokens_salida  >= 0),
  costo_usd_micros      bigint  CHECK (costo_usd_micros IS NULL OR costo_usd_micros >= 0),
  memoria_clasificacion_id uuid REFERENCES memoria_clasificacion(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extraction_documento_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT extraction_llm_ck
    CHECK (origen <> 'llm' OR (prompt_version IS NOT NULL AND modelo IS NOT NULL))
);

CREATE INDEX extraction_documento_idx ON extraction (source_document_id);

COMMENT ON COLUMN extraction.costo_usd_micros IS 'Millonésimas de USD. Alimenta el control de costo de A15.';

-- -----------------------------------------------------------------------------
-- retention_applied — una fila por retención EVALUADA por documento.
-- Se registra también cuando NO aplicó (base inferior a la base mínima), con el
-- motivo: la sección 9.3 lo exige y es lo que el contador necesita ver.
--
-- La FK compuesta (tax_rule_id, regla_vigente_desde) garantiza que la vigencia
-- registrada es la real de esa regla y no un texto suelto.
-- -----------------------------------------------------------------------------
CREATE TABLE retention_applied (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  company_id             uuid NOT NULL REFERENCES company(id),
  source_document_id     uuid NOT NULL REFERENCES source_document(id),
  journal_entry_id       uuid,   -- FK añadida en 010 (journal_entry se crea después)
  concepto_causacion_id  uuid REFERENCES concepto_causacion(id),
  third_party_id         uuid REFERENCES third_party(id),
  tipo                   text NOT NULL CHECK (tipo IN (
                           'retefuente','reteiva','reteica','autorretencion','retefuente_salarios')),
  base                   bigint NOT NULL CHECK (base >= 0),
  tarifa                 numeric(9,6) NOT NULL CHECK (tarifa >= 0 AND tarifa <= 1),
  valor                  bigint NOT NULL CHECK (valor >= 0),
  valor_sin_redondeo     bigint CHECK (valor_sin_redondeo IS NULL OR valor_sin_redondeo >= 0),
  -- Regla aplicada y SU VIGENCIA (relación obligatoria de la sección 15)
  tax_rule_id            uuid NOT NULL,
  regla_vigente_desde    date NOT NULL,
  regla_vigente_hasta    date,
  norma_respaldo         text NOT NULL,
  account_id             uuid NOT NULL REFERENCES account(id),
  municipality_id        uuid REFERENCES municipality(id),
  ciiu_activity_id       uuid REFERENCES ciiu_activity(id),
  rounding_rule_id       uuid REFERENCES rounding_rule(id),
  -- Contexto del cálculo, para reproducirlo idéntico dentro de seis meses
  fecha_hecho_economico  date NOT NULL,
  uvt_valor_usado        bigint CHECK (uvt_valor_usado IS NULL OR uvt_valor_usado > 0),
  base_minima_uvt_usada  numeric(12,4),
  base_minima_valor_usada bigint,
  aplicada               boolean NOT NULL DEFAULT true,
  motivo_no_aplica       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_applied_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT retention_applied_documento_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT retention_applied_regla_fk FOREIGN KEY (tax_rule_id, regla_vigente_desde)
    REFERENCES tax_rule (id, vigente_desde),
  CONSTRAINT retention_applied_no_aplica_ck
    CHECK (aplicada OR (valor = 0 AND motivo_no_aplica IS NOT NULL)),
  CONSTRAINT retention_applied_vigencia_ck
    CHECK (app.esta_vigente(regla_vigente_desde, regla_vigente_hasta, fecha_hecho_economico))
);

CREATE INDEX retention_applied_documento_idx ON retention_applied (source_document_id);
CREATE INDEX retention_applied_regla_idx     ON retention_applied (tax_rule_id);
CREATE INDEX retention_applied_scope_idx     ON retention_applied (tenant_id, company_id, fecha_hecho_economico);

COMMENT ON CONSTRAINT retention_applied_vigencia_ck ON retention_applied IS
  'La BD verifica que la vigencia registrada realmente cubría la fecha del hecho económico (Regla de Oro 3).';

CREATE TRIGGER source_document_updated_at BEFORE UPDATE ON source_document FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

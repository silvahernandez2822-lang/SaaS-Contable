-- =============================================================================
-- 006_reglas_tributarias.sql — tax_concept, tax_rule, tax_calendar
--
-- DECISIÓN DE MODELADO: se separa `tax_concept` (el concepto de retención como
-- IDENTIDAD estable: "servicios generales", "honorarios", "arrendamiento de
-- inmuebles") de `tax_rule` (sus VALORES con vigencia: tarifa, base mínima,
-- cuenta PUC).
--
-- Es la única forma de cumplir la corrección crítica de la sección 8.2: un
-- `concepto_causacion` debe apuntar a la REGLA, no a la tarifa. Si apuntara a
-- una fila de `tax_rule`, apuntaría a UNA VIGENCIA concreta, y el decreto del
-- año siguiente dejaría a todos los conceptos calculando con la tarifa vieja.
-- Apuntando a `tax_concept`, la tarifa se resuelve por fecha del hecho y
-- cambiarla en un solo lugar actualiza a todos los que la referencian.
-- =============================================================================

CREATE TABLE tax_concept (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenant(id),   -- NULL = concepto nacional
  company_id   uuid REFERENCES company(id),
  tipo         text NOT NULL CHECK (tipo IN (
                 'retefuente','reteiva','reteica','autorretencion',
                 'iva','retefuente_salarios')),
  codigo       text NOT NULL,
  nombre       text NOT NULL,
  descripcion  text,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_concept_uq UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, tipo, codigo),
  CONSTRAINT tax_concept_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

COMMENT ON TABLE tax_concept IS
  'Identidad estable del concepto tributario. No tiene tarifa: la tarifa vive en tax_rule con vigencia.';

-- -----------------------------------------------------------------------------
-- tax_rule — los valores. Una fila por vigencia. A1 la puebla; A2 solo la crea.
-- -----------------------------------------------------------------------------
CREATE TABLE tax_rule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenant(id),
  company_id         uuid REFERENCES company(id),
  tax_concept_id     uuid NOT NULL REFERENCES tax_concept(id),
  tipo               text NOT NULL CHECK (tipo IN (
                       'retefuente','reteiva','reteica','autorretencion',
                       'iva','retefuente_salarios')),
  -- Tarifa como FRACCIÓN (D-005): 2,5% = 0.025000; 2 por mil = 0.002000.
  tarifa             numeric(9,6) NOT NULL CHECK (tarifa >= 0 AND tarifa <= 1),
  -- Base mínima: en UVT (lo habitual) o en pesos, según la norma.
  base_minima_uvt    numeric(12,4) CHECK (base_minima_uvt IS NULL OR base_minima_uvt >= 0),
  base_minima_valor  bigint        CHECK (base_minima_valor IS NULL OR base_minima_valor >= 0),
  -- Sobre qué se aplica la tarifa (sección 9.2: ReteIVA va sobre el IVA).
  aplica_sobre       text NOT NULL DEFAULT 'base_gravable'
                       CHECK (aplica_sobre IN ('base_gravable','valor_iva','aiu','base_menos_iva')),
  -- Discriminadores de la regla
  aplica_a           text NOT NULL DEFAULT 'ambos'
                       CHECK (aplica_a IN ('declarante','no_declarante','ambos')),
  tipo_persona       text NOT NULL DEFAULT 'ambos'
                       CHECK (tipo_persona IN ('natural','juridica','ambos')),
  municipality_id    uuid REFERENCES municipality(id),      -- ReteICA
  ciiu_activity_id   uuid REFERENCES ciiu_activity(id),     -- ReteICA / autorretención
  -- Tabla progresiva (art. 383 ET): rango marginal en UVT
  rango_desde_uvt    numeric(12,4),
  rango_hasta_uvt    numeric(12,4),
  uvt_adicionales    numeric(12,4),
  -- Cuenta PUC donde se registra la retención
  account_id         uuid REFERENCES account(id),
  vigente_desde      date NOT NULL,
  vigente_hasta      date,
  norma_respaldo     text NOT NULL,
  notas              text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES "user"(id),
  clave_vigencia     text GENERATED ALWAYS AS (
                       'tax_rule|' || tax_concept_id::text
                       || '|' || tipo
                       || '|' || aplica_a
                       || '|' || tipo_persona
                       || '|' || COALESCE(municipality_id::text, '-')
                       || '|' || COALESCE(ciiu_activity_id::text, '-')
                       || '|' || COALESCE(rango_desde_uvt::text, '-')
                       || '|' || COALESCE(tenant_id::text, '-')
                       || '|' || COALESCE(company_id::text, '-')
                     ) STORED,
  CONSTRAINT tax_rule_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT tax_rule_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT tax_rule_base_ck    CHECK (base_minima_uvt IS NULL OR base_minima_valor IS NULL),
  CONSTRAINT tax_rule_progresiva_ck CHECK (
    rango_hasta_uvt IS NULL OR rango_desde_uvt IS NULL OR rango_hasta_uvt >= rango_desde_uvt),
  -- Permite que `retention_applied` amarre con FK compuesta la vigencia exacta
  -- que se usó, no solo el id de la regla.
  CONSTRAINT tax_rule_id_vigencia_uq UNIQUE (id, vigente_desde)
);

CREATE INDEX tax_rule_resolucion_idx ON tax_rule (tipo, tax_concept_id, vigente_desde, vigente_hasta);
CREATE INDEX tax_rule_clave_idx      ON tax_rule (clave_vigencia, vigente_desde);
CREATE INDEX tax_rule_municipio_idx  ON tax_rule (municipality_id, ciiu_activity_id, vigente_desde);

SELECT app.instalar_triggers_vigencia('tax_rule');

COMMENT ON COLUMN tax_rule.tarifa IS
  'Fracción, no porcentaje (D-005). 4% = 0.040000. ReteICA de 2 por mil = 0.002000.';

-- -----------------------------------------------------------------------------
-- tax_calendar — vencimientos por año, obligación y último dígito de NIT.
-- -----------------------------------------------------------------------------
CREATE TABLE tax_calendar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenant(id),
  company_id         uuid REFERENCES company(id),
  anio               smallint NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  tipo_obligacion    text NOT NULL,
  periodo            text NOT NULL,
  ultimo_digito_nit  text NOT NULL CHECK (ultimo_digito_nit ~ '^([0-9]|[0-9]{2}|todos)$'),
  fecha_vencimiento  date NOT NULL,
  municipality_id    uuid REFERENCES municipality(id),
  vigente_desde      date NOT NULL,
  vigente_hasta      date,
  norma_respaldo     text NOT NULL,
  notas              text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES "user"(id),
  clave_vigencia     text GENERATED ALWAYS AS (
                       'tax_calendar|' || anio::text
                       || '|' || tipo_obligacion
                       || '|' || periodo
                       || '|' || ultimo_digito_nit
                       || '|' || COALESCE(municipality_id::text, '-')
                       || '|' || COALESCE(tenant_id::text, '-')
                       || '|' || COALESCE(company_id::text, '-')
                     ) STORED,
  CONSTRAINT tax_calendar_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT tax_calendar_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX tax_calendar_anio_idx  ON tax_calendar (anio, tipo_obligacion, ultimo_digito_nit);
CREATE INDEX tax_calendar_clave_idx ON tax_calendar (clave_vigencia, vigente_desde);

SELECT app.instalar_triggers_vigencia('tax_calendar');

CREATE TRIGGER tax_concept_updated_at BEFORE UPDATE ON tax_concept FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

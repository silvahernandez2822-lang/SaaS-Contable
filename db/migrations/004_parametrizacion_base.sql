-- =============================================================================
-- 004_parametrizacion_base.sql — Catálogos estables y valores base con vigencia
--
-- DECISIÓN DE MODELADO: se separa la IDENTIDAD (municipio, actividad CIIU) de
-- sus PARÁMETROS con vigencia. Un `third_party` apunta al municipio, que no
-- cambia; las bases mínimas de ICA de ese municipio viven en una tabla aparte
-- versionada por vigencia. Si el municipio tuviera vigencia, cada FK apuntaría
-- a una versión concreta y cambiar el acuerdo municipal rompería los terceros.
--
-- TARIFAS: siempre NUMERIC(9,6) como FRACCIÓN, nunca porcentaje ni por mil
-- (D-005). 2,5% = 0.025000. 2 por mil = 0.002000.
-- IMPORTES: siempre BIGINT en centavos de COP.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- municipality — catálogo DANE. Identidad estable, sin vigencia.
-- -----------------------------------------------------------------------------
CREATE TABLE municipality (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid REFERENCES tenant(id),   -- NULL = catálogo global
  company_id              uuid REFERENCES company(id),
  codigo_dane             text NOT NULL,
  nombre                  text NOT NULL,
  departamento            text NOT NULL,
  codigo_dane_departamento text NOT NULL,
  activo                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT municipality_dane_uq UNIQUE NULLS NOT DISTINCT (tenant_id, codigo_dane),
  CONSTRAINT municipality_dane_ck CHECK (codigo_dane ~ '^[0-9]{5}$'),
  CONSTRAINT municipality_dane_dpto_ck CHECK (codigo_dane_departamento ~ '^[0-9]{2}$'),
  CONSTRAINT municipality_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

COMMENT ON COLUMN municipality.codigo_dane IS 'Código DANE de 5 dígitos: 2 de departamento + 3 de municipio.';

-- -----------------------------------------------------------------------------
-- municipality_ica_rule — parámetros de ReteICA del municipio, por vigencia.
-- Las tarifas por actividad económica NO van aquí: van en `tax_rule`
-- (tipo = 'reteica', con municipality_id y ciiu_activity_id).
-- -----------------------------------------------------------------------------
CREATE TABLE municipality_ica_rule (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid REFERENCES tenant(id),
  company_id                  uuid REFERENCES company(id),
  municipality_id             uuid NOT NULL REFERENCES municipality(id),
  practica_reteica            boolean NOT NULL DEFAULT true,
  -- Base mínima: puede venir expresada en UVT o en pesos según el acuerdo.
  base_minima_servicios_uvt   numeric(12,4),
  base_minima_compras_uvt     numeric(12,4),
  base_minima_servicios_valor bigint CHECK (base_minima_servicios_valor IS NULL OR base_minima_servicios_valor >= 0),
  base_minima_compras_valor   bigint CHECK (base_minima_compras_valor   IS NULL OR base_minima_compras_valor   >= 0),
  -- Algunos municipios aplican una tarifa general única; otros la de la actividad.
  usa_tarifa_de_actividad     boolean NOT NULL DEFAULT true,
  tarifa_general              numeric(9,6) CHECK (tarifa_general IS NULL OR (tarifa_general >= 0 AND tarifa_general <= 1)),
  periodicidad                text NOT NULL DEFAULT 'mensual'
                                CHECK (periodicidad IN ('mensual','bimestral','trimestral','cuatrimestral','anual')),
  regla_desempate_actividad   text NOT NULL DEFAULT 'principal'
                                CHECK (regla_desempate_actividad IN ('principal','mayor_tarifa','menor_tarifa')),
  vigente_desde               date NOT NULL,
  vigente_hasta               date,
  norma_respaldo              text NOT NULL,
  notas                       text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES "user"(id),
  clave_vigencia              text GENERATED ALWAYS AS (
                                'municipality_ica|' || municipality_id::text
                                || '|' || COALESCE(tenant_id::text, '-')
                                || '|' || COALESCE(company_id::text, '-')
                              ) STORED,
  CONSTRAINT municipality_ica_rango_ck CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT municipality_ica_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX municipality_ica_mun_idx   ON municipality_ica_rule (municipality_id, vigente_desde);
CREATE INDEX municipality_ica_clave_idx ON municipality_ica_rule (clave_vigencia, vigente_desde);

SELECT app.instalar_triggers_vigencia('municipality_ica_rule');

-- -----------------------------------------------------------------------------
-- ciiu_activity — catálogo CIIU rev. 4 A.C. Identidad estable, sin vigencia.
-- Las tarifas de autorretención por CIIU viven en `tax_rule`.
-- -----------------------------------------------------------------------------
CREATE TABLE ciiu_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id),
  company_id  uuid REFERENCES company(id),
  codigo      text NOT NULL,
  nombre      text NOT NULL,
  seccion     text,
  division    text,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ciiu_codigo_uq UNIQUE NULLS NOT DISTINCT (tenant_id, codigo),
  CONSTRAINT ciiu_codigo_ck CHECK (codigo ~ '^[0-9]{4}$'),
  CONSTRAINT ciiu_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

-- FKs pendientes de `company` (ver 002): ya existen sus tablas destino.
ALTER TABLE company ADD CONSTRAINT company_municipality_fk
  FOREIGN KEY (municipality_id) REFERENCES municipality(id);
ALTER TABLE company ADD CONSTRAINT company_ciiu_fk
  FOREIGN KEY (ciiu_principal_id) REFERENCES ciiu_activity(id);

-- -----------------------------------------------------------------------------
-- uvt_value — Unidad de Valor Tributario por año. Paramétrica.
-- El valor va en CENTAVOS (D-005): UVT 2026 = $52.374 => 5237400.
-- -----------------------------------------------------------------------------
CREATE TABLE uvt_value (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenant(id),
  company_id     uuid REFERENCES company(id),
  anio           smallint NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  valor          bigint NOT NULL CHECK (valor > 0),
  vigente_desde  date NOT NULL,
  vigente_hasta  date,
  norma_respaldo text NOT NULL,
  notas          text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES "user"(id),
  clave_vigencia text GENERATED ALWAYS AS (
                   'uvt|' || COALESCE(tenant_id::text, '-')
                   || '|' || COALESCE(company_id::text, '-')
                 ) STORED,
  CONSTRAINT uvt_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT uvt_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX uvt_clave_idx ON uvt_value (clave_vigencia, vigente_desde);
COMMENT ON COLUMN uvt_value.valor IS 'Centavos de COP. UVT 2026 = $52.374 se almacena como 5237400.';

SELECT app.instalar_triggers_vigencia('uvt_value');

-- -----------------------------------------------------------------------------
-- smmlv_value — salario mínimo y auxilio de transporte por año (sección 6.3).
-- -----------------------------------------------------------------------------
CREATE TABLE smmlv_value (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenant(id),
  company_id          uuid REFERENCES company(id),
  anio                smallint NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  valor_mensual       bigint NOT NULL CHECK (valor_mensual > 0),
  auxilio_transporte  bigint CHECK (auxilio_transporte IS NULL OR auxilio_transporte >= 0),
  vigente_desde       date NOT NULL,
  vigente_hasta       date,
  norma_respaldo      text NOT NULL,
  notas               text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES "user"(id),
  clave_vigencia      text GENERATED ALWAYS AS (
                        'smmlv|' || COALESCE(tenant_id::text, '-')
                        || '|' || COALESCE(company_id::text, '-')
                      ) STORED,
  CONSTRAINT smmlv_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT smmlv_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX smmlv_clave_idx ON smmlv_value (clave_vigencia, vigente_desde);

SELECT app.instalar_triggers_vigencia('smmlv_value');

-- -----------------------------------------------------------------------------
-- rounding_rule — el redondeo es parámetro, no lógica quemada (Regla de Oro 5).
-- -----------------------------------------------------------------------------
CREATE TABLE rounding_rule (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenant(id),
  company_id     uuid REFERENCES company(id),
  codigo         text NOT NULL,
  nombre         text NOT NULL,
  modo           text NOT NULL CHECK (modo IN ('half_up','half_even','truncar','techo','piso')),
  -- Múltiplo en centavos al que se redondea: 100 = al peso, 100000 = al mil.
  multiplo       bigint NOT NULL DEFAULT 100 CHECK (multiplo > 0),
  aplica_a       text NOT NULL DEFAULT 'todos'
                   CHECK (aplica_a IN ('todos','retefuente','reteiva','reteica','autorretencion','iva')),
  vigente_desde  date NOT NULL,
  vigente_hasta  date,
  norma_respaldo text NOT NULL,
  notas          text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES "user"(id),
  clave_vigencia text GENERATED ALWAYS AS (
                   'rounding|' || codigo || '|' || aplica_a
                   || '|' || COALESCE(tenant_id::text, '-')
                   || '|' || COALESCE(company_id::text, '-')
                 ) STORED,
  CONSTRAINT rounding_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT rounding_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX rounding_clave_idx ON rounding_rule (clave_vigencia, vigente_desde);
COMMENT ON COLUMN rounding_rule.multiplo IS 'Centavos. 100 = redondear al peso; 100000 = redondear al mil.';

SELECT app.instalar_triggers_vigencia('rounding_rule');

CREATE TRIGGER municipality_updated_at  BEFORE UPDATE ON municipality  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER ciiu_activity_updated_at BEFORE UPDATE ON ciiu_activity FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

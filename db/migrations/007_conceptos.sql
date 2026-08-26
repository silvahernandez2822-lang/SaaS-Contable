-- =============================================================================
-- 007_conceptos.sql — Conceptos de causación, memoria de clasificación y
-- ajustes por empresa.
--
-- `concepto_causacion` NO lleva tarifas: guarda punteros a `tax_concept`
-- (sección 8.2, "el concepto referencia la regla, no la tarifa"). Tampoco lleva
-- vigencia: la trazabilidad de una causación pasada se conserva porque
-- `retention_applied` persiste la `tax_rule` y la vigencia que se usaron, y
-- `journal_line` persiste las cuentas concretas.
-- =============================================================================

CREATE TABLE concepto_causacion (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid REFERENCES tenant(id),   -- NULL = catálogo base
  company_id                  uuid REFERENCES company(id),
  codigo                      text NOT NULL,
  nombre                      text NOT NULL,
  descripcion                 text,
  naturaleza                  text NOT NULL DEFAULT 'compra'
                                CHECK (naturaleza IN ('compra','venta','nomina','ajuste','otro')),
  -- Cuentas PUC del asiento
  cuenta_gasto_id             uuid REFERENCES account(id),
  cuenta_iva_descontable_id   uuid REFERENCES account(id),
  cuenta_contrapartida_id     uuid REFERENCES account(id),
  cost_center_id              uuid REFERENCES cost_center(id),
  -- Punteros a la REGLA, nunca a la tarifa
  tax_concept_retefuente_id   uuid REFERENCES tax_concept(id),
  tax_concept_reteiva_id      uuid REFERENCES tax_concept(id),
  tax_concept_reteica_id      uuid REFERENCES tax_concept(id),
  tax_concept_autorretencion_id uuid REFERENCES tax_concept(id),
  aplica_retefuente           boolean NOT NULL DEFAULT true,
  aplica_reteiva              boolean NOT NULL DEFAULT false,
  aplica_reteica              boolean NOT NULL DEFAULT false,
  aplica_autorretencion       boolean NOT NULL DEFAULT false,
  -- AIU: en vigilancia, aseo y temporales la base es el AIU, no el total.
  base_es_aiu                 boolean NOT NULL DEFAULT false,
  porcentaje_aiu_minimo       numeric(9,6)
                                CHECK (porcentaje_aiu_minimo IS NULL
                                       OR (porcentaje_aiu_minimo >= 0 AND porcentaje_aiu_minimo <= 1)),
  -- Validaciones adicionales que A6/A7 aplican en la bandeja (JSON abierto)
  validaciones                jsonb NOT NULL DEFAULT '{}'::jsonb,
  activo                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concepto_causacion_uq UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, codigo),
  CONSTRAINT concepto_causacion_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT concepto_causacion_retefuente_ck
    CHECK (NOT aplica_retefuente OR tax_concept_retefuente_id IS NOT NULL),
  CONSTRAINT concepto_causacion_aiu_ck
    CHECK (NOT base_es_aiu OR porcentaje_aiu_minimo IS NOT NULL)
);

CREATE INDEX concepto_causacion_scope_idx ON concepto_causacion (tenant_id, company_id, codigo);

COMMENT ON COLUMN concepto_causacion.tax_concept_retefuente_id IS
  'Puntero al concepto de retención, NO a la tarifa. La tarifa se resuelve en tax_rule por fecha del hecho.';

-- -----------------------------------------------------------------------------
-- memoria_clasificacion — el ahorro real de tokens (sección 8.3).
-- Clave: (company_id, third_party_id, patron_descripcion normalizado).
-- -----------------------------------------------------------------------------
CREATE TABLE memoria_clasificacion (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  company_id             uuid NOT NULL REFERENCES company(id),
  third_party_id         uuid NOT NULL REFERENCES third_party(id),
  patron_descripcion     text NOT NULL,
  concepto_causacion_id  uuid NOT NULL REFERENCES concepto_causacion(id),
  account_id             uuid REFERENCES account(id),
  cost_center_id         uuid REFERENCES cost_center(id),
  aciertos               integer NOT NULL DEFAULT 0 CHECK (aciertos >= 0),
  correcciones           integer NOT NULL DEFAULT 0 CHECK (correcciones >= 0),
  ultima_confirmacion_en timestamptz NOT NULL DEFAULT now(),
  confirmado_por         uuid REFERENCES "user"(id),
  origen                 text NOT NULL DEFAULT 'aprobacion_humana'
                           CHECK (origen IN ('aprobacion_humana','correccion_humana','carga_inicial')),
  activo                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memoria_clasificacion_uq UNIQUE (company_id, third_party_id, patron_descripcion),
  CONSTRAINT memoria_clasificacion_tercero_fk FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id),
  CONSTRAINT memoria_clasificacion_patron_ck CHECK (patron_descripcion = lower(patron_descripcion))
);

CREATE INDEX memoria_clasificacion_lookup_idx
  ON memoria_clasificacion (company_id, third_party_id, patron_descripcion);

COMMENT ON COLUMN memoria_clasificacion.patron_descripcion IS
  'Descripción normalizada: minúsculas, sin tildes, sin números variables ni fechas (sección 8.3). El CHECK solo garantiza minúsculas; el resto de la normalización la impone A5.';

-- -----------------------------------------------------------------------------
-- company_setting — ajustes operativos por empresa (umbral de auto-aprobación,
-- umbral de propuesta, alcance de la memoria, antigüedad de revalidación...).
-- No es una tabla tributaria: aquí NO van tarifas ni bases (esas van a tax_rule).
-- -----------------------------------------------------------------------------
CREATE TABLE company_setting (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  company_id  uuid NOT NULL REFERENCES company(id),
  clave       text NOT NULL,
  valor       jsonb NOT NULL,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_setting_uq UNIQUE (company_id, clave),
  CONSTRAINT company_setting_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id)
);

CREATE TRIGGER concepto_causacion_updated_at    BEFORE UPDATE ON concepto_causacion    FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER memoria_clasificacion_updated_at BEFORE UPDATE ON memoria_clasificacion FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER company_setting_updated_at       BEFORE UPDATE ON company_setting       FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

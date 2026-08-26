-- =============================================================================
-- 003_catalogos_contables.sql — PUC jerárquico, mapeo NIIF y centros de costo
--
-- `account` y `niif_mapping` son tablas HÍBRIDAS: la fila con
-- tenant_id IS NULL es el catálogo global (PUC Decreto 2650, que puebla A1);
-- una fila con tenant_id/company_id es una cuenta propia de esa firma/empresa
-- (típicamente auxiliares). La política RLS deja LEER lo global y solo ESCRIBIR
-- lo propio.
-- =============================================================================

CREATE TABLE account (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES tenant(id),    -- NULL = PUC global
  company_id            uuid REFERENCES company(id),   -- NULL = aplica a toda la firma
  codigo                text NOT NULL,
  nombre                text NOT NULL,
  -- Jerarquía PUC: 1 clase, 2 grupo, 3 cuenta, 4 subcuenta, 5 auxiliar
  nivel                 smallint NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  parent_id             uuid REFERENCES account(id),
  naturaleza            text NOT NULL CHECK (naturaleza IN ('debito', 'credito')),
  -- Solo las hojas imputables reciben partidas. Lo valida el ledger (LG004).
  permite_movimiento    boolean NOT NULL DEFAULT false,
  requiere_tercero      boolean NOT NULL DEFAULT false,
  requiere_centro_costo boolean NOT NULL DEFAULT false,
  requiere_base_gravable boolean NOT NULL DEFAULT false,
  clase_puc             smallint GENERATED ALWAYS AS (left(codigo, 1)::smallint) STORED,
  activo                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_codigo_uq UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, codigo),
  CONSTRAINT account_codigo_numerico_ck CHECK (codigo ~ '^[1-9][0-9]*$'),
  -- Longitud del código coherente con el nivel del PUC colombiano.
  CONSTRAINT account_nivel_longitud_ck CHECK (
       (nivel = 1 AND length(codigo) = 1)
    OR (nivel = 2 AND length(codigo) = 2)
    OR (nivel = 3 AND length(codigo) = 4)
    OR (nivel = 4 AND length(codigo) = 6)
    OR (nivel = 5 AND length(codigo) >= 7)
  ),
  CONSTRAINT account_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  -- Una cuenta de empresa exige tenant; lo global no puede tener company sin tenant.
  CONSTRAINT account_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX account_scope_idx  ON account (tenant_id, company_id, codigo);
CREATE INDEX account_parent_idx ON account (parent_id);

COMMENT ON COLUMN account.permite_movimiento IS
  'Solo las cuentas imputables aceptan journal_line. El ledger lo verifica en la BD (LG004).';

-- -----------------------------------------------------------------------------
-- niif_mapping — clasificación NIIF para PYMES de cada cuenta PUC.
-- Es paramétrica: la clasificación puede cambiar por norma, y los estados
-- financieros de un período pasado deben seguir armándose con la de entonces.
-- -----------------------------------------------------------------------------
CREATE TABLE niif_mapping (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenant(id),
  company_id         uuid REFERENCES company(id),
  account_id         uuid NOT NULL REFERENCES account(id),
  clasificacion_niif text NOT NULL
                       CHECK (clasificacion_niif IN (
                         'activo_corriente', 'activo_no_corriente',
                         'pasivo_corriente', 'pasivo_no_corriente',
                         'patrimonio', 'ingreso', 'costo', 'gasto',
                         'otro_resultado_integral', 'cuenta_de_orden')),
  seccion_niif       text,        -- p. ej. 'Sección 13 — Inventarios'
  rubro_esf          text,        -- rubro del Estado de Situación Financiera
  rubro_eri          text,        -- rubro del Estado de Resultado Integral
  rubro_efe          text,        -- rubro del Estado de Flujos de Efectivo
  vigente_desde      date NOT NULL,
  vigente_hasta      date,
  norma_respaldo     text NOT NULL,
  notas              text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES "user"(id),
  clave_vigencia     text GENERATED ALWAYS AS (
                       'niif_mapping|' || account_id::text
                       || '|' || COALESCE(tenant_id::text, '-')
                       || '|' || COALESCE(company_id::text, '-')
                     ) STORED,
  CONSTRAINT niif_mapping_rango_ck CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT niif_mapping_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX niif_mapping_account_idx ON niif_mapping (account_id, vigente_desde);
CREATE INDEX niif_mapping_clave_idx   ON niif_mapping (clave_vigencia, vigente_desde);

SELECT app.instalar_triggers_vigencia('niif_mapping');

-- -----------------------------------------------------------------------------
-- cost_center — centros de costo, propios de cada empresa.
-- -----------------------------------------------------------------------------
CREATE TABLE cost_center (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  company_id  uuid NOT NULL REFERENCES company(id),
  codigo      text NOT NULL,
  nombre      text NOT NULL,
  parent_id   uuid REFERENCES cost_center(id),
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_center_uq UNIQUE (company_id, codigo),
  CONSTRAINT cost_center_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT cost_center_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id)
);

CREATE INDEX cost_center_scope_idx ON cost_center (tenant_id, company_id);

CREATE TRIGGER account_updated_at     BEFORE UPDATE ON account     FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER cost_center_updated_at BEFORE UPDATE ON cost_center FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

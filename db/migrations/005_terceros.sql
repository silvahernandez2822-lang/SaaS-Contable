-- =============================================================================
-- 005_terceros.sql — Terceros y sus actividades económicas por municipio
--
-- DECISIÓN DE MODELADO (ver ESTADO_PROYECTO.md): los atributos fiscales del
-- tercero NO son columnas de `third_party`. La sección 9.2 exige "determinar
-- atributos fiscales del tercero A LA FECHA DEL HECHO", y un proveedor que hoy
-- es declarante pudo no serlo en marzo. Guardarlos como columnas mutables haría
-- que recalcular una factura de enero en julio diera otro resultado, violando
-- la Regla de Oro 3.
--
-- Por eso viven en `third_party_fiscal_attribute`, versionada por vigencia. La
-- vista `v_third_party_vigente` los presenta aplanados sobre el tercero para la
-- interfaz, que es la forma que describe la sección 15.
-- =============================================================================

CREATE TABLE third_party (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  company_id          uuid NOT NULL REFERENCES company(id),
  tipo_documento      text NOT NULL DEFAULT 'NIT'
                        CHECK (tipo_documento IN ('NIT','CC','CE','PA','TI','NIT_EXTRANJERO','PEP','PPT','NUIP','DEX')),
  numero_documento    text NOT NULL,
  digito_verificacion smallint CHECK (digito_verificacion BETWEEN 0 AND 9),
  tipo_persona        text NOT NULL CHECK (tipo_persona IN ('natural','juridica')),
  razon_social        text NOT NULL,
  nombre_comercial    text,
  primer_nombre       text,
  otros_nombres       text,
  primer_apellido     text,
  segundo_apellido    text,
  -- Dirección y municipio: indispensables para ReteICA multimunicipio
  direccion           text,
  municipality_id     uuid REFERENCES municipality(id),
  codigo_dane         text CHECK (codigo_dane IS NULL OR codigo_dane ~ '^[0-9]{5}$'),
  pais                text NOT NULL DEFAULT 'CO' CHECK (pais ~ '^[A-Z]{2}$'),
  es_del_exterior     boolean NOT NULL DEFAULT false,
  email               text,
  telefono            text,
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT third_party_doc_uq UNIQUE (company_id, tipo_documento, numero_documento),
  CONSTRAINT third_party_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT third_party_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  -- Un tercero del exterior no lleva municipio colombiano.
  CONSTRAINT third_party_exterior_ck CHECK (NOT es_del_exterior OR municipality_id IS NULL)
);

CREATE INDEX third_party_scope_idx ON third_party (tenant_id, company_id);
CREATE INDEX third_party_doc_idx   ON third_party (company_id, numero_documento);
CREATE INDEX third_party_mun_idx   ON third_party (municipality_id);

COMMENT ON COLUMN third_party.codigo_dane IS
  'Código DANE del municipio del tercero, denormalizado desde municipality para exógena y ReteICA.';

-- -----------------------------------------------------------------------------
-- third_party_fiscal_attribute — atributos fiscales versionados por vigencia.
-- Fuente única de verdad para el motor de reglas (A3).
-- -----------------------------------------------------------------------------
CREATE TABLE third_party_fiscal_attribute (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  company_id                uuid NOT NULL REFERENCES company(id),
  third_party_id            uuid NOT NULL REFERENCES third_party(id),
  es_declarante_renta       boolean NOT NULL,
  es_autorretenedor_renta   boolean NOT NULL DEFAULT false,
  es_gran_contribuyente     boolean NOT NULL DEFAULT false,
  es_regimen_simple         boolean NOT NULL DEFAULT false,
  es_responsable_iva        boolean NOT NULL DEFAULT false,
  es_agente_retencion_renta boolean NOT NULL DEFAULT false,
  es_agente_retencion_iva   boolean NOT NULL DEFAULT false,
  es_agente_retencion_ica   boolean NOT NULL DEFAULT false,
  es_autorretenedor_ica     boolean NOT NULL DEFAULT false,
  regimen_tributario        text NOT NULL DEFAULT 'ordinario'
                              CHECK (regimen_tributario IN ('ordinario','simple','especial','no_contribuyente','no_residente')),
  vigente_desde             date NOT NULL,
  vigente_hasta             date,
  norma_respaldo            text NOT NULL,
  fuente                    text NOT NULL DEFAULT 'declarado_por_cliente'
                              CHECK (fuente IN ('rut','declarado_por_cliente','factura','consulta_dian','otro')),
  notas                     text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES "user"(id),
  clave_vigencia            text GENERATED ALWAYS AS (
                              'tp_fiscal|' || third_party_id::text
                            ) STORED,
  CONSTRAINT tpfa_rango_ck CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT tpfa_third_party_fk FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id)
);

CREATE INDEX tpfa_tercero_idx ON third_party_fiscal_attribute (third_party_id, vigente_desde);
CREATE INDEX tpfa_clave_idx   ON third_party_fiscal_attribute (clave_vigencia, vigente_desde);

SELECT app.instalar_triggers_vigencia('third_party_fiscal_attribute');

-- -----------------------------------------------------------------------------
-- third_party_activity — tercero × municipio × CIIU (sección 15).
-- Indispensable para ReteICA multimunicipio: el mismo proveedor puede tener
-- actividad principal en Bogotá y secundaria en Cali.
--
-- `tarifa_ica_override` es la excepción, no la regla: normalmente queda NULL y
-- la tarifa se resuelve en `tax_rule` (tipo 'reteica') por municipio+actividad.
-- Guardar la tarifa aquí por defecto repetiría el error que corrige la sección
-- 8.2: un cambio normativo obligaría a editar miles de filas de terceros.
-- -----------------------------------------------------------------------------
CREATE TABLE third_party_activity (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  company_id           uuid NOT NULL REFERENCES company(id),
  third_party_id       uuid NOT NULL REFERENCES third_party(id),
  municipality_id      uuid NOT NULL REFERENCES municipality(id),
  ciiu_activity_id     uuid NOT NULL REFERENCES ciiu_activity(id),
  es_principal         boolean NOT NULL DEFAULT false,
  tarifa_ica_override  numeric(9,6)
                         CHECK (tarifa_ica_override IS NULL
                                OR (tarifa_ica_override >= 0 AND tarifa_ica_override <= 1)),
  vigente_desde        date NOT NULL,
  vigente_hasta        date,
  norma_respaldo       text NOT NULL,
  notas                text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES "user"(id),
  clave_vigencia       text GENERATED ALWAYS AS (
                         'tp_activity|' || third_party_id::text
                         || '|' || municipality_id::text
                         || '|' || ciiu_activity_id::text
                       ) STORED,
  CONSTRAINT tpa_rango_ck CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT tpa_third_party_fk FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id)
);

CREATE INDEX tpa_tercero_mun_idx ON third_party_activity (third_party_id, municipality_id, vigente_desde);
CREATE INDEX tpa_clave_idx       ON third_party_activity (clave_vigencia, vigente_desde);

SELECT app.instalar_triggers_vigencia('third_party_activity');

COMMENT ON COLUMN third_party_activity.tarifa_ica_override IS
  'Excepcional. NULL = la tarifa se resuelve en tax_rule por municipio y actividad (sección 8.2).';

CREATE TRIGGER third_party_updated_at BEFORE UPDATE ON third_party FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

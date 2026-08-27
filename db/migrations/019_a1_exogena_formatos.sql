-- =============================================================================
-- 019_a1_exogena_formatos.sql — Agente A1, Ola 1
--
-- HALLAZGO: la sección 6.3 exige como parámetro editable "Exógena: Definición
-- de formatos y sus columnas; Topes que obligan a reportar; Mapeo de cuentas
-- PUC a conceptos de cada formato", y la sección 15 (modelo de datos núcleo)
-- NO incluye ninguna tabla para eso. Ni `tax_rule` (que es tarifa+base, no
-- aplica) ni `tax_calendar` (que es fecha de vencimiento dado un período, no
-- el catálogo de formatos en sí) le sirven de hogar. Sin una tabla, los datos
-- de la sección 7.7 (formatos, topes en UVT) no tienen dónde vivir como
-- PARÁMETRO, y quedarían forzados a vivir en código — exactamente lo que
-- prohíbe la Regla de Oro 2.
--
-- Esta migración usa el rango reservado de A1 (019–029) para agregar UNA
-- tabla nueva, puramente aditiva (no toca ninguna tabla existente, no
-- reabre nada del esquema congelado): `exogena_format`, catálogo híbrido con
-- vigencia, igual patrón que `tax_calendar`/`rounding_rule`.
--
-- ALCANCE DELIBERADAMENTE MÍNIMO: solo el catálogo de formatos y su tope en
-- UVT (lo que la sección 7.7 sí da: "Formato 1001... obligados AG 2025:
-- personas jurídicas con ingresos brutos >2.400 UVT"). NO incluye el "mapeo
-- de cuentas PUC a conceptos de cada formato" que pide la sección 6.3: eso
-- necesitaría su propia tabla puente (formato × cuenta × concepto de
-- exógena) y section 7.7 no trae los datos para poblarla todavía. Queda
-- como pendiente de diseño para cuando haya datos que cargar, no como una
-- tabla vacía especulativa.
-- =============================================================================

CREATE TABLE exogena_format (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES tenant(id),   -- NULL = catálogo global (formatos DIAN)
  company_id            uuid REFERENCES company(id),
  formato_codigo        text NOT NULL,
  nombre                text NOT NULL,
  -- Tope en UVT que obliga a reportar (cuando la norma lo expresa así). NULL
  -- = sin tope conocido/aplicable, no "sin tope" (la ausencia no se supone).
  tope_uvt              numeric(12,4) CHECK (tope_uvt IS NULL OR tope_uvt >= 0),
  anio_gravable         smallint CHECK (anio_gravable IS NULL OR anio_gravable BETWEEN 2000 AND 2100),
  vigente_desde         date NOT NULL,
  vigente_hasta         date,
  norma_respaldo        text NOT NULL,
  notas                 text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES "user"(id),
  clave_vigencia        text GENERATED ALWAYS AS (
                          'exogena_format|' || formato_codigo
                          || '|' || COALESCE(tenant_id::text, '-')
                          || '|' || COALESCE(company_id::text, '-')
                        ) STORED,
  CONSTRAINT exogena_format_codigo_ck  CHECK (formato_codigo ~ '^[0-9]{4}$'),
  CONSTRAINT exogena_format_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT exogena_format_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX exogena_format_codigo_idx ON exogena_format (formato_codigo, vigente_desde);
CREATE INDEX exogena_format_clave_idx  ON exogena_format (clave_vigencia, vigente_desde);

COMMENT ON TABLE exogena_format IS
  'Catálogo de formatos de información exógena DIAN (sección 7.7) y su tope en UVT cuando la norma lo da así. NO incluye mapeo de cuentas PUC a conceptos del formato (pendiente de diseño, sección 6.3).';

SELECT app.instalar_triggers_vigencia('exogena_format');
SELECT app.instalar_rls_hibrida('exogena_format');
SELECT app.instalar_permiso_escritura('exogena_format', 'parametro.editar');
SELECT app.instalar_trigger_auditoria('exogena_format');

-- D-016/D-032 (migración 018): `company` y `user` son padres de alcance
-- ESTRICTO (tenant_id NOT NULL), así que el guardia genérico de
-- `app.trg_fk_alcance` es el mecanismo correcto (no una FK compuesta:
-- `exogena_format` es catálogo híbrido y su propio tenant_id puede ser NULL).
SELECT app.instalar_guardia_alcance('exogena_format', 'company_id', 'company', 'created_by', 'user');

GRANT SELECT, INSERT, UPDATE, DELETE ON exogena_format TO app_user;

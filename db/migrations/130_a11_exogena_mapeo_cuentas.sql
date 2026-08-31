-- =============================================================================
-- 130_a11_exogena_mapeo_cuentas.sql — Agente A11, Ola 3
--
-- La migración 019 (A1) creó `exogena_format` pero dejó explícitamente
-- pendiente "el mapeo de cuentas PUC a conceptos de cada formato" que exige
-- la sección 6.3, porque en Ola 1 no había datos que cargar. Ahora sí los
-- hay: para generar el Formato 1007 (ingresos) el producto ya cuenta con
-- `niif_mapping` (clasificacion_niif = 'ingreso'), pero para 1008 (cuentas
-- por cobrar) y 1009 (cuentas por pagar) NO existe ninguna tabla que diga
-- "esta cuenta del PUC de ESTA empresa es una cuenta por cobrar/pagar
-- COMERCIAL para efectos de exógena" — `niif_mapping` solo llega al nivel
-- de 'activo_corriente'/'pasivo_corriente', que también incluye impuestos
-- por pagar, anticipos, préstamos, etc.
--
-- Esta tabla NO es un valor tributario (no es tarifa, tope, UVT ni
-- calendario): es la cuenta del PUC de una firma concreta que el contador
-- decide que corresponde a cada concepto del reporte. Por eso
-- `norma_respaldo` aquí normalmente no cita una resolución DIAN sino la
-- decisión del contador (ver comentario de columna).
-- =============================================================================

CREATE TABLE exogena_account_mapping (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES tenant(id),
  company_id            uuid REFERENCES company(id),
  account_id            uuid NOT NULL REFERENCES account(id),
  formato_codigo        text NOT NULL CHECK (formato_codigo ~ '^[0-9]{4}$'),
  concepto_exogena       text NOT NULL CHECK (concepto_exogena IN (
                          'cuenta_por_cobrar', 'cuenta_por_pagar',
                          'iva_generado', 'iva_descontable',
                          'retencion_practicada_a_la_empresa', 'ingreso'
                        )),
  vigente_desde         date NOT NULL,
  vigente_hasta         date,
  norma_respaldo        text NOT NULL,
  notas                 text,
  requiere_verificacion_humana boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES "user"(id),
  clave_vigencia        text GENERATED ALWAYS AS (
                          'exogena_account_mapping|' || account_id::text
                          || '|' || formato_codigo
                          || '|' || concepto_exogena
                        ) STORED,
  CONSTRAINT exogena_account_mapping_rango_ck   CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT exogena_account_mapping_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX exogena_account_mapping_account_idx ON exogena_account_mapping (account_id, vigente_desde);
CREATE INDEX exogena_account_mapping_clave_idx   ON exogena_account_mapping (clave_vigencia, vigente_desde);
CREATE INDEX exogena_account_mapping_formato_idx ON exogena_account_mapping (formato_codigo, concepto_exogena);

COMMENT ON TABLE exogena_account_mapping IS
  'Mapeo de cuentas PUC a conceptos de un formato de exógena (sección 6.3), pendiente desde 019_a1_exogena_formatos.sql. NO es un valor tributario: es la cuenta que el contador de la firma designa para cada concepto (p. ej. qué cuenta 13xx es "cuenta por cobrar comercial" para el Formato 1008), versionada por vigencia igual que el resto del catálogo paramétrico.';

COMMENT ON COLUMN exogena_account_mapping.norma_respaldo IS
  'Para "cuenta_por_cobrar"/"cuenta_por_pagar"/"iva_generado" suele ser la decisión contable de la firma (p. ej. "Definido por el contador — cuenta comercial de clientes"), no una resolución DIAN: esta tabla no fija tarifas ni topes, solo ubica la cuenta.';

SELECT app.instalar_triggers_vigencia('exogena_account_mapping');
SELECT app.instalar_rls_hibrida('exogena_account_mapping');
SELECT app.instalar_permiso_escritura('exogena_account_mapping', 'parametro.editar');
SELECT app.instalar_trigger_auditoria('exogena_account_mapping');
SELECT app.instalar_guardia_alcance('exogena_account_mapping', 'account_id', 'account', 'company_id', 'company', 'created_by', 'user');

GRANT SELECT, INSERT, UPDATE, DELETE ON exogena_account_mapping TO app_user;

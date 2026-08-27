-- =============================================================================
-- 070_a7_bandeja_causacion.sql — Agente A7, Ola 2 (rango reservado 070-079)
--
-- Apoyo de base de datos para la bandeja de causación multi-empresa
-- (sección 4, Ola 2): "el usuario de la firma ve en una sola pantalla las
-- facturas pendientes de sus 30-60 empresas-cliente... y puede aprobar 50 de
-- un golpe". No crea ningún concepto tributario: cero tarifas, cero bases,
-- cero UVT (Regla de Oro 2). Lo que trae:
--
--   1. `app.empresas_accesibles()` — la sesión de un usuario opera sobre UNA
--      empresa a la vez (D-021/D-022: `app.company_id` es un parámetro que
--      la base autoriza, nunca una lista). Para pintar una bandeja que junte
--      las 30-60 empresas del usuario en una sola pantalla, la interfaz
--      necesita primero SABER cuáles son, sin tener que "probar" una por una
--      (lo que dejaría un ACCESO_DENEGADO en audit_log por cada empresa
--      ajena, D-022). `user_company_access` tiene RLS estricta de empresa
--      (`instalar_rls_tenant_company`), así que consultarla exige ya conocer
--      la empresa: el mismo problema del huevo y la gallina que ya resolvió
--      `app.current_company_id()`. Misma solución: una función SECURITY
--      DEFINER que lee el espejo `app.acceso_usuario_empresa` (sin RLS, sin
--      GRANTs para app_user, D-021) a partir del token de sesión, sin
--      necesitar ninguna empresa ya elegida.
--
--   2. `document_correction` — V-7 y V-8 de la Ola 1 (registro de
--      vulnerabilidades), declaradas y abiertas ahí, asignadas a A7:
--        V-7: el parser de A4 no discrimina AIU por línea; todo concepto con
--             `base_es_aiu` va a revisión manual (motivo
--             concepto_aiu_sin_aiu_declarado) porque no hay valor de AIU.
--             Esta tabla es donde el humano lo captura, por línea del
--             documento (la línea la numera A4/A6 en `extraction`).
--        V-8: `procesarJobCausacion` toma el municipio DEL TERCERO como
--             municipio de la operación por defecto, y la sección 7.5 exige
--             el municipio donde se prestó el servicio. Esta tabla es donde
--             el humano lo corrige, a nivel de documento completo (el motor
--             ya soporta un municipio por línea vía LineaFactura.
--             municipioOperacionId, pero ningún documento real visto hasta
--             ahora trae más de un municipio por factura; se declara la
--             simplificación en vez de inventar un caso que nadie pidió).
--      Ambas correcciones se leen en `causarFactura`
--      (`src/services/causacion.ts`) SOLO mientras el documento sigue en
--      revisión (estado recibido/parseado): una vez causado
--      (pendiente_aprobacion), el asiento ya nació y corregirlo pasa por
--      reversa (Regla de Oro 1), no por esta tabla — ver
--      `docs/reportes/ola2-a7.md` para la limitación declarada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. app.empresas_accesibles() — SECURITY DEFINER + row_security = off, mismo
--    patrón ya auditado que `app.resolver_empresa_por_buzon` (D-023) y los
--    simuladores de impacto de A8 (migración 080): el alcance correcto no lo
--    da la RLS por-empresa (que exigiría ya conocer la empresa), lo da el
--    filtro EXPLÍCITO por user_id/tenant_id de la sesión ya verificada.
--    No cruza firmas: no acepta ningún parámetro, solo lee la sesión actual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.empresas_accesibles()
  RETURNS TABLE(
    company_id       uuid,
    nit              text,
    razon_social     text,
    nombre_comercial text,
    role_codigo      text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_user   uuid := app.current_user_id();
BEGIN
  PERFORM app.exigir_permiso('documento.leer');
  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (c.id)
         c.id, c.nit, c.razon_social, c.nombre_comercial, r.codigo
    FROM app.acceso_usuario_empresa a
    JOIN company c ON c.id = a.company_id AND c.tenant_id = v_tenant
    JOIN role    r ON r.id = a.role_id
   WHERE a.user_id = v_user
     AND a.tenant_id = v_tenant
     AND a.revocado_en IS NULL
     AND c.estado = 'activa'
   ORDER BY c.id, r.codigo;
END $$;

COMMENT ON FUNCTION app.empresas_accesibles() IS
  'Empresas-cliente sobre las que la sesion actual tiene acceso vigente (seccion 4, Ola 2: bandeja multi-empresa). SECURITY DEFINER + row_security=off porque user_company_access exige ya conocer la empresa (RLS estricta) -- aqui se resuelve al reves, a partir del usuario de la sesion. Nunca cruza de tenant: filtra por app.current_tenant_id().';

GRANT EXECUTE ON FUNCTION app.empresas_accesibles() TO app_user;

-- -----------------------------------------------------------------------------
-- 2. document_correction — V-7 (AIU por línea) y V-8 (municipio de la
--    operación), capturadas por un humano ANTES de que la causación se
--    reintente (`reencolarJob`, ya existente de A6, Ola 1).
--
--    Append-only por convención de trazabilidad (Regla de Oro 6: quién
--    corrigió, cuándo y por qué), aunque no es ledger: una corrección nueva
--    no borra la anterior, se lee "la más reciente por (documento, línea)".
-- -----------------------------------------------------------------------------
CREATE TABLE document_correction (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  company_id             uuid NOT NULL,
  source_document_id     uuid NOT NULL,
  tipo                   text NOT NULL CHECK (tipo IN ('aiu_linea', 'municipio_operacion')),
  -- Solo para 'aiu_linea': el numero de linea que numero el parser de A4.
  linea_numero           smallint CHECK (linea_numero IS NULL OR linea_numero > 0),
  valor_aiu_centavos     bigint CHECK (valor_aiu_centavos IS NULL OR valor_aiu_centavos >= 0),
  -- Solo para 'municipio_operacion': donde se presto el servicio de verdad.
  municipio_operacion_id uuid REFERENCES municipality(id),
  motivo                 text NOT NULL,
  creado_por             uuid NOT NULL,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_correction_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT document_correction_doc_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT document_correction_creador_fk FOREIGN KEY (creado_por, tenant_id)
    REFERENCES "user" (id, tenant_id),
  CONSTRAINT document_correction_aiu_ck
    CHECK (tipo <> 'aiu_linea' OR (linea_numero IS NOT NULL AND valor_aiu_centavos IS NOT NULL
                                    AND municipio_operacion_id IS NULL)),
  CONSTRAINT document_correction_municipio_ck
    CHECK (tipo <> 'municipio_operacion' OR (municipio_operacion_id IS NOT NULL
                                              AND linea_numero IS NULL AND valor_aiu_centavos IS NULL))
);

CREATE INDEX document_correction_doc_idx ON document_correction (source_document_id, tipo, creado_en DESC);

COMMENT ON TABLE document_correction IS
  'V-7 (AIU por linea) y V-8 (municipio de la operacion), Ola 1, cerradas por A7 en la Ola 2. Append-only: la lectura toma la fila mas reciente por (documento, linea/tipo). Se aplica en causarFactura solo mientras el documento sigue sin causar (estado recibido/parseado) -- corregir un asiento ya causado es reversa, no esta tabla.';

SELECT app.instalar_rls_tenant_company('document_correction');

-- Guardia de alcance (D-032, patrón (b): padre hibrido) para
-- municipio_operacion_id: `municipality` puede ser catalogo GLOBAL
-- (tenant_id NULL), asi que una FK compuesta no es expresable. Mismo
-- mecanismo que ya usa `third_party.municipality_id`.
SELECT app.instalar_guardia_alcance('document_correction', 'municipio_operacion_id', 'municipality');

-- La captura de una correccion es la antesala explicita de un reproceso:
-- mismo permiso que ya exige `app.reencolar_job` (documento.reprocesar,
-- A6/Ola 1), para que guardar la correccion y reencolar sean, en la
-- practica, una sola decision humana con un solo permiso detras.
SELECT app.instalar_permiso_escritura('document_correction', 'documento.reprocesar');

-- -----------------------------------------------------------------------------
-- 3. Indice que soporta la consulta de la bandeja de "pendientes de
--    revision" (trabajos ya completados por el worker, pero que llegaron a
--    revision_manual en vez de causar). Sin este indice cada empresa de la
--    firma haria un recorrido completo de su cola cerrada.
-- -----------------------------------------------------------------------------
CREATE INDEX document_processing_job_revision_idx
  ON document_processing_job (tenant_id, company_id, updated_at DESC)
  WHERE estado = 'completado' AND (resultado ->> 'requiereRevisionManual') = 'true';

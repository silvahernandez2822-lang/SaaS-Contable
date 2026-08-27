-- =============================================================================
-- 080_a8_parametrizacion_simulador.sql — Agente A8, Ola 2
--
-- Apoyo de base de datos para el módulo de parametrización (sección 6 del
-- mega-prompt). No crea tablas nuevas: el esquema de A1/A2/A3 ya tiene todo
-- lo necesario (vigencias append-only, permiso `parametro.editar` por
-- trigger, auditoría automática). Lo que faltaba eran dos consultas que la
-- interfaz necesita ANTES de guardar una edición:
--
--   1. El simulador de impacto de la sección 6.2, punto 6: "esta tarifa
--      afecta N conceptos y M proveedores".
--   2. La fecha mínima de vigencia que no se retrotrae sobre lo ya
--      publicado (sección 6.2, punto 3). El caso dorado 17 ya prueba que el
--      MOTOR resuelve por vigencia; esto es lo que impide que la INTERFAZ
--      ofrezca una fecha que el motor tendría que rechazar más tarde.
--
-- POR QUÉ SECURITY DEFINER + row_security = off (mismo patrón que
-- `app.resolver_empresa_por_buzon`, D-023, y `app.trg_fk_alcance`, D-032):
-- un parámetro puede ser COMPARTIDO entre todas las empresas de una firma
-- (`company_id IS NULL`, D-015). Si estas consultas corrieran con la RLS
-- normal de `app_user`, una sesión con una empresa concreta seleccionada
-- vería solo el impacto de ESA empresa — subestimando el impacto real del
-- cambio en las demás empresas de la misma firma. El alcance correcto NO lo
-- da la RLS por-empresa: lo da el filtro explícito `tenant_id =
-- app.current_tenant_id()` de cada consulta, que es el mismo límite que ya
-- impone `app.tiene_permiso` para los permisos sin empresa en contexto. Una
-- firma nunca ve el impacto de otra firma: eso lo sigue garantizando el
-- `WHERE tenant_id = ...`, no la RLS.
--
-- Las cinco funciones exigen `parametro.editar`: el simulador es parte del
-- FLUJO DE EDICIÓN (sección 6.2), no una consulta de solo lectura abierta a
-- cualquiera con `parametro.leer`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Impacto de una tarifa/base de `tax_rule` (retefuente, autorretención,
--    ReteIVA, ReteICA por actividad, IVA, tabla progresiva de salarios):
--    cuántos `concepto_causacion` de la firma apuntan a ese `tax_concept`, y
--    cuántos terceros distintos tienen historial de esa retención aplicada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.simular_impacto_tax_concept(p_tax_concept_id uuid)
  RETURNS TABLE(conceptos_afectados bigint, proveedores_afectados bigint)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  WITH afectados AS (
    SELECT cc.id
      FROM concepto_causacion cc
     WHERE cc.tenant_id = v_tenant
       AND (cc.tax_concept_retefuente_id       = p_tax_concept_id
         OR cc.tax_concept_reteiva_id          = p_tax_concept_id
         OR cc.tax_concept_reteiva_exterior_id = p_tax_concept_id
         OR cc.tax_concept_reteica_id          = p_tax_concept_id
         OR cc.tax_concept_autorretencion_id   = p_tax_concept_id)
  )
  SELECT
    (SELECT count(*) FROM afectados)::bigint AS conceptos_afectados,
    (SELECT count(DISTINCT ra.third_party_id)
       FROM retention_applied ra
      WHERE ra.tenant_id = v_tenant
        AND ra.concepto_causacion_id IN (SELECT id FROM afectados))::bigint AS proveedores_afectados;
END $$;

COMMENT ON FUNCTION app.simular_impacto_tax_concept(uuid) IS
  'Simulador de impacto (sección 6.2.6) para una tarifa de tax_rule, agregado a nivel de TODA la firma (no solo la empresa en contexto), porque el parámetro puede ser compartido (company_id NULL, D-015). SECURITY DEFINER + row_security=off con filtro explícito por tenant.';

-- -----------------------------------------------------------------------------
-- 2. Fecha mínima de vigencia para una vigencia nueva de `tax_rule`: el día
--    siguiente al último hecho económico YA PUBLICADO que usó esa regla
--    exacta. NULL si nunca se ha publicado nada con ella (cualquier fecha,
--    incluida una pasada, es segura).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fecha_minima_vigencia_tax_rule(p_tax_rule_id uuid)
  RETURNS date
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_max    date;
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  SELECT max(je.fecha_hecho_economico) INTO v_max
    FROM retention_applied ra
    JOIN journal_entry je
      ON je.id = ra.journal_entry_id AND je.tenant_id = ra.tenant_id
   WHERE ra.tenant_id = v_tenant
     AND ra.tax_rule_id = p_tax_rule_id
     AND je.estado = 'posted';

  RETURN v_max;
END $$;

COMMENT ON FUNCTION app.fecha_minima_vigencia_tax_rule(uuid) IS
  'Último hecho económico ya PUBLICADO con esta tax_rule, agregado a nivel de firma. La interfaz debe exigir vigente_desde > esta fecha (sección 6.2.3): nunca retroactivo sobre lo publicado.';

-- -----------------------------------------------------------------------------
-- 3. Lo mismo, agregado por firma completa, para valores base que afectan a
--    TODOS los conceptos (UVT, SMMLV, redondeo general): el último hecho
--    económico ya publicado en cualquier empresa de la firma.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fecha_minima_vigencia_tenant()
  RETURNS date
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_max    date;
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  SELECT max(je.fecha_hecho_economico) INTO v_max
    FROM journal_entry je
   WHERE je.tenant_id = v_tenant
     AND je.estado = 'posted';

  RETURN v_max;
END $$;

COMMENT ON FUNCTION app.fecha_minima_vigencia_tenant() IS
  'Último hecho económico publicado en cualquier empresa de la firma. Usado para UVT, SMMLV y redondeo general, que no tienen una FK de trazabilidad como tax_rule (D-017) porque afectan a todos los conceptos a la vez.';

-- -----------------------------------------------------------------------------
-- 4. Fecha mínima de vigencia para una `municipality_ica_rule` (bases
--    mínimas de un municipio): el último hecho económico publicado con
--    ReteICA de ese municipio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fecha_minima_vigencia_municipio_ica(p_municipality_id uuid)
  RETURNS date
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_max    date;
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  SELECT max(je.fecha_hecho_economico) INTO v_max
    FROM retention_applied ra
    JOIN journal_entry je
      ON je.id = ra.journal_entry_id AND je.tenant_id = ra.tenant_id
   WHERE ra.tenant_id = v_tenant
     AND ra.municipality_id = p_municipality_id
     AND ra.tipo = 'reteica'
     AND je.estado = 'posted';

  RETURN v_max;
END $$;

COMMENT ON FUNCTION app.fecha_minima_vigencia_municipio_ica(uuid) IS
  'Último hecho económico publicado de ReteICA en este municipio, agregado a nivel de firma.';

-- -----------------------------------------------------------------------------
-- 5. Impacto de una `municipality_ica_rule` (bases mínimas / tarifa general
--    de un municipio): conceptos y proveedores con historial de ReteICA en
--    ese municipio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.simular_impacto_municipio_ica(p_municipality_id uuid)
  RETURNS TABLE(conceptos_afectados bigint, proveedores_afectados bigint)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(DISTINCT ra.concepto_causacion_id)
       FROM retention_applied ra
      WHERE ra.tenant_id = v_tenant AND ra.municipality_id = p_municipality_id
        AND ra.tipo = 'reteica')::bigint AS conceptos_afectados,
    (SELECT count(DISTINCT ra.third_party_id)
       FROM retention_applied ra
      WHERE ra.tenant_id = v_tenant AND ra.municipality_id = p_municipality_id
        AND ra.tipo = 'reteica')::bigint AS proveedores_afectados;
END $$;

COMMENT ON FUNCTION app.simular_impacto_municipio_ica(uuid) IS
  'Simulador de impacto para las bases mínimas / tarifa general de un municipio (municipality_ica_rule), agregado a nivel de firma.';

-- -----------------------------------------------------------------------------
-- 6. Impacto de un valor base (UVT, SMMLV, redondeo general): afecta en
--    principio a todos los conceptos y proveedores con actividad en la
--    firma.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.simular_impacto_valor_base()
  RETURNS TABLE(conceptos_afectados bigint, proveedores_afectados bigint)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM concepto_causacion cc WHERE cc.tenant_id = v_tenant)::bigint,
    (SELECT count(DISTINCT ra.third_party_id)
       FROM retention_applied ra WHERE ra.tenant_id = v_tenant)::bigint;
END $$;

COMMENT ON FUNCTION app.simular_impacto_valor_base() IS
  'Simulador de impacto para valores base que afectan a todos los conceptos (UVT, SMMLV, redondeo general), agregado a nivel de firma.';

GRANT EXECUTE ON FUNCTION app.simular_impacto_tax_concept(uuid)          TO app_user;
GRANT EXECUTE ON FUNCTION app.fecha_minima_vigencia_tax_rule(uuid)       TO app_user;
GRANT EXECUTE ON FUNCTION app.fecha_minima_vigencia_tenant()             TO app_user;
GRANT EXECUTE ON FUNCTION app.fecha_minima_vigencia_municipio_ica(uuid)  TO app_user;
GRANT EXECUTE ON FUNCTION app.simular_impacto_municipio_ica(uuid)        TO app_user;
GRANT EXECUTE ON FUNCTION app.simular_impacto_valor_base()               TO app_user;

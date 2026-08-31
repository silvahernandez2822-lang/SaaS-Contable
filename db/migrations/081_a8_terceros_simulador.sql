-- =============================================================================
-- 081_a8_terceros_simulador.sql — Agente A8, cierre de V-17
--
-- Apoyo de base de datos para el maestro de terceros (sección 6, en lo que
-- aplica a `third_party` / `third_party_fiscal_attribute` / `third_party_
-- activity`). El esquema (005), la vigencia append-only (`instalar_triggers_
-- vigencia`, ya instalada en 005), el permiso `tercero.editar` (016) y la
-- auditoría automática (009) YA EXISTEN: no se tocan aquí.
--
-- Lo que faltaba, exactamente igual que para 080 (tarifas), son las dos
-- consultas que la interfaz necesita ANTES de guardar una edición de un
-- ATRIBUTO FISCAL o de una ACTIVIDAD económica del tercero (sección 6.2,
-- puntos 3 y 6):
--
--   1. Fecha mínima de vigencia que no se retrotrae sobre lo ya publicado.
--   2. El simulador de impacto: cuántos documentos de ESTE proveedor están
--      pendientes de causación y cuántos asientos YA PUBLICADOS existen con
--      su historial de retenciones — la forma que tiene, para UN tercero,
--      la misma advertencia de "esto afecta N cosas" que 080 da para una
--      tarifa que afecta a muchos proveedores.
--
-- SIN SECURITY DEFINER Y SIN row_security=off, a propósito, a diferencia de
-- 080: un parámetro de `tax_rule` puede ser COMPARTIDO entre las empresas de
-- una firma (`company_id NULL`), pero un `third_party` es SIEMPRE de una
-- empresa concreta (`company_id NOT NULL` en 005). La RLS normal de
-- `app_user` ya acota correctamente por tenant+empresa: no hace falta
-- ensanchar el alcance de la consulta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Atributos fiscales (`third_party_fiscal_attribute`)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fecha_minima_vigencia_tercero_fiscal(p_third_party_id uuid)
  RETURNS date
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_max date;
BEGIN
  PERFORM app.exigir_permiso('tercero.editar');

  SELECT max(je.fecha_hecho_economico) INTO v_max
    FROM retention_applied ra
    JOIN journal_entry je
      ON je.id = ra.journal_entry_id AND je.tenant_id = ra.tenant_id
   WHERE ra.third_party_id = p_third_party_id
     AND je.estado = 'posted';

  RETURN v_max;
END $$;

COMMENT ON FUNCTION app.fecha_minima_vigencia_tercero_fiscal(uuid) IS
  'Último hecho económico ya PUBLICADO de este tercero, en cualquier concepto. La interfaz debe exigir vigente_desde > esta fecha (sección 6.2.3) al editar sus atributos fiscales: nunca retroactivo sobre lo publicado.';

CREATE OR REPLACE FUNCTION app.simular_impacto_tercero_fiscal(p_third_party_id uuid)
  RETURNS TABLE(documentos_pendientes bigint, asientos_publicados bigint)
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  PERFORM app.exigir_permiso('tercero.editar');

  RETURN QUERY
  SELECT
    (SELECT count(*)
       FROM document_processing_job dpj
       JOIN source_document sd ON sd.id = dpj.source_document_id
      WHERE sd.third_party_id = p_third_party_id
        AND dpj.estado IN ('pendiente', 'en_proceso'))::bigint AS documentos_pendientes,
    (SELECT count(DISTINCT ra.journal_entry_id)
       FROM retention_applied ra
       JOIN journal_entry je
         ON je.id = ra.journal_entry_id AND je.tenant_id = ra.tenant_id
      WHERE ra.third_party_id = p_third_party_id
        AND je.estado = 'posted')::bigint AS asientos_publicados;
END $$;

COMMENT ON FUNCTION app.simular_impacto_tercero_fiscal(uuid) IS
  'Simulador de impacto (sección 6.2.6) para una vigencia nueva de atributos fiscales de UN tercero: documentos suyos aún sin causar y asientos suyos ya publicados.';

-- -----------------------------------------------------------------------------
-- 2. Actividad económica por municipio (`third_party_activity`) — ReteICA
--    multimunicipio (casos dorados 9 y 10).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fecha_minima_vigencia_tercero_actividad(
  p_third_party_id uuid,
  p_municipality_id uuid
) RETURNS date
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_max date;
BEGIN
  PERFORM app.exigir_permiso('tercero.editar');

  SELECT max(je.fecha_hecho_economico) INTO v_max
    FROM retention_applied ra
    JOIN journal_entry je
      ON je.id = ra.journal_entry_id AND je.tenant_id = ra.tenant_id
   WHERE ra.third_party_id = p_third_party_id
     AND ra.municipality_id = p_municipality_id
     AND ra.tipo = 'reteica'
     AND je.estado = 'posted';

  RETURN v_max;
END $$;

COMMENT ON FUNCTION app.fecha_minima_vigencia_tercero_actividad(uuid, uuid) IS
  'Último hecho económico ya PUBLICADO de ReteICA de este tercero EN ESE municipio. Igual que la de atributos fiscales, pero acotada al municipio que se está editando (un proveedor puede tener actividad en varios).';

CREATE OR REPLACE FUNCTION app.simular_impacto_tercero_actividad(
  p_third_party_id uuid,
  p_municipality_id uuid
) RETURNS TABLE(documentos_pendientes bigint, asientos_publicados bigint)
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  PERFORM app.exigir_permiso('tercero.editar');

  RETURN QUERY
  SELECT
    (SELECT count(*)
       FROM document_processing_job dpj
       JOIN source_document sd ON sd.id = dpj.source_document_id
      WHERE sd.third_party_id = p_third_party_id
        AND dpj.estado IN ('pendiente', 'en_proceso'))::bigint AS documentos_pendientes,
    (SELECT count(DISTINCT ra.journal_entry_id)
       FROM retention_applied ra
       JOIN journal_entry je
         ON je.id = ra.journal_entry_id AND je.tenant_id = ra.tenant_id
      WHERE ra.third_party_id = p_third_party_id
        AND ra.municipality_id = p_municipality_id
        AND ra.tipo = 'reteica'
        AND je.estado = 'posted')::bigint AS asientos_publicados;
END $$;

COMMENT ON FUNCTION app.simular_impacto_tercero_actividad(uuid, uuid) IS
  'Simulador de impacto (sección 6.2.6) para una vigencia nueva de actividad económica de UN tercero en UN municipio: documentos suyos pendientes (cualquier municipio, porque el documento aún no tiene ICA resuelto) y asientos de ReteICA ya publicados en ese municipio.';

GRANT EXECUTE ON FUNCTION app.fecha_minima_vigencia_tercero_fiscal(uuid)      TO app_user;
GRANT EXECUTE ON FUNCTION app.simular_impacto_tercero_fiscal(uuid)           TO app_user;
GRANT EXECUTE ON FUNCTION app.fecha_minima_vigencia_tercero_actividad(uuid, uuid) TO app_user;
GRANT EXECUTE ON FUNCTION app.simular_impacto_tercero_actividad(uuid, uuid)  TO app_user;

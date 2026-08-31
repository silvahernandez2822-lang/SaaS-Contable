-- =============================================================================
-- 140_a12_arranque_y_repaso_141.sql — Agente A12
--
-- Repaso de la sección 14.1 contra el sistema REAL (Olas 0 a 3), no contra el
-- de la Ola 0. Tres huecos encontrados y cerrados aquí, todos impuestos por el
-- motor y no por la aplicación:
--
-- A. LOS ATRIBUTOS FISCALES DE UN TERCERO SE COMPORTAN COMO PARÁMETRO.
--    `tercero.editar` autorizaba, con el mismo código, dos cosas de riesgo muy
--    distinto: (1) el maestro de datos del tercero (NIT, razón social,
--    dirección) y (2) sus vigencias fiscales y su actividad económica, que
--    ENTRAN EN EL CÁLCULO de la retención. Lo tenían el contador y el auxiliar
--    de causación, cuya definición literal (014) es "prepara borradores; no
--    aprueba, no publica y NO EDITA PARÁMETROS".
--
--    El caso extremo es `third_party_activity.tarifa_ica_override`: una TARIFA,
--    en el sentido exacto de la sección 6.2 punto 5 y de la Regla de Oro 2.
--    Un auxiliar podía fijarla y con ello cambiar el ReteICA que el motor
--    calcula, sin tener `parametro.editar`.
--
--    Se parte el permiso en el punto donde cambia el riesgo:
--      · `tercero.editar`               -> maestro (`third_party`). Sigue en
--        contador y auxiliar: sin él no se puede causar la factura de un
--        proveedor nuevo, que es su trabajo diario.
--      · `tercero.atributos_fiscales`   -> `third_party_fiscal_attribute` y
--        `third_party_activity`. Admin de firma, admin tributario y contador.
--        El auxiliar lo PIERDE.
--      · `parametro.editar`             -> ADEMÁS, para fijar un
--        `tarifa_ica_override` no nulo. Una tarifa es una tarifa aunque viva
--        en la ficha de un tercero.
--
--    Por qué el contador SÍ conserva los atributos fiscales y el auxiliar no:
--    el contador ya tiene `causacion.aprobar`, `asiento.publicar` y
--    `periodo.cerrar` — es quien responde por el resultado y quien lo firma;
--    quitárselo movería el trabajo de sitio sin reducir ninguna exposición.
--    El auxiliar, en cambio, no aprueba nada: darle la capacidad de cambiar la
--    tarifa efectiva de un tercero era una elevación real de privilegio.
--
-- B. EL MAESTRO DE TERCEROS NO SE AUDITABA. `third_party_fiscal_attribute` y
--    `third_party_activity` sí; `third_party` no. Y `third_party.municipality_id`
--    decide el municipio de ReteICA: cambiarlo cambia el impuesto y no dejaba
--    rastro. Se le instala el trigger de auditoría genérico.
--
-- C. LA DESCARGA DE REPORTES NO SE AUDITABA. `audit_log.accion` contempla
--    'EXPORT' desde 009 y NADIE lo escribía: la ruta de A9 sirve el libro
--    mayor completo de una empresa en .xlsx sin dejar huella. Extraer en bloque
--    los datos contables de una empresa es una acción sensible en el sentido
--    de la 14.1. Se añade `app.registrar_exportacion`, que la ruta invoca
--    dentro de la MISMA sesión verificada que autorizó la lectura.
-- =============================================================================

-- =============================================================================
-- A. `tercero.atributos_fiscales`
-- =============================================================================

INSERT INTO permission (codigo, nombre, descripcion, modulo) VALUES
  ('tercero.atributos_fiscales', 'Editar atributos fiscales de terceros',
   'Registrar vigencias de atributos fiscales y de actividad economica de un tercero, que entran en el calculo de la retencion',
   'terceros');

-- admin_firma (todos), admin_tributario y contador. El auxiliar NO.
INSERT INTO role_permission (role_id, permission_codigo)
SELECT r.id, 'tercero.atributos_fiscales'
  FROM role r
 WHERE r.tenant_id IS NULL
   AND r.codigo IN ('admin_firma', 'admin_tributario', 'contador');

-- Retarget de los dos triggers de permiso. El nombre del trigger no cambia
-- (`<tabla>_permiso`), así que el ORDEN DE DISPARO alfabético que 016 razonó
-- se conserva intacto.
DROP TRIGGER third_party_fiscal_attribute_permiso ON third_party_fiscal_attribute;
DROP TRIGGER third_party_activity_permiso         ON third_party_activity;

SELECT app.instalar_permiso_escritura('third_party_fiscal_attribute', 'tercero.atributos_fiscales');
SELECT app.instalar_permiso_escritura('third_party_activity',         'tercero.atributos_fiscales');

-- -----------------------------------------------------------------------------
-- Guardia adicional: una TARIFA exige `parametro.editar`, viva donde viva.
-- Se comprueba sobre la fila resultante, no sobre el verbo: da igual si llega
-- por INSERT o por UPDATE, y da igual que la columna venga "heredada".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_exigir_permiso_tarifa_ica() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.tarifa_ica_override IS NOT NULL THEN
    PERFORM app.exigir_permiso('parametro.editar');
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.trg_exigir_permiso_tarifa_ica() IS
  'Regla de Oro 2 / seccion 6.2 punto 5: fijar una tarifa exige parametro.editar aunque la tarifa viva en la ficha de un tercero.';

CREATE TRIGGER third_party_activity_permiso_tarifa
  BEFORE INSERT OR UPDATE ON third_party_activity
  FOR EACH ROW EXECUTE FUNCTION app.trg_exigir_permiso_tarifa_ica();

-- =============================================================================
-- B. Auditoría del maestro de terceros
-- =============================================================================

SELECT app.instalar_trigger_auditoria('third_party');

-- =============================================================================
-- C. Auditoría de la exportación de reportes
-- =============================================================================

CREATE OR REPLACE FUNCTION app.registrar_exportacion(
  p_reporte text,
  p_detalle jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_id bigint;
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion que registrar'
      USING ERRCODE = 'SE001';
  END IF;

  -- Quien exporta debe poder exportar. La ruta ya lo comprueba; aquí se
  -- impone, para que ningún camino futuro escriba el rastro sin el permiso
  -- (y, sobre todo, para que no exista un "exportar sin auditar").
  PERFORM app.exigir_permiso('reporte.exportar');

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
          'EXPORT', 'reporte', p_reporte,
          COALESCE(p_detalle, '{}'::jsonb),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION app.registrar_exportacion(text, jsonb) IS
  'Rastro EXPORT de la seccion 14.1: que reporte, de que empresa, quien, cuando y desde donde. Exige reporte.exportar.';

GRANT EXECUTE ON FUNCTION app.registrar_exportacion(text, jsonb) TO app_user;

-- =============================================================================
-- 174_a8_d084_terceros_fase3.sql — Fase 3 del Módulo de Terceros (D-084).
--
-- Una sola cosa, e impuesta por el MOTOR y no por la aplicación (mismo criterio
-- que 016/140): un tercero solo se puede BORRAR si nunca tuvo movimientos. Si
-- ya los tuvo, el único camino es INACTIVARLO (`third_party.activo = false`),
-- nunca un DELETE — porque el ledger, la exógena y los certificados que ya
-- citan ese tercero deben poder seguir resolviéndolo por su id para siempre
-- (Reglas de Oro 1 y 6: trazabilidad total, nada se borra hacia atrás).
--
-- QUÉ CUENTA COMO "MOVIMIENTO" DE UN TERCERO:
--   1. Una partida del ledger a su nombre               (journal_line)
--   2. Un documento soporte suyo recibido               (source_document)
--   3. Una retención trazada contra él                  (retention_applied)
--   4. Un atributo fiscal suyo cuya vigencia YA surtió  (third_party_fiscal_attribute
--      efecto  (vigente_desde <= CURRENT_DATE)           con vigente_desde <= hoy)
--   5. Una actividad económica suya cuya vigencia YA     (third_party_activity
--      surtió efecto                                      con vigente_desde <= hoy)
--
-- Los puntos 4 y 5 están porque una vigencia que ya rigió NO SE PUEDE BORRAR
-- (trigger PR003 de 001_fundacion): un tercero con una declaración fiscal en
-- firme es, para todos los efectos, un tercero "en uso". Una vigencia FUTURA
-- (un cambio programado que aún no rige) sí es cancelable, así que no bloquea
-- —la capa de servicio la limpia antes del DELETE—.
--
-- ORDEN DE DISPARO. PostgreSQL ejecuta los triggers BEFORE de fila en orden
-- alfabético. `third_party_restrict_delete` queda DESPUÉS de
-- `third_party_permiso` (016): primero se comprueba que la sesión pueda editar
-- terceros (SE002), y solo entonces se comprueba que este tercero en concreto
-- sea borrable (TP001). Es el orden correcto: un rol sin permiso nunca llega a
-- ver el mensaje sobre movimientos.
--
-- Esto NO es dato tributario (Regla de Oro 2): no hay aquí ni una tarifa, base,
-- UVT, tope ni calendario. Es una regla de integridad del maestro de datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ¿Este tercero tiene algún movimiento que impida borrarlo?
--
-- SECURITY DEFINER para poder mirar las cinco tablas sin depender de qué
-- políticas RLS estén activas en la sesión que pregunta; STABLE porque no
-- escribe nada. La usa el trigger de abajo y también la capa de servicio, para
-- que la interfaz pueda deshabilitar el botón "Eliminar" con el mismo criterio
-- exacto que el motor aplica (nunca una UI que promete lo que el backend niega).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tercero_tiene_movimientos(p_third_party_id uuid)
RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT
         EXISTS (SELECT 1 FROM public.journal_line       WHERE third_party_id = p_third_party_id)
      OR EXISTS (SELECT 1 FROM public.source_document     WHERE third_party_id = p_third_party_id)
      OR EXISTS (SELECT 1 FROM public.retention_applied   WHERE third_party_id = p_third_party_id)
      OR EXISTS (SELECT 1 FROM public.third_party_fiscal_attribute
                  WHERE third_party_id = p_third_party_id AND vigente_desde <= CURRENT_DATE)
      OR EXISTS (SELECT 1 FROM public.third_party_activity
                  WHERE third_party_id = p_third_party_id AND vigente_desde <= CURRENT_DATE)
  $$;

COMMENT ON FUNCTION app.tercero_tiene_movimientos(uuid) IS
  'D-084: true si el tercero aparece en el ledger, en un documento soporte, en una retencion aplicada, o tiene una vigencia fiscal/de actividad que ya surtio efecto. Un tercero asi solo se inactiva, nunca se borra.';

GRANT EXECUTE ON FUNCTION app.tercero_tiene_movimientos(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- El guardia: ningún camino borra un tercero con movimientos. Ni la interfaz,
-- ni una acción de servidor, ni un `DELETE FROM third_party` directo contra la
-- base.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_third_party_restrict_delete() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF app.tercero_tiene_movimientos(OLD.id) THEN
    RAISE EXCEPTION
      'TERCERO_CON_MOVIMIENTOS: el tercero % ya tiene movimientos asociados (ledger, documentos, retenciones o una vigencia fiscal en firme) y no se puede borrar. Inactívelo en su lugar (third_party.activo = false): sigue en la base para que la trazabilidad, la exogena y los certificados lo resuelvan.',
      OLD.id
      USING ERRCODE = 'TP001';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER third_party_restrict_delete
  BEFORE DELETE ON third_party
  FOR EACH ROW EXECUTE FUNCTION app.trg_third_party_restrict_delete();

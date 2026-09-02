-- =============================================================================
-- 173_a14_v23_invariantes_reproceso.sql — A14 (compuerta adversarial ampliada
-- de V-23). Corrige TRES defectos que la compuerta de V-23 no detectó
-- (V-27, V-28 y V-32).
--
-- V-27 · El índice que 172 documenta NO EXISTÍA.
--   El COMMENT de `app.reintegrar_documento_rechazado` y el comentario de
--   `src/services/bandeja.ts` afirmaban que «el índice
--   journal_entry_causacion_viva_uq impide el duplicado real». Ese índice no
--   se creó nunca en ninguna migración: el invariante «a lo sumo un asiento de
--   causación VIVO por documento» quedaba sostenido solo por la aritmética de
--   `idempotencyKeyCausacion` y por la guardia de estado de la aplicación.
--   Eso contradice el principio del proyecto —la garantía la pone el motor,
--   no la aplicación (Reglas de Oro 1 y 7)— y, peor, dejaba una afirmación
--   FALSA en la documentación durable que otro agente leería como cierta.
--   Aquí se crea el índice de verdad.
--
--   Alcance deliberadamente estrecho: se restringe a los asientos que produce
--   el MOTOR de causación (`idempotency_key LIKE 'causacion:%'`). Un asiento
--   manual, un ajuste o una reversa sobre el mismo documento no quedan
--   limitados: el invariante que se defiende es el de la causación automática,
--   no el de todo lo que un contador pueda registrar contra un documento.
--
-- V-28 · Una NOTA CRÉDITO rechazada por error seguía siendo irrecuperable, y
--   además rompía el worker.
--   `causarNotaCredito` crea su asiento con `reverses_entry_id = <asiento de
--   la factura original>`, y `journal_entry_reversa_uq UNIQUE
--   (reverses_entry_id)` es TOTAL: no distingue el asiento anulado del vivo.
--   Resultado medido por A14: tras reintegrar una nota rechazada, el segundo
--   intento moría con 23505 sobre `journal_entry_reversa_uq` — una excepción
--   NO manejada que aborta la transacción entera del worker. V-23 empeoró el
--   caso en vez de arreglarlo: antes la reintegración se bloqueaba limpio,
--   después el documento queda en 'parseado' con un trabajo que falla en cada
--   intento.
--
--   La restricción correcta es PARCIAL: un asiento de reversa ANULADO no
--   "consume" el original. Solo puede haber una reversa VIVA por asiento
--   original — que es el invariante contable que se quería (no reversar dos
--   veces lo mismo), y el que la restricción total confundía con "no haber
--   intentado nunca reversarlo".
--
-- Reglas de Oro: RO-1 (no se toca ningún asiento existente; solo cambian
-- restricciones), RO-2 (aquí no entra ni una tarifa), RO-7 (ambas garantías
-- quedan en el motor de base de datos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- V-27 — el invariante «un solo asiento de causación vivo por documento»,
-- ahora impuesto por la base.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS journal_entry_causacion_viva_uq
  ON journal_entry (company_id, source_document_id)
  WHERE idempotency_key LIKE 'causacion:%' AND estado <> 'anulado';

COMMENT ON INDEX journal_entry_causacion_viva_uq IS
  'V-23/V-27: a lo sumo UN asiento de causacion vivo (draft o posted) por documento. Los anulados quedan fuera del indice a proposito: son el rastro de un rechazo, y el reproceso versiona la idempotency_key (causacion:<doc>#n) para crear el siguiente. Lo impone la base, no la aplicacion.';

-- -----------------------------------------------------------------------------
-- V-28 — una reversa anulada no bloquea la siguiente.
-- -----------------------------------------------------------------------------
ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_reversa_uq;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entry_reversa_viva_uq
  ON journal_entry (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL AND estado <> 'anulado';

COMMENT ON INDEX journal_entry_reversa_viva_uq IS
  'V-28: un asiento publicado se reversa UNA sola vez con un asiento VIVO. Reemplaza journal_entry_reversa_uq, que era total y por tanto trataba un intento de reversa ANULADO (una nota credito rechazada por error) como si el original ya estuviera reversado, dejando la nota irrecuperable.';

-- -----------------------------------------------------------------------------
-- V-32 — el resguardo REPROCESO_BLOQUEADO no cubría las NOTAS CRÉDITO.
--
-- `app.reintegrar_documento_rechazado` (172) identificaba «el asiento de
-- causación en conflicto» con `tipo <> 'reversa'`. El asiento que el motor
-- produce para una NOTA CRÉDITO es, por definición, de `tipo = 'reversa'`
-- (reversa proporcional del asiento de la factura original, caso dorado 15),
-- así que quedaba SIEMPRE fuera del filtro: una nota rechazada con un asiento
-- todavía VIVO se reintegraba sin encontrar resistencia, justo el caso que el
-- resguardo existe para cortar.
--
-- El predicado correcto no es el tipo, es la CLAVE: el motor de causación
-- escribe `causacion:<doc>` (y `causacion:<doc>#n` en el reproceso) tanto para
-- la factura como para la nota, mientras que una reversa manual de un asiento
-- publicado (`reversarAsientoPublicado`) escribe `reversa:<asiento>` y cuelga
-- del source_document de la FACTURA, no de un documento propio. Filtrar por
-- `idempotency_key LIKE 'causacion:%'` selecciona exactamente los asientos que
-- este documento generó por causación automática, ni uno más.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.reintegrar_documento_rechazado(
  p_source_document_id uuid,
  p_motivo             text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_estado        text;
  v_conflicto     uuid;
  v_conf_estado   text;
  v_reproceso_n   integer;
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion' USING ERRCODE = 'SE001';
  END IF;
  PERFORM app.exigir_permiso('documento.reprocesar');

  SELECT estado INTO v_estado
    FROM source_document
   WHERE id = p_source_document_id
   FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'DOCUMENTO_INEXISTENTE: el documento % no existe en el contexto actual', p_source_document_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'rechazado' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: solo se reintegra un documento en estado ''rechazado'' (esta en ''%'')', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, estado
    INTO v_conflicto, v_conf_estado
    FROM journal_entry
   WHERE company_id = app.current_company_id()
     AND source_document_id = p_source_document_id
     AND idempotency_key LIKE 'causacion:%'
   ORDER BY (estado <> 'anulado') DESC, created_at DESC
   LIMIT 1;

  IF v_conflicto IS NOT NULL AND v_conf_estado <> 'anulado' THEN
    RAISE EXCEPTION
      'REPROCESO_BLOQUEADO: el documento % tiene un asiento de causacion en estado ''%'' (%) que no esta anulado. '
      'Una rechazada solo se reintegra cuando su unico asiento quedo anulado por el rechazo. '
      'Revise el estado del asiento con soporte antes de continuar.',
      p_source_document_id, v_conf_estado, v_conflicto
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT count(*)::int
    INTO v_reproceso_n
    FROM journal_entry
   WHERE company_id = app.current_company_id()
     AND source_document_id = p_source_document_id
     AND idempotency_key LIKE 'causacion:%';

  UPDATE source_document
     SET estado = 'parseado', motivo_rechazo = NULL
   WHERE id = p_source_document_id;

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_anterior, valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
          'UPDATE', 'source_document', p_source_document_id::text,
          jsonb_build_object('estado', 'rechazado'),
          jsonb_build_object(
            'estado', 'parseado',
            'accion', 'reintegrado a la cola de causacion (V-23)',
            'desde_estado', 'rechazado',
            'reproceso_numero', v_reproceso_n,
            'asiento_anulado_previo', v_conflicto,
            'motivo', NULLIF(btrim(coalesce(p_motivo, '')), '')),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id());
END $$;

COMMENT ON FUNCTION app.reintegrar_documento_rechazado(uuid, text) IS
  'V-23/V-32: devuelve un documento rechazado (factura O nota credito) a la cola de causacion. Procede si no dejo asiento de causacion, o si el unico que dejo quedo ANULADO por el rechazo; el motor versiona la idempotency_key en el reintento y journal_entry_causacion_viva_uq impide el duplicado real. BLOQUEA con REPROCESO_BLOQUEADO cualquier asiento de causacion en conflicto que no este anulado. Exige documento.reprocesar. Deja rastro ampliado en audit_log.';

GRANT EXECUTE ON FUNCTION app.reintegrar_documento_rechazado(uuid, text) TO app_user;

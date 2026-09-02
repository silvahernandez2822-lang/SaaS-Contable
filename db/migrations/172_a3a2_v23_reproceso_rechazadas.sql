-- =============================================================================
-- 172_a3a2_v23_reproceso_rechazadas.sql — A3 (motor de causación) + A2
-- (alcance / integridad estructural). Cierra V-23.
--
-- PROBLEMA (registrado por A14 en la compuerta ampliada de D-079): una factura
-- rechazada por error en la aprobación no se recupera por ningún camino de la
-- interfaz.
--   · `aprobarAsiento(decision <> 'aprobado')` anula el asiento borrador y deja
--     el documento en 'rechazado'. El asiento anulado CONSERVA su
--     `idempotency_key = 'causacion:<doc>'`.
--   · `app.reintegrar_documento_rechazado` cortaba SIEMPRE que existiera ese
--     asiento (REPROCESO_BLOQUEADO), porque un segundo intento de causación
--     chocaba contra `journal_entry_idem_uq (company_id, idempotency_key)`.
--   · Volver a cargar el XML no hace nada: la ingesta deduplica por CUFE/hash y
--     el motor da el documento por `ya_procesado`.
--
-- SOLUCIÓN, en dos piezas que encajan:
--
--  A3 — `causarFactura` / `causarNotaCredito` (en `src/services/causacion.ts`)
--       calculan la clave como `causacion:<doc>` en el primer intento
--       (retrocompatible) y `causacion:<doc>#<n>` cuando ese documento ya dejó
--       asientos de causación atrás (todos anulados). Así el segundo intento no
--       choca contra `journal_entry_idem_uq (company_id, idempotency_key)`.
--
--  A2 — La transición de vuelta es la ÚNICA puerta a un segundo asiento, y la
--       impone la base, no la aplicación: `app.reintegrar_documento_rechazado`
--       exige que el único asiento de causación en conflicto esté ANULADO antes
--       de devolver el documento a 'parseado'. Si hay un asiento VIVO (draft
--       sin anular), corta con REPROCESO_BLOQUEADO. Combinado con la guardia de
--       estado de `procesarJobCausacion` (solo entra a `causarFactura` un
--       documento en 'recibido'/'parseado', y una causación exitosa lo saca de
--       ahí) y con la serialización de la cola (`FOR UPDATE SKIP LOCKED`, un
--       worker por job), el invariante "a lo sumo un asiento de causación vivo
--       por documento" se sostiene sin relajar nada.
--
--  Transición de estado — `app.reintegrar_documento_rechazado` deja de bloquear
--  el caso "el único asiento en conflicto está ANULADO": lo reintegra a
--  'parseado' dejando rastro AMPLIADO en `audit_log` (quién, cuándo, desde qué
--  estado, qué asiento anulado quedó atrás, qué número de reproceso es). El
--  bloqueo REPROCESO_BLOQUEADO SE MANTIENE como resguardo por defecto para
--  cualquier otro caso: un asiento en conflicto que NO esté anulado sigue
--  cortando.
--
-- Reglas de Oro respetadas:
--   · RO-1: no se toca ningún asiento 'posted' ni 'anulado'. El asiento anulado
--     se queda EXACTAMENTE como está; el reproceso crea uno nuevo.
--   · RO-2: ninguna tarifa, base ni calendario entra aquí. La clave versionada
--     es un identificador técnico, no un valor tributario.
--   · RO-6: cada reintegración deja su fila en `audit_log` con el actor real.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Transición rechazado -> parseado con reproceso auditado.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.reintegrar_documento_rechazado(uuid);

CREATE FUNCTION app.reintegrar_documento_rechazado(
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

  -- FOR UPDATE: la reintegración compite con un `aprobarAsiento` en curso sobre
  -- el mismo documento (otro revisor). Sin el bloqueo, dos sesiones podrían
  -- leer 'rechazado' a la vez y encolar dos reprocesos.
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

  -- ¿Hay un asiento de causación en conflicto? Se prefiere el VIVO si lo hay.
  SELECT id, estado
    INTO v_conflicto, v_conf_estado
    FROM journal_entry
   WHERE company_id = app.current_company_id()
     AND source_document_id = p_source_document_id
     AND tipo <> 'reversa'
   ORDER BY (estado <> 'anulado') DESC, created_at DESC
   LIMIT 1;

  -- RESGUARDO QUE SE MANTIENE (V-23 no lo relaja): si el asiento en conflicto
  -- NO esta anulado, algo esta mal (un draft vivo, o un posted que los triggers
  -- de RO-1 jamas deberian permitir aqui). Se corta igual que antes.
  IF v_conflicto IS NOT NULL AND v_conf_estado <> 'anulado' THEN
    RAISE EXCEPTION
      'REPROCESO_BLOQUEADO: el documento % tiene un asiento de causacion en estado ''%'' (%) que no esta anulado. '
      'Una rechazada solo se reintegra cuando su unico asiento quedo anulado por el rechazo. '
      'Revise el estado del asiento con soporte antes de continuar.',
      p_source_document_id, v_conf_estado, v_conflicto
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Numero de reproceso: cuantos asientos de causacion (todos anulados) dejo
  -- atras este documento. 0 => primera causacion frustrada por otra via.
  SELECT count(*)::int
    INTO v_reproceso_n
    FROM journal_entry
   WHERE company_id = app.current_company_id()
     AND source_document_id = p_source_document_id
     AND tipo <> 'reversa';

  -- 'parseado' es uno de los dos estados que `causarFactura` acepta como
  -- entrada (el otro es 'recibido'). El motor volvera a resolver contra la
  -- vigencia de la FECHA DEL HECHO ECONOMICO (RO-3), no la de hoy.
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
  'V-23: devuelve un documento rechazado a la cola de causacion. Procede si no dejo asiento, o si el unico asiento en conflicto quedo ANULADO por el rechazo (el motor versiona la idempotency_key en el reintento; el indice journal_entry_causacion_viva_uq impide el duplicado real). BLOQUEA con REPROCESO_BLOQUEADO cualquier asiento en conflicto que no este anulado. Exige documento.reprocesar. Deja rastro ampliado en audit_log.';

GRANT EXECUTE ON FUNCTION app.reintegrar_documento_rechazado(uuid, text) TO app_user;

-- =============================================================================
-- 171_a7_d079_bandeja_fase2.sql — A7 · D-079 (Ola 5, refinamiento de interfaz,
-- Fase 2). Completa la FUNCIONALIDAD de la bandeja de causación que D-077 dejó
-- solo restyleada. Todo lo que aquí se añade se impone en el motor, no en la
-- aplicación (Regla de Oro 7 y el principio de "la garantía la pone la base").
--
-- A. ESTADO 'archivado' para el documento rechazado. Un revisor que descarta
--    una factura rechazada NO la borra (Regla de Oro 1 / append-only y la
--    trazabilidad de la Regla de Oro 6): la mueve a 'archivado'. La fila, su
--    `xml_crudo`, su asiento anulado y su `audit_log` permanecen. Sale de
--    todas las bandejas y listados. Un administrador puede devolverla.
--
-- B. app.registrar_edicion_asiento_borrador — rastro en `audit_log` de toda
--    edición manual de un asiento BORRADOR antes de aprobarlo (cuenta y/o
--    monto de una línea). `journal_line` no tiene trigger de auditoría (nunca
--    se editaba a mano); esta función escribe la fila EXPLÍCITAMENTE, con el
--    antes, el después y la justificación obligatoria del usuario (Regla de
--    Oro 6: "quién aprobó, qué cambió y por qué"). Mismo patrón que
--    `app.registrar_exportacion` (140): NO es SECURITY DEFINER — `app_user`
--    ya tiene INSERT sobre `audit_log` —, solo encapsula y exige el permiso.
--
-- C. app.archivar_documento_rechazado / app.reintegrar_documento_rechazado —
--    las dos transiciones de la sub-bandeja de rechazadas. La reintegración
--    SOLO procede si el documento no dejó un asiento que colisione con la
--    clave de idempotencia de la causación; si lo dejó, se BLOQUEA con un
--    mensaje claro (la reintegración completa de ese caso toca el motor de
--    A3 y queda pendiente — ver ESTADO_PROYECTO.md, D-079).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. estado 'archivado'
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'public.source_document'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%estado%'
     AND pg_get_constraintdef(oid) ILIKE '%duplicado%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE source_document DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE source_document
  ADD CONSTRAINT source_document_estado_check
  CHECK (estado IN ('recibido','en_cuarentena','parseado','clasificado',
                    'pendiente_aprobacion','aprobado','causado',
                    'rechazado','anulado','duplicado','archivado'));

COMMENT ON CONSTRAINT source_document_estado_check ON source_document IS
  'D-079: se añade ''archivado'' — un documento rechazado que un revisor retira de la bandeja. No se borra (Regla de Oro 1): la fila, su XML y su audit_log permanecen; solo sale de las vistas de trabajo. Estado TERMINAL por ahora: no existe todavia una transicion de vuelta (archivado -> rechazado); desarchivar exige intervencion sobre la base (pendiente A7, ver ESTADO_PROYECTO.md D-079).';

-- -----------------------------------------------------------------------------
-- B. Rastro de la edición manual de un asiento borrador
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.registrar_edicion_asiento_borrador(
  p_journal_entry_id uuid,
  p_valor_anterior   jsonb,
  p_valor_nuevo      jsonb,
  p_justificacion    text
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

  -- Editar un borrador exige el mismo permiso que el trigger de `journal_entry`
  -- (016): que ningún camino futuro escriba el asiento sin dejar el rastro.
  PERFORM app.exigir_permiso('causacion.editar_borrador');

  IF p_justificacion IS NULL OR btrim(p_justificacion) = '' THEN
    RAISE EXCEPTION 'JUSTIFICACION_OBLIGATORIA: apartarse de la propuesta del motor exige una justificacion (Regla de Oro 6)'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_anterior, valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
          'UPDATE', 'journal_entry', p_journal_entry_id::text,
          p_valor_anterior,
          jsonb_build_object('lineas', p_valor_nuevo, 'justificacion', btrim(p_justificacion)),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION app.registrar_edicion_asiento_borrador(uuid, jsonb, jsonb, text) IS
  'D-079: rastro en audit_log de una edicion manual (cuenta/monto) de un asiento borrador antes de aprobarlo. Exige causacion.editar_borrador y una justificacion no vacia.';

GRANT EXECUTE ON FUNCTION app.registrar_edicion_asiento_borrador(uuid, jsonb, jsonb, text) TO app_user;

-- -----------------------------------------------------------------------------
-- C. Sub-bandeja de rechazadas — archivar y reintegrar
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.archivar_documento_rechazado(
  p_source_document_id uuid,
  p_motivo             text
) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_estado text;
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion' USING ERRCODE = 'SE001';
  END IF;
  PERFORM app.exigir_permiso('documento.reprocesar');

  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'MOTIVO_OBLIGATORIO: archivar un documento exige un motivo (Regla de Oro 6)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT estado INTO v_estado FROM source_document WHERE id = p_source_document_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'DOCUMENTO_INEXISTENTE: el documento % no existe en el contexto actual', p_source_document_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'rechazado' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: solo se archiva un documento en estado ''rechazado'' (esta en ''%'')', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  -- El trigger de permiso de escritura de source_document (016) exige ademas
  -- documento.cargar. Se deja que lo imponga la base.
  UPDATE source_document
     SET estado = 'archivado',
         motivo_rechazo = left(coalesce(motivo_rechazo, ''), 400) || ' | archivado: ' || btrim(p_motivo)
   WHERE id = p_source_document_id;

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_anterior, valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
          'UPDATE', 'source_document', p_source_document_id::text,
          jsonb_build_object('estado', 'rechazado'),
          jsonb_build_object('estado', 'archivado', 'motivo', btrim(p_motivo)),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id());
END $$;

COMMENT ON FUNCTION app.archivar_documento_rechazado(uuid, text) IS
  'D-079: mueve un documento rechazado a ''archivado'' (sale de las vistas; la fila y el XML permanecen). Exige documento.reprocesar y un motivo.';

GRANT EXECUTE ON FUNCTION app.archivar_documento_rechazado(uuid, text) TO app_user;


CREATE OR REPLACE FUNCTION app.reintegrar_documento_rechazado(
  p_source_document_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_estado    text;
  v_idem_key  text;
  v_conflicto uuid;
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion' USING ERRCODE = 'SE001';
  END IF;
  PERFORM app.exigir_permiso('documento.reprocesar');

  SELECT estado INTO v_estado FROM source_document WHERE id = p_source_document_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'DOCUMENTO_INEXISTENTE: el documento % no existe en el contexto actual', p_source_document_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'rechazado' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: solo se reintegra un documento en estado ''rechazado'' (esta en ''%'')', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  -- BLOQUEO EXPLICITO (D-079, alcance acordado): si el documento ya genero un
  -- asiento de causacion —aunque haya quedado anulado tras el rechazo—, su
  -- clave de idempotencia (`causacion:<doc>`) sigue ocupada y `causarFactura`
  -- volveria a fallar con un 23505 crudo al reinsertar el borrador. Reintegrar
  -- ese caso exige liberar/renombrar esa clave y una transicion de estado en
  -- el motor de A3 que todavia no existe. Se corta aqui con un mensaje claro.
  v_idem_key := 'causacion:' || p_source_document_id::text;
  SELECT id INTO v_conflicto
    FROM journal_entry
   WHERE company_id = app.current_company_id()
     AND idempotency_key = v_idem_key
   LIMIT 1;

  IF v_conflicto IS NOT NULL THEN
    RAISE EXCEPTION
      'REPROCESO_BLOQUEADO: este documento ya genero un asiento contable (%, anulado tras el rechazo). '
      'Reintegrarlo a la cola exige liberar la clave de idempotencia de ese asiento y una transicion '
      'de estado en el motor de causacion que aun no esta implementada (pendiente, ver D-079). '
      'HOY NO HAY CAMINO para recausarlo: volver a cargar el mismo XML no sirve, la ingesta lo '
      'reconoce como duplicado de este mismo documento (dedupe por CUFE/hash) y no lo vuelve a '
      'causar. Verificado por A14 en la compuerta de D-079.', v_conflicto
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Sin asiento en conflicto: se devuelve al pipeline. 'parseado' es uno de
  -- los dos estados que `causarFactura` acepta como entrada (el otro es
  -- 'recibido').
  UPDATE source_document
     SET estado = 'parseado', motivo_rechazo = NULL
   WHERE id = p_source_document_id;

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_anterior, valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
          'UPDATE', 'source_document', p_source_document_id::text,
          jsonb_build_object('estado', 'rechazado'),
          jsonb_build_object('estado', 'parseado', 'accion', 'reintegrado a la cola de causacion'),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id());
END $$;

COMMENT ON FUNCTION app.reintegrar_documento_rechazado(uuid) IS
  'D-079: devuelve un documento rechazado a la cola de causacion, SOLO si no dejo un asiento que colisione con la clave de idempotencia. Si lo dejo, bloquea con REPROCESO_BLOQUEADO. Exige documento.reprocesar.';

GRANT EXECUTE ON FUNCTION app.reintegrar_documento_rechazado(uuid) TO app_user;

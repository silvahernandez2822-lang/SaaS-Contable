-- =============================================================================
-- 090_a13_sesion_sistema_integraciones.sql — Agente A13, Ola 2 (rango 090-099)
--
-- CIERRA V-9 (sesión de sistema para el canal de correo) EXTENDIENDO el
-- modelo de A12, sin rodearlo:
--
--   * NO se toca `app.abrir_sesion`, `app.session_context`, ni ninguna de las
--     tres funciones de contexto (`current_tenant_id`/`current_company_id`/
--     `current_user_id`) de la migración 015. El tenant sigue derivándose
--     EXCLUSIVAMENTE de una fila real en `app.session_context`, emitida por
--     `app.abrir_sesion`, que a su vez sigue derivando el tenant de
--     `app.usuario` (D-021). Jamás se fija `app.tenant_id` a mano: ese es
--     exactamente el agujero D-020 que A12 cerró.
--   * Lo que faltaba no era una forma nueva de fijar el contexto: era una
--     forma de decidir, ANTES de que exista sesión, qué `user_id` le
--     corresponde a una llamada de máquina (un correo entrante no tiene
--     humano detrás que teclee una contraseña). Esta migración resuelve
--     exactamente eso y nada más: añade un segundo camino de autenticación
--     de primer factor -un token de integración, no una contraseña- que
--     termina en el MISMO `app.abrir_sesion` que ya usa el login humano.
--     Mismo patrón que D-023 (dos roles, dos formas de probar identidad, una
--     sola forma de abrir sesión).
--
-- EL USUARIO DE SISTEMA: una fila real en "user" por firma (rol de negocio
-- `sistema_ingesta`, nuevo, con el privilegio MINIMO que el canal de correo
-- necesita: documento.leer + documento.cargar. Ni causacion.*, ni
-- parametro.*, ni asiento.* -si alguien roba el token de integración de una
-- firma, con él no puede aprobar nada, publicar nada, ni tocar un parámetro
-- tributario). Sin contraseña (`password_hash` queda NULL): el camino de
-- login humano (`iniciarSesion`, `app.buscar_credencial`) lo rechaza limpio
-- con `sin_credencial` si alguien lo intentara ahí.
--
-- V-1, SIN EMPEORARLO: esta migración NO toca el GRANT de
-- `app.resolver_empresa_por_buzon` (eso sigue asignado a A12+A4, D-042). Lo
-- que hace `src/integraciones/ingest-correo.ts` es simplemente NO USAR esa
-- función en el camino nuevo: una vez que el token de integración ya
-- resolvió el tenant (autenticación real, no un buzón supuestamente
-- secreto), resolver a qué EMPRESA de esa firma pertenece el buzón es un
-- `SELECT` normal contra `company`, que ya tiene RLS de tenant estricto
-- (`instalar_rls_tenant`, 012_rls.sql) - la sesión de sistema, una vez
-- abierta, ve exactamente las empresas de SU firma y ninguna otra, sin
-- necesitar ninguna función SECURITY DEFINER nueva. La autenticación por
-- alcance de tenant nunca depende de que el buzón sea secreto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. `audit_log.accion` es una lista cerrada (009_control.sql). Se amplía con
--    los dos eventos nuevos del ciclo de vida de un token de integración —
--    mismo criterio que el resto de la lista (un verbo, no un detalle: el
--    detalle va en `valor_nuevo`, nunca en el nombre de la acción).
-- -----------------------------------------------------------------------------
ALTER TABLE audit_log DROP CONSTRAINT audit_log_accion_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_accion_check
  CHECK (accion IN (
    'INSERT','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT','ACCESO_DENEGADO',
    'APROBACION','PUBLICACION','REVERSA',
    'TOKEN_INTEGRACION_EMITIDO','TOKEN_INTEGRACION_REVOCADO'
  ));

-- -----------------------------------------------------------------------------
-- 1. Rol de negocio `sistema_ingesta` - alcance mínimo, igual para toda firma.
-- -----------------------------------------------------------------------------
INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema) VALUES
  ('00000000-0000-0000-0000-0000000000a6', NULL, 'sistema_ingesta',
   'Sistema - ingesta de correo',
   'Cuenta técnica sin humano detrás, usada por el canal de correo (A13). Solo puede cargar y leer documentos: nunca aprueba, nunca publica, nunca edita parámetros ni terceros.',
   true);

INSERT INTO role_permission (role_id, permission_codigo)
SELECT '00000000-0000-0000-0000-0000000000a6', codigo FROM permission
 WHERE codigo IN ('documento.leer', 'documento.cargar');

-- -----------------------------------------------------------------------------
-- 2. app.integration_credential - espejo de seguridad, mismo patrón que
--    `app.session_context` (015): esquema `app`, SIN RLS y SIN GRANTs para
--    ningún rol de aplicación. Solo se lee o se escribe a través de las
--    funciones SECURITY DEFINER de abajo. Guarda sha256(token), nunca el
--    token - mismo cálculo que `app.hash_token` (015), ninguna criptografía
--    nueva: un token de integración es, igual que un token de sesión, un
--    secreto de alta entropía generado por el servidor, no una contraseña de
--    humano, así que aplica el mismo razonamiento de D-021 (no hace falta
--    KDF lenta para comparar dos secretos aleatorios de 256 bits).
-- -----------------------------------------------------------------------------
CREATE TABLE app.integration_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  user_id        uuid NOT NULL,
  canal          text NOT NULL CHECK (canal IN ('correo')),
  nombre         text NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid,
  ultimo_uso_en  timestamptz,
  revocado_en    timestamptz
);

-- A lo sumo un token VIVO por (firma, canal): crear uno nuevo retira el
-- anterior (rotación simple, sin acumular secretos vivos que nadie recuerda
-- si siguen en uso).
CREATE UNIQUE INDEX integration_credential_activo_uq
  ON app.integration_credential (tenant_id, canal) WHERE revocado_en IS NULL;

CREATE INDEX integration_credential_user_idx ON app.integration_credential (user_id);

COMMENT ON TABLE app.integration_credential IS
  'Credenciales de máquina para canales de integración (hoy: correo). Autoridad de un segundo camino de primer factor hacia el MISMO app.abrir_sesion que usa el login humano (D-021, D-023). Sin RLS, sin GRANTs: el aislamiento aquí es por privilegio, igual que app.session_context.';

REVOKE ALL ON app.integration_credential FROM app_user, app_auth;

-- -----------------------------------------------------------------------------
-- 3. Emitir un token - lo invoca una sesión de administración YA autenticada
--    (un humano con `usuario.administrar`), nunca un correo entrante. Mismo
--    patrón ya auditado de D-023/D-042: SECURITY DEFINER + filtro EXPLÍCITO
--    por `app.current_tenant_id()`, nunca por un tenant que el llamador pase
--    como parámetro (si aceptara un tenant_id de parámetro, D-020 se
--    reabriría por la puerta de al lado).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.crear_token_integracion(
  p_user_id uuid,
  p_canal   text,
  p_nombre  text,
  p_token   text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_tenant          uuid;
  v_tenant_usuario  uuid;
  v_id              uuid;
BEGIN
  PERFORM app.exigir_permiso('usuario.administrar');

  v_tenant := app.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay una sesión de firma para emitir un token de integración'
      USING ERRCODE = 'SE001';
  END IF;

  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'INTEGRACION_TOKEN_INVALIDO: el token debe tener al menos 32 caracteres de entropía; lo emite el servidor, no el cliente'
      USING ERRCODE = 'IG001';
  END IF;

  SELECT u.tenant_id INTO v_tenant_usuario FROM app.usuario u WHERE u.user_id = p_user_id;
  IF v_tenant_usuario IS NULL OR v_tenant_usuario <> v_tenant THEN
    RAISE EXCEPTION 'INTEGRACION_USUARIO_AJENO: el usuario de sistema no pertenece a la firma en sesión'
      USING ERRCODE = 'IG003';
  END IF;

  -- Rotación: retira el token vivo anterior de este canal, si lo había.
  UPDATE app.integration_credential
     SET revocado_en = now()
   WHERE tenant_id = v_tenant AND canal = p_canal AND revocado_en IS NULL;

  v_id := gen_random_uuid();
  INSERT INTO app.integration_credential
         (id, tenant_id, user_id, canal, nombre, token_hash, creado_por)
  VALUES (v_id, v_tenant, p_user_id, p_canal, p_nombre, app.hash_token(p_token), app.current_user_id());

  INSERT INTO audit_log (tenant_id, user_id, accion, entidad, entidad_id, valor_nuevo, request_id)
  VALUES (v_tenant, app.current_user_id(), 'TOKEN_INTEGRACION_EMITIDO', 'integration_credential', v_id::text,
          jsonb_build_object('canal', p_canal, 'nombre', p_nombre), app.current_request_id());

  RETURN v_id;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Revocar un token - respuesta a incidente (token filtrado, canal que se
--    da de baja). Idempotente: revocar dos veces no es un error.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.revocar_token_integracion(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_n      integer;
BEGIN
  PERFORM app.exigir_permiso('usuario.administrar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA' USING ERRCODE = 'SE001';
  END IF;

  UPDATE app.integration_credential
     SET revocado_en = now()
   WHERE id = p_id AND tenant_id = v_tenant AND revocado_en IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO audit_log (tenant_id, user_id, accion, entidad, entidad_id, request_id)
    VALUES (v_tenant, app.current_user_id(), 'TOKEN_INTEGRACION_REVOCADO', 'integration_credential', p_id::text,
            app.current_request_id());
  END IF;

  RETURN v_n > 0;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Listar tokens de la firma en sesión - nunca devuelve el secreto (ya no
--    existe en claro en ningún lado desde que se emitió: mismo criterio que
--    session_context).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.listar_tokens_integracion()
  RETURNS TABLE(id uuid, canal text, nombre text, creado_en timestamptz,
                ultimo_uso_en timestamptz, revocado_en timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  PERFORM app.exigir_permiso('usuario.administrar');
  RETURN QUERY
    SELECT c.id, c.canal, c.nombre, c.creado_en, c.ultimo_uso_en, c.revocado_en
      FROM app.integration_credential c
     WHERE c.tenant_id = app.current_tenant_id()
     ORDER BY c.creado_en DESC;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Autenticar un token de integración - el análogo de
--    `app.buscar_credencial` para el canal de correo. Exclusivo de
--    `app_auth`, igual que el login humano: `app_user` nunca puede
--    autenticar nada, solo operar ya autenticado (D-023).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.autenticar_token_integracion(p_token text)
  RETURNS TABLE(user_id uuid, tenant_id uuid, canal text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_hash text := app.hash_token(p_token);
  v_cred app.integration_credential;
  v_estado text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN;
  END IF;

  SELECT c.* INTO v_cred FROM app.integration_credential c
   WHERE c.token_hash = v_hash AND c.revocado_en IS NULL;
  IF v_cred.id IS NULL THEN
    RETURN;
  END IF;

  SELECT u.estado INTO v_estado FROM app.usuario u WHERE u.user_id = v_cred.user_id;
  IF v_estado IS NULL OR v_estado <> 'activo' THEN
    RETURN;
  END IF;

  UPDATE app.integration_credential SET ultimo_uso_en = now() WHERE id = v_cred.id;

  RETURN QUERY SELECT v_cred.user_id, v_cred.tenant_id, v_cred.canal;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Privilegios: emitir/revocar/listar tokens es de una sesión normal ya
--    autenticada (app_user); autenticar un token es exclusivo de app_auth,
--    exactamente como abrir_sesion/buscar_credencial.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.crear_token_integracion(uuid, text, text, text) FROM PUBLIC, app_auth;
REVOKE ALL ON FUNCTION app.revocar_token_integracion(uuid)                FROM PUBLIC, app_auth;
REVOKE ALL ON FUNCTION app.listar_tokens_integracion()                    FROM PUBLIC, app_auth;
REVOKE ALL ON FUNCTION app.autenticar_token_integracion(text)             FROM PUBLIC, app_user;

GRANT EXECUTE ON FUNCTION app.crear_token_integracion(uuid, text, text, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.revocar_token_integracion(uuid)                TO app_user;
GRANT EXECUTE ON FUNCTION app.listar_tokens_integracion()                    TO app_user;
GRANT EXECUTE ON FUNCTION app.autenticar_token_integracion(text)             TO app_auth;

-- =============================================================================
-- 8. email_ingest_log - la restricción original (A4, 030) exige
--    `(tenant_id IS NULL) = (company_id IS NULL)`, porque en el modelo de A4
--    el tenant se aprendía DEL buzón, así que "buzón no reconocido" y
--    "tenant desconocido" eran el mismo hecho. Con la sesión de sistema
--    (arriba), el tenant se conoce SIEMPRE antes de mirar el buzón -lo dio el
--    token, no la dirección de correo-, así que aparece un caso nuevo y
--    legítimo que la restricción original no admitía: tenant conocido,
--    buzón que no corresponde a NINGUNA empresa de esa firma. Se afloja la
--    restricción para permitirlo (tenant conocido + empresa NULL), sin tocar
--    el caso original (los dos NULL, para una llamada que ni siquiera pasó
--    la autenticación) ni la política RLS de 030 (ya cubre `company_id IS
--    NULL` con `tenant_id = current_tenant_id()`, sin cambios).
-- -----------------------------------------------------------------------------
ALTER TABLE email_ingest_log DROP CONSTRAINT email_ingest_log_scope_ck;
ALTER TABLE email_ingest_log ADD CONSTRAINT email_ingest_log_scope_ck
  CHECK (company_id IS NULL OR tenant_id IS NOT NULL);

COMMENT ON CONSTRAINT email_ingest_log_scope_ck ON email_ingest_log IS
  'tenant_id NULL exige company_id NULL (llamada que no superó la autenticación de integración, A13 091). tenant_id conocido admite company_id NULL (buzón que no corresponde a ninguna empresa de esa firma) o company_id de esa misma firma.';

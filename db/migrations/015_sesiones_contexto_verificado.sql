-- =============================================================================
-- 015_sesiones_contexto_verificado.sql — Agente A12, Ola 0
--
-- CIERRE DE D-020.
--
-- Lo que dejó A2: el contexto de aislamiento iba en `app.tenant_id` /
-- `app.company_id`, GUCs personalizadas que CUALQUIER rol puede fijar con
-- `set_config`. Es decir: el aislamiento de la Regla de Oro 7 dependía de que
-- la aplicación se portara bien, que es exactamente lo que la Regla 7 prohíbe.
--
-- Lo que hace esta migración: el contexto deja de ser un parámetro que la
-- sesión elige y pasa a DERIVARSE de un token de sesión que la base verifica.
--
--   1. El token lo emite el servidor al autenticar (32 bytes aleatorios).
--      De él solo se guarda `sha256(token)`; el token en claro no se almacena.
--   2. La sesión SQL presenta el token en `app.session_token`.
--   3. `app.current_tenant_id()` ya NO lee `app.tenant_id`: busca el hash del
--      token presentado en `app.session_context` y devuelve el tenant de ESA
--      fila, si la sesión no está revocada ni vencida.
--   4. `app.session_context` vive en el esquema `app`, SIN privilegios para
--      `app_user`. Un rol de aplicación no puede leerla, escribirla ni
--      fabricar una fila. No puede invertir el sha256 para forjar un token.
--
-- Consecuencia: fijar `app.tenant_id` a mano se volvió inerte. Las políticas
-- RLS de 012 no se tocaron ni una línea; siguen llamando a las mismas tres
-- funciones, pero ahora esas funciones responden a un secreto que el rol de
-- aplicación no posee.
--
-- POR QUÉ EL ESQUEMA `app` Y NO `public.user_session`:
-- una función que resuelve el contexto NO puede leer una tabla cuya política
-- RLS llama a esa misma función. En PGlite no revienta porque el dueño de las
-- tablas es superusuario y se salta la RLS, pero en un Postgres gestionado el
-- dueño no es superusuario y `FORCE ROW LEVEL SECURITY` sí lo alcanza. Una
-- tabla del esquema `app`, sin RLS y sin GRANTs, se comporta idéntico en los
-- dos entornos: el aislamiento ahí es por privilegio, no por política.
-- `public.user_session` (de A2) se conserva como registro visible para la
-- firma; la autoridad de seguridad es `app.session_context`.
--
-- DOS ROLES DE BASE DE DATOS (ver D-023):
--   app_user  rol de las peticiones ya autenticadas. NO puede emitir sesiones
--             ni leer credenciales.
--   app_auth  rol exclusivo del endpoint de autenticación. Puede leer la
--             credencial de UN correo concreto y emitir sesiones, y no tiene
--             GRANT sobre ninguna tabla de negocio.
--
-- CÓDIGOS DE ERROR PROPIOS AÑADIDOS:
--   SE001  SESION_INVALIDA          token ausente, vencido, revocado o de un usuario inactivo
--   SE002  PERMISO_INSUFICIENTE     el rol de la sesión no tiene el permiso exigido
--   SE003  EMPRESA_NO_AUTORIZADA    la sesión pidió una empresa sobre la que no tiene acceso
--   SE004  MFA_REQUERIDO            el usuario exige segundo factor y la sesión no lo superó
--   SE005  CREDENCIAL_INVALIDA      usuario, contraseña o bloqueo por intentos fallidos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rol exclusivo del camino de autenticación.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_auth;
GRANT USAGE ON SCHEMA app    TO app_auth;

-- -----------------------------------------------------------------------------
-- Credenciales y control de intentos en `"user"`.
-- A2 dejó `password_hash`, `mfa_habilitado` y `mfa_secret_cifrado` como espacio
-- reservado; aquí se completan las columnas que exige el flujo real.
-- -----------------------------------------------------------------------------
ALTER TABLE "user"
  ADD COLUMN password_algoritmo  text,
  ADD COLUMN intentos_fallidos   integer NOT NULL DEFAULT 0
               CHECK (intentos_fallidos >= 0),
  ADD COLUMN bloqueado_hasta     timestamptz,
  ADD COLUMN mfa_confirmado_en   timestamptz,
  ADD COLUMN mfa_secret_alg      text;

COMMENT ON COLUMN "user".password_hash IS
  'Derivación de clave, no hash plano. Formato autodescriptivo: scrypt$N=...,r=...,p=...$<salt b64url>$<clave b64url> (src/auth/password.ts). Nunca SHA/MD5 desnudo.';
COMMENT ON COLUMN "user".mfa_secret_cifrado IS
  'Secreto TOTP envuelto en AES-256-GCM con clave de aplicación (src/auth/cifrado.ts). Un volcado de la base no basta para clonar el segundo factor.';
COMMENT ON COLUMN "user".bloqueado_hasta IS
  'Bloqueo temporal por intentos fallidos consecutivos. Lo fija app.registrar_login_fallido().';

-- =============================================================================
-- ESPEJOS DE SEGURIDAD EN EL ESQUEMA `app`
--
-- Son proyecciones mínimas de `"user"` y `user_company_access`, mantenidas por
-- triggers. Existen porque el resolutor de contexto no puede leer una tabla
-- protegida por una política que depende del propio resolutor. Nunca son la
-- fuente de verdad del negocio: son la fuente de verdad de la SEGURIDAD.
-- =============================================================================

CREATE TABLE app.usuario (
  user_id    uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  estado     text NOT NULL,
  espejado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.usuario IS
  'Espejo de identidad de "user" (id, tenant, estado). Sin RLS y sin GRANTs: el aislamiento aquí es por privilegio. Lo mantiene un trigger.';

CREATE TABLE app.acceso_usuario_empresa (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  user_id      uuid NOT NULL,
  role_id      uuid NOT NULL,
  revocado_en  timestamptz,
  espejado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX acceso_usuario_empresa_idx
  ON app.acceso_usuario_empresa (user_id, tenant_id, company_id)
  WHERE revocado_en IS NULL;

COMMENT ON TABLE app.acceso_usuario_empresa IS
  'Espejo de user_company_access. Responde "¿esta sesión puede actuar sobre esta empresa?" sin leer una tabla con RLS que dependa del resolutor.';

CREATE TABLE app.session_context (
  id            uuid PRIMARY KEY,
  token_hash    text NOT NULL UNIQUE,
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  emitida_en    timestamptz NOT NULL DEFAULT now(),
  expira_en     timestamptz NOT NULL,
  revocada_en   timestamptz,
  mfa_superado  boolean NOT NULL DEFAULT false,
  ip            inet,
  user_agent    text
);

CREATE INDEX session_context_user_idx ON app.session_context (user_id);

COMMENT ON TABLE app.session_context IS
  'Autoridad del contexto de aislamiento (cierra D-020). Guarda sha256(token), nunca el token. app_user no tiene ningún privilegio sobre ella.';

-- Ni un GRANT para los roles de aplicación sobre las tablas del esquema `app`.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM app_user, app_auth;

-- =============================================================================
-- HASH DEL TOKEN
--
-- sha256() es función del núcleo de PostgreSQL (11+), no de pgcrypto.
-- Verificado en PGlite 0.5.7 / PostgreSQL 18.3: pgcrypto NO está disponible
-- (`function digest(...) does not exist`), así que toda criptografía de
-- contraseña y de TOTP vive en Node (node:crypto) y la base solo compara
-- hashes. STRICT: token nulo produce hash nulo y por tanto ninguna coincidencia.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.hash_token(p_token text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT encode(sha256(convert_to(p_token, 'utf8')), 'hex') $$;

CREATE OR REPLACE FUNCTION app.token_presentado() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.session_token', true), '') $$;

-- -----------------------------------------------------------------------------
-- La sesión vigente que corresponde al token presentado, o ninguna fila.
-- SECURITY DEFINER porque `app.session_context` no es legible por app_user.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.sesion_actual() RETURNS app.session_context
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT s.*
      FROM app.session_context s
     WHERE s.token_hash  = app.hash_token(app.token_presentado())
       AND s.revocada_en IS NULL
       AND s.expira_en   > now()
  $$;

-- =============================================================================
-- REDEFINICIÓN DE LAS TRES FUNCIONES DE CONTEXTO
--
-- Mismas firmas que en 001_fundacion.sql: las políticas RLS de 012 siguen
-- válidas sin tocarlas. Lo que cambia es de dónde sale la respuesta.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT (app.sesion_actual()).tenant_id $$;

COMMENT ON FUNCTION app.current_tenant_id() IS
  'Tenant DERIVADO del token de sesión verificado, no del parámetro app.tenant_id. Fijar app.tenant_id a mano es inerte (cierre de D-020).';

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT (app.sesion_actual()).user_id $$;

-- La empresa sí la PIDE el cliente (un usuario con 30 empresas elige una),
-- pero la AUTORIZA la base: solo devuelve la empresa pedida si la sesión
-- tiene acceso vigente a ella.
CREATE OR REPLACE FUNCTION app.current_company_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT a.company_id
      FROM app.session_context s
      JOIN app.acceso_usuario_empresa a
        ON a.user_id     = s.user_id
       AND a.tenant_id   = s.tenant_id
       AND a.revocado_en IS NULL
     WHERE s.token_hash  = app.hash_token(app.token_presentado())
       AND s.revocada_en IS NULL
       AND s.expira_en   > now()
       AND a.company_id  = NULLIF(current_setting('app.company_id', true), '')::uuid
     LIMIT 1
  $$;

COMMENT ON FUNCTION app.current_company_id() IS
  'El cliente PIDE la empresa en app.company_id; la base la AUTORIZA contra los accesos de la sesión. Sin acceso vigente devuelve NULL y la RLS no deja ver nada.';

CREATE OR REPLACE FUNCTION app.session_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT (app.sesion_actual()).id $$;

CREATE OR REPLACE FUNCTION app.session_mfa_superado() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE((app.sesion_actual()).mfa_superado, false) $$;

-- =============================================================================
-- MANTENIMIENTO DE LOS ESPEJOS
-- =============================================================================

CREATE OR REPLACE FUNCTION app.trg_espejo_usuario() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.usuario WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO app.usuario (user_id, tenant_id, estado)
       VALUES (NEW.id, NEW.tenant_id, NEW.estado)
  ON CONFLICT (user_id) DO UPDATE
     SET tenant_id = EXCLUDED.tenant_id,
         estado    = EXCLUDED.estado,
         espejado_en = now();

  -- Suspender o inactivar a un usuario corta sus sesiones vivas de inmediato.
  IF NEW.estado <> 'activo' THEN
    UPDATE app.session_context
       SET revocada_en = now()
     WHERE user_id = NEW.id AND revocada_en IS NULL;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER user_espejo_seguridad
  AFTER INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION app.trg_espejo_usuario();

CREATE OR REPLACE FUNCTION app.trg_espejo_acceso() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.acceso_usuario_empresa WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO app.acceso_usuario_empresa
         (id, tenant_id, company_id, user_id, role_id, revocado_en)
  VALUES (NEW.id, NEW.tenant_id, NEW.company_id, NEW.user_id, NEW.role_id, NEW.revocado_en)
  ON CONFLICT (id) DO UPDATE
     SET tenant_id   = EXCLUDED.tenant_id,
         company_id  = EXCLUDED.company_id,
         user_id     = EXCLUDED.user_id,
         role_id     = EXCLUDED.role_id,
         revocado_en = EXCLUDED.revocado_en,
         espejado_en = now();

  RETURN NEW;
END $$;

CREATE TRIGGER uca_espejo_seguridad
  AFTER INSERT OR UPDATE OR DELETE ON user_company_access
  FOR EACH ROW EXECUTE FUNCTION app.trg_espejo_acceso();

-- Relleno inicial. Se apaga la RLS un instante porque el dueño de las tablas no
-- es necesariamente superusuario en producción y `FORCE ROW LEVEL SECURITY`
-- también lo alcanza: sin esto el relleno copiaría cero filas EN SILENCIO.
-- `DISABLE` no borra la marca `FORCE`, que se vuelve a poner explícitamente.
ALTER TABLE "user"              DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_company_access DISABLE ROW LEVEL SECURITY;

INSERT INTO app.usuario (user_id, tenant_id, estado)
SELECT id, tenant_id, estado FROM "user"
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO app.acceso_usuario_empresa (id, tenant_id, company_id, user_id, role_id, revocado_en)
SELECT id, tenant_id, company_id, user_id, role_id, revocado_en FROM user_company_access
ON CONFLICT (id) DO NOTHING;

ALTER TABLE "user"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_company_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_company_access FORCE  ROW LEVEL SECURITY;

-- =============================================================================
-- CAMINO DE AUTENTICACIÓN
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Búsqueda de credencial. Es SECURITY INVOKER a propósito: corre con los
-- privilegios de `app_auth` y se apoya en una política acotada, para que la
-- prueba pueda verificar el control real y no el de un dueño superusuario.
--
-- La política deja ver UNA fila, la del correo exacto pedido, y solo mientras
-- no haya sesión establecida. Una sesión ya autenticada no puede usar este
-- camino para leer credenciales.
-- -----------------------------------------------------------------------------
CREATE POLICY user_login ON "user" FOR SELECT TO app_auth
  USING (
    app.current_tenant_id() IS NULL
    AND email = NULLIF(current_setting('app.login_email', true), '')
  );

GRANT SELECT ON "user" TO app_auth;

CREATE OR REPLACE FUNCTION app.buscar_credencial(p_email text)
RETURNS TABLE (
  user_id            uuid,
  tenant_id          uuid,
  email              text,
  estado             text,
  password_hash      text,
  password_algoritmo text,
  mfa_habilitado     boolean,
  mfa_secret_cifrado text,
  mfa_secret_alg     text,
  intentos_fallidos  integer,
  bloqueado_hasta    timestamptz
) LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  PERFORM set_config('app.login_email', lower(p_email), true);
  RETURN QUERY
    SELECT u.id, u.tenant_id, u.email, u.estado, u.password_hash, u.password_algoritmo,
           u.mfa_habilitado, u.mfa_secret_cifrado, u.mfa_secret_alg,
           u.intentos_fallidos, u.bloqueado_hasta
      FROM "user" u
     WHERE u.email = lower(p_email);
END $$;

-- -----------------------------------------------------------------------------
-- Emisión de sesión. SECURITY DEFINER porque escribe en `app.session_context`.
--
-- Valida el usuario contra el espejo `app.usuario`, NO contra un tenant que le
-- pase el llamador: si confiara en un tenant recibido como parámetro, D-020
-- volvería a abrirse por la puerta de al lado.
--
-- Fija `app.session_token` en la transacción en curso, de modo que las
-- escrituras siguientes (espejo visible y registro de auditoría) ya pasan por
-- las políticas RLS normales, con el contexto recién derivado. Verificado en
-- PGlite: `set_config(..., true)` dentro de SECURITY DEFINER persiste en la
-- transacción del llamador.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.abrir_sesion(
  p_user_id      uuid,
  p_token        text,
  p_ip           inet    DEFAULT NULL,
  p_user_agent   text    DEFAULT NULL,
  p_mfa_superado boolean DEFAULT false,
  p_minutos      integer DEFAULT 480
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_tenant uuid;
  v_estado text;
  v_id     uuid;
  v_expira timestamptz;
  v_hash   text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION
      'SESION_INVALIDA: el token de sesión debe tener al menos 32 caracteres de entropía; lo emite el servidor, no el cliente'
      USING ERRCODE = 'SE001';
  END IF;
  IF p_minutos IS NULL OR p_minutos <= 0 OR p_minutos > 1440 THEN
    RAISE EXCEPTION
      'SESION_INVALIDA: la vigencia de una sesión está entre 1 y 1440 minutos (recibido: %)', p_minutos
      USING ERRCODE = 'SE001';
  END IF;

  SELECT u.tenant_id, u.estado INTO v_tenant, v_estado
    FROM app.usuario u WHERE u.user_id = p_user_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: el usuario % no existe', p_user_id
      USING ERRCODE = 'SE001';
  END IF;
  IF v_estado <> 'activo' THEN
    RAISE EXCEPTION 'SESION_INVALIDA: el usuario % está en estado "%" y no puede abrir sesión', p_user_id, v_estado
      USING ERRCODE = 'SE001';
  END IF;

  v_id     := gen_random_uuid();
  v_hash   := app.hash_token(p_token);
  v_expira := now() + make_interval(mins => p_minutos);

  INSERT INTO app.session_context
         (id, token_hash, tenant_id, user_id, expira_en, mfa_superado, ip, user_agent)
  VALUES (v_id, v_hash, v_tenant, p_user_id, v_expira, p_mfa_superado, p_ip, p_user_agent);

  -- A partir de aquí el contexto ya está derivado del token recién emitido.
  PERFORM set_config('app.session_token', p_token, true);

  INSERT INTO user_session
         (id, tenant_id, user_id, token_hash, expira_en, mfa_superado, ip, user_agent)
  VALUES (v_id, v_tenant, p_user_id, v_hash, v_expira, p_mfa_superado, p_ip, p_user_agent);

  INSERT INTO audit_log (tenant_id, user_id, accion, entidad, entidad_id, ip, user_agent, request_id)
  VALUES (v_tenant, p_user_id, 'LOGIN', 'user_session', v_id::text, p_ip, p_user_agent,
          app.current_request_id());

  UPDATE "user"
     SET ultimo_acceso_en  = now(),
         intentos_fallidos = 0,
         bloqueado_hasta   = NULL
   WHERE id = p_user_id;

  RETURN v_id;
END $$;

-- -----------------------------------------------------------------------------
-- Cierre de sesión. El orden importa: primero se escribe el espejo visible y la
-- auditoría (mientras el contexto todavía resuelve), y solo al final se revoca
-- la autoridad. Al revés, la RLS dejaría el registro sin escribir en silencio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.cerrar_sesion(p_token text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_ses app.session_context;
BEGIN
  SELECT s.* INTO v_ses FROM app.session_context s
   WHERE s.token_hash = app.hash_token(p_token) AND s.revocada_en IS NULL;

  IF v_ses.id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.session_token', p_token, true);

  UPDATE user_session SET revocada_en = now() WHERE id = v_ses.id AND revocada_en IS NULL;

  INSERT INTO audit_log (tenant_id, user_id, accion, entidad, entidad_id, ip, user_agent, request_id)
  VALUES (v_ses.tenant_id, v_ses.user_id, 'LOGOUT', 'user_session', v_ses.id::text,
          app.current_ip(), NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id());

  UPDATE app.session_context SET revocada_en = now() WHERE id = v_ses.id;
  PERFORM set_config('app.session_token', '', true);
  RETURN true;
END $$;

-- Revocación masiva: cambio de contraseña, baja del usuario, sospecha de robo.
CREATE OR REPLACE FUNCTION app.revocar_sesiones_de_usuario(p_user_id uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE app.session_context SET revocada_en = now()
   WHERE user_id = p_user_id AND revocada_en IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE user_session SET revocada_en = now()
   WHERE user_id = p_user_id AND revocada_en IS NULL;

  RETURN v_n;
END $$;

-- -----------------------------------------------------------------------------
-- Intento de acceso fallido. Se registra SIEMPRE, exista o no el usuario: un
-- audit_log que solo anota los intentos contra usuarios reales oculta
-- justamente la enumeración de correos.
--
-- Corre como `app_auth` (SECURITY INVOKER) y se apoya en una política acotada
-- de audit_log, para que la prueba verifique el control y no el privilegio del
-- dueño. Se bloquea al quinto intento consecutivo, por 15 minutos.
-- -----------------------------------------------------------------------------
CREATE POLICY audit_log_evento_autenticacion ON audit_log FOR INSERT TO app_auth
  WITH CHECK (
    accion IN ('LOGIN', 'LOGOUT', 'ACCESO_DENEGADO')
    AND company_id IS NULL
    AND app.current_tenant_id() IS NULL
  );

GRANT INSERT ON audit_log TO app_auth;

CREATE OR REPLACE FUNCTION app.registrar_login_fallido(
  p_email      text,
  p_tenant_id  uuid,
  p_user_id    uuid,
  p_motivo     text,
  p_ip         inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  INSERT INTO audit_log (tenant_id, user_id, accion, entidad, entidad_id,
                         valor_nuevo, ip, user_agent, request_id)
  VALUES (p_tenant_id, p_user_id, 'ACCESO_DENEGADO', 'autenticacion', lower(p_email),
          jsonb_build_object('motivo', p_motivo, 'email', lower(p_email)),
          p_ip, p_user_agent, app.current_request_id());

  IF p_user_id IS NOT NULL THEN
    PERFORM app.contar_intento_fallido(p_user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.contar_intento_fallido(p_user_id uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE "user"
     SET intentos_fallidos = intentos_fallidos + 1,
         bloqueado_hasta   = CASE WHEN intentos_fallidos + 1 >= 5
                                  THEN now() + interval '15 minutes'
                                  ELSE bloqueado_hasta END
   WHERE id = p_user_id
   RETURNING intentos_fallidos INTO v_n;
  RETURN COALESCE(v_n, 0);
END $$;

-- El UPDATE anterior corre como dueño y la RLS de `"user"` exige tenant en
-- contexto, que en el camino previo a la sesión no existe. Una política acotada
-- al propio dueño permite exactamente esa escritura y nada más.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY user_contador_intentos ON public."user" FOR UPDATE TO %I USING (true) WITH CHECK (true)',
    current_user);
END $$;

-- =============================================================================
-- PRIVILEGIOS: quién puede llamar a qué
-- =============================================================================

-- Emitir sesiones y leer credenciales es exclusivo del rol de autenticación.
REVOKE ALL ON FUNCTION app.abrir_sesion(uuid, text, inet, text, boolean, integer) FROM PUBLIC, app_user;
REVOKE ALL ON FUNCTION app.buscar_credencial(text)                                FROM PUBLIC, app_user;
REVOKE ALL ON FUNCTION app.registrar_login_fallido(text, uuid, uuid, text, inet, text) FROM PUBLIC, app_user;
REVOKE ALL ON FUNCTION app.contar_intento_fallido(uuid)                           FROM PUBLIC, app_user;

GRANT EXECUTE ON FUNCTION app.abrir_sesion(uuid, text, inet, text, boolean, integer) TO app_auth;
GRANT EXECUTE ON FUNCTION app.buscar_credencial(text)                                TO app_auth;
GRANT EXECUTE ON FUNCTION app.registrar_login_fallido(text, uuid, uuid, text, inet, text) TO app_auth;
GRANT EXECUTE ON FUNCTION app.contar_intento_fallido(uuid)                           TO app_auth;

-- Los espejos no se tocan a mano desde ninguna aplicación.
REVOKE ALL ON FUNCTION app.trg_espejo_usuario() FROM PUBLIC, app_user, app_auth;
REVOKE ALL ON FUNCTION app.trg_espejo_acceso()  FROM PUBLIC, app_user, app_auth;

-- Cerrar la propia sesión sí lo hace el rol de la petición.
GRANT EXECUTE ON FUNCTION app.cerrar_sesion(text)                 TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.revocar_sesiones_de_usuario(uuid)   TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.sesion_actual()                     TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.hash_token(text)                    TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.token_presentado()                  TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.session_id()                        TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.session_mfa_superado()              TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.current_tenant_id()                 TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.current_company_id()                TO app_user, app_auth;
GRANT EXECUTE ON FUNCTION app.current_user_id()                   TO app_user, app_auth;

-- `app_auth` no toca datos de negocio: su único alcance es autenticar.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_auth;
GRANT SELECT ON "user"    TO app_auth;
GRANT INSERT ON audit_log TO app_auth;

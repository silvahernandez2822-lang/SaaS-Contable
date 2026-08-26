-- =============================================================================
-- 017_a14_cierre_vulnerabilidades.sql — Agente A14 (QA adversarial), Ola 0
--
-- Esta migración NO añade funcionalidad. Cierra dos rutas de evasión que
-- encontró la revisión adversarial de la compuerta de la Ola 0 y que ni A2 ni
-- A12 habían considerado. Ambas están verificadas empíricamente contra el motor
-- antes y después de este archivo, en `tests/adversarial/`.
--
-- -----------------------------------------------------------------------------
-- D-030 — `app.revocar_sesiones_de_usuario` ignoraba el tenant por completo
-- -----------------------------------------------------------------------------
-- Tal como la dejó 015, la función es SECURITY DEFINER, tiene EXECUTE para
-- PUBLIC y recibe un `user_id` que NO contrasta contra el tenant de la sesión
-- en curso. Verificado: una sesión legítima de la firma A revoca todas las
-- sesiones vivas de un usuario de la firma B, y el entero que devuelve dice
-- CUÁNTAS tenía. Es decir, una escritura cross-tenant y un oráculo de actividad
-- ajena, concedidos por el motor. Eso es exactamente lo que la Regla de Oro 7
-- prohíbe: el aislamiento tiene que imponerlo la base, y aquí la base lo
-- regalaba a través de una función DEFINER sin autorización.
--
-- Regla nueva, en este orden:
--   1. Sin sesión  -> se permite. Es el camino administrativo (migraciones,
--      plataforma, rotación de credenciales) que corre con rol privilegiado y
--      cuya garantía es el privilegio, no el permiso de negocio. Es el mismo
--      escape deliberado de D-025.
--   2. Con sesión, sobre uno mismo -> se permite siempre. Cerrar las propias
--      sesiones no es administrar a nadie.
--   3. Con sesión, sobre otro usuario del MISMO tenant -> exige
--      `usuario.administrar` (SE002).
--   4. Cualquier otro caso -> SE003, con el MISMO mensaje tanto si el usuario
--      no existe como si pertenece a otra firma. Distinguirlos reabriría el
--      oráculo por la puerta del código de error.
--
-- -----------------------------------------------------------------------------
-- D-031 — `app_auth` podía fabricar auditoría dentro de cualquier firma
-- -----------------------------------------------------------------------------
-- La política `audit_log_evento_autenticacion` de 015 acota `accion` y exige
-- `company_id IS NULL`, pero deja `tenant_id`, `user_id`, `entidad` y
-- `valor_nuevo` a discreción del insertador. Verificado: el rol `app_auth`
-- escribe un registro arbitrario dentro del audit_log de una firma cualquiera.
-- Como el audit_log es append-only (AU001), nadie puede limpiarlo después: la
-- contaminación es permanente y cae justo sobre la evidencia que el producto
-- vende como su diferenciador (Regla de Oro 6).
--
-- D-023 declara el riesgo residual de `app_auth` como "puede emitir una sesión
-- para cualquier usuario cuyo correo conozca". El alcance real era mayor: sin
-- conocer ningún correo, podía escribir en el rastro de auditoría de cualquier
-- firma. Esta migración lo reduce a lo que el camino de autenticación necesita
-- de verdad: la pareja (tenant_id, user_id) tiene que ser coherente contra el
-- espejo de identidad, o ir enteramente en NULL (el intento contra un correo
-- que no existe, que debe seguir registrándose para no ocultar la enumeración).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ¿Este usuario es de esta firma? Contra el espejo de identidad, no contra
-- `"user"`: el espejo es la fuente de verdad de la seguridad (D-026) y no
-- depende de una política RLS que a su vez dependa del resolutor de contexto.
--
-- SECURITY DEFINER porque `app.usuario` no es legible por ningún rol de
-- aplicación. Devuelve un booleano sobre una pareja que el llamador ya tuvo
-- que nombrar entera: no enumera nada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.usuario_pertenece(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.usuario u
       WHERE u.user_id = p_user_id AND u.tenant_id = p_tenant_id
    )
  $$;

COMMENT ON FUNCTION app.usuario_pertenece(uuid, uuid) IS
  'Coherencia (usuario, firma) contra el espejo app.usuario. La usa la política de audit_log del camino de autenticación (D-031).';

REVOKE ALL ON FUNCTION app.usuario_pertenece(uuid, uuid) FROM PUBLIC, app_user;
GRANT EXECUTE ON FUNCTION app.usuario_pertenece(uuid, uuid) TO app_auth;

-- =============================================================================
-- D-030 — revocación de sesiones con autorización
-- =============================================================================
CREATE OR REPLACE FUNCTION app.revocar_sesiones_de_usuario(p_user_id uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_n         integer;
  v_sesion    uuid;
  v_tenant    uuid;
  v_yo        uuid;
  v_mismo_ten boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no se indicó de qué usuario revocar las sesiones'
      USING ERRCODE = 'SE001';
  END IF;

  v_sesion := app.session_id();

  -- (1) Camino administrativo: sin sesión manda el privilegio, no el permiso.
  IF v_sesion IS NOT NULL THEN
    v_tenant := app.current_tenant_id();
    v_yo     := app.current_user_id();

    -- (2) Sobre uno mismo, siempre.
    IF p_user_id <> v_yo THEN
      v_mismo_ten := app.usuario_pertenece(p_user_id, v_tenant);

      -- (4) Otra firma, o un usuario que no existe: MISMA respuesta para los
      --     dos. Separarlas convertiría el SQLSTATE en un oráculo.
      IF NOT v_mismo_ten THEN
        RAISE EXCEPTION
          'EMPRESA_NO_AUTORIZADA: la sesión no puede revocar las sesiones del usuario %', p_user_id
          USING ERRCODE = 'SE003',
                HINT    = 'Solo se revocan las sesiones propias o las de un usuario de la misma firma, con el permiso usuario.administrar.';
      END IF;

      -- (3) Misma firma: es administración de usuarios.
      IF NOT app.tiene_permiso('usuario.administrar') THEN
        RAISE EXCEPTION
          'PERMISO_INSUFICIENTE: revocar las sesiones de otro usuario exige el permiso "usuario.administrar"'
          USING ERRCODE = 'SE002';
      END IF;
    END IF;
  END IF;

  UPDATE app.session_context SET revocada_en = now()
   WHERE user_id = p_user_id AND revocada_en IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE user_session SET revocada_en = now()
   WHERE user_id = p_user_id AND revocada_en IS NULL;

  RETURN v_n;
END $$;

COMMENT ON FUNCTION app.revocar_sesiones_de_usuario(uuid) IS
  'Revoca las sesiones vivas de un usuario. Sin sesión en contexto es el camino administrativo; con sesión exige que sea uno mismo, o un usuario de la misma firma con usuario.administrar (D-030).';

-- =============================================================================
-- D-031 — la auditoría que escribe el camino de autenticación va acotada
-- =============================================================================
DROP POLICY IF EXISTS audit_log_evento_autenticacion ON audit_log;

CREATE POLICY audit_log_evento_autenticacion ON audit_log FOR INSERT TO app_auth
  WITH CHECK (
    accion IN ('LOGIN', 'LOGOUT', 'ACCESO_DENEGADO')
    AND entidad IN ('autenticacion', 'user_session')
    AND company_id IS NULL
    AND app.current_tenant_id() IS NULL
    -- O el evento no señala a ninguna firma (intento contra un correo que no
    -- existe: se registra igual, si no el audit_log ocultaría la enumeración),
    -- o señala a una firma Y a un usuario REAL de esa misma firma.
    AND (
      tenant_id IS NULL
      OR (user_id IS NOT NULL AND app.usuario_pertenece(user_id, tenant_id))
    )
  );

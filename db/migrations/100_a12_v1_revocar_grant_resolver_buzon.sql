-- =============================================================================
-- 100_a12_v1_revocar_grant_resolver_buzon.sql — Agente A12, rango 100-109.
--
-- CIERRA V-1 (D-042): `app.resolver_empresa_por_buzon` deja de ser ejecutable
-- por la aplicación.
--
-- EL HALLAZGO, tal como lo MIDIÓ A14 (no como lo afirmó A4): la migración 032
-- concedió `EXECUTE` a `app_user` con el argumento de que la función "no cruza
-- firmas, porque no acepta ningún parámetro que identifique un tenant". El
-- argumento es falso: el parámetro que identifica al tenant es el buzón. Desde
-- una sesión ya abierta de la firma B, pasando el buzón de una empresa de la
-- firma A, la función devuelve el `company_id` y el `tenant_id` de A. No es una
-- fuga de datos —A14 midió cero filas legibles y cero escrituras (42501) con
-- esos identificadores en la mano, y por eso la severidad fue baja— pero sí es
-- un oráculo de identificadores ajenos que no le hace falta a nadie.
--
-- POR QUÉ SE PUEDE CERRAR AHORA, Y NO ANTES: cuando A14 lo levantó, el camino
-- de ingest de A4 llamaba a la función y quitarle el GRANT habría roto la
-- ingesta. Ese camino ya no está vivo. El canal de correo de hoy es
-- `src/integraciones/ingest-correo.ts` (A13, migración 090) y NO usa esta
-- función: el token de integración autentica primero al tenant, se abre sesión
-- real por `app.abrir_sesion`, y resolver qué empresa de esa firma es dueña del
-- buzón pasa a ser un `SELECT` corriente sobre `company`, cuya RLS de tenant ya
-- responde la pregunta. Es decir, la seguridad del canal dejó de depender de
-- que un buzón sea secreto, que es como debía haber sido desde el principio.
-- Verificado antes de escribir esta migración: en `src/` y `app/` el símbolo
-- `resolverEmpresaPorBuzon` solo aparece en su propia definición
-- (`src/ingest/persistencia.ts`) y en un re-export (`src/ingest/index.ts`).
-- Ningún llamador.
--
-- QUÉ SE HACE, Y POR QUÉ ESTO Y NO OTRA COSA (las tres opciones que D-042
-- dejaba abiertas):
--
--   (a) Borrar la función. Es la superficie mínima absoluta, pero rompe: el
--       helper de A4 en `persistencia.ts` pasaría a fallar con 42883 en vez de
--       con un 42501 explicable, y las pruebas de compuerta de A4
--       (`tests/gates/ingest.test.ts`), que la ejercitan como dueño, dejarían
--       de poder verificar el patrón `SECURITY DEFINER` que D-023 estableció.
--       Se descarta: rompe cosas para ganar poco.
--
--   (c) Concederla al rol de sistema `sistema_ingesta` de la migración 090.
--       NO ES IMPLEMENTABLE, y conviene dejarlo escrito para que nadie lo
--       reintente: `sistema_ingesta` es un rol de NEGOCIO (una fila en `role`,
--       resuelta por `app.tiene_permiso`), no un rol de PostgreSQL. En el motor
--       solo existen `app_user` y `app_auth`. Concederla a `app_auth` sería
--       peor que el estado actual: le daría el oráculo al único rol que puede
--       emitir sesiones, y el canal de correo no la llama de todas formas.
--
--   (b) ELEGIDA: la función se queda, sin `EXECUTE` para NINGÚN rol de
--       aplicación. Tras esta migración su ACL queda solo con el dueño, o sea
--       el rol de migraciones y seeds (`withAdminContext`, sin `SET ROLE`),
--       que nunca sirve una petición de usuario (D-004). Es la menor superficie
--       que no rompe nada: la aplicación no puede ni llamarla, y el patrón
--       queda documentado y auditable por si algún día vuelve a hacer falta un
--       resolver previo a la sesión.
--
-- NO SE EDITA la migración 032: ya está aplicada y el runner aborta si cambia
-- su checksum. El estado final se alcanza sumando, que es como se corrige el
-- esquema en este proyecto.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION app.resolver_empresa_por_buzon(text) FROM app_user;

-- `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO
-- app_user` (001_fundacion.sql) concede EXECUTE automáticamente a cada función
-- nueva del esquema `app`. Por eso se revoca también a PUBLIC y a app_auth de
-- forma explícita: el objetivo es que la ACL quede vacía de roles de
-- aplicación, no que quede "sin el GRANT que escribió A4".
REVOKE ALL ON FUNCTION app.resolver_empresa_por_buzon(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolver_empresa_por_buzon(text) FROM app_auth;

COMMENT ON FUNCTION app.resolver_empresa_por_buzon(text) IS
  'SIN GRANT PARA NINGÚN ROL DE APLICACIÓN (V-1, migración 100). Resuelve company por buzon_email antes de que exista sesión; SECURITY DEFINER + row_security=off. Se dejó de conceder a app_user porque el buzón ES el parámetro que identifica al tenant: desde la sesión de una firma se obtenían los identificadores de otra. El canal de correo vivo (A13, migración 090) no la necesita: autentica el tenant con un token de integración y luego resuelve la empresa con un SELECT normal sobre company, bajo RLS. Si alguna vez vuelve a hacer falta un resolver previo a la sesión, concédasela a un rol de PostgreSQL propio de ese camino, nunca a app_user.';

-- -----------------------------------------------------------------------------
-- Verificación en la propia migración (el proyecto verifica, no asume): si
-- después de esto algún rol de aplicación conserva EXECUTE, la migración falla
-- y no se aplica.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_acl   aclitem[];
  v_dueno oid;
  v_sobra text;
BEGIN
  SELECT p.proacl, p.proowner INTO v_acl, v_dueno
    FROM pg_proc p
   WHERE p.oid = 'app.resolver_empresa_por_buzon(text)'::regprocedure;

  -- Una ACL NULA no significa "sin permisos": significa PRIVILEGIOS POR
  -- DEFECTO, y el defecto de una función es EXECUTE para PUBLIC. Sería el
  -- peor falso PASS posible aquí, así que se trata como fallo.
  IF v_acl IS NULL THEN
    RAISE EXCEPTION
      'V-1 no quedó cerrada: app.resolver_empresa_por_buzon tiene ACL nula, o sea EXECUTE para PUBLIC por defecto';
  END IF;

  SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                  ELSE pg_get_userbyid(a.grantee) END, ', ')
    INTO v_sobra
    FROM aclexplode(v_acl) a
   WHERE a.privilege_type = 'EXECUTE'
     AND a.grantee <> v_dueno;

  IF v_sobra IS NOT NULL THEN
    RAISE EXCEPTION
      'V-1 no quedó cerrada: conservan EXECUTE sobre app.resolver_empresa_por_buzon: %', v_sobra;
  END IF;
END $$;

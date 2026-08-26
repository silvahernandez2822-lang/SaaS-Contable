-- =============================================================================
-- 013_grants.sql — Privilegios de `app_user`
--
-- Criterio: la garantía real la imponen las políticas RLS y los triggers, no el
-- GRANT (un superusuario ignora ambos GRANT y RLS). Los privilegios se usan
-- como segunda capa donde no cuesta nada: audit_log y el catálogo de permisos.
--
-- El ledger conserva DELETE concedido a propósito: así el intento falla con el
-- trigger LG001 y su mensaje explicativo, en lugar de con un 42501 opaco. El
-- trigger, además, protege también al dueño de la tabla, cosa que el GRANT no
-- haría.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_user;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA app    TO app_user;

-- audit_log: se escribe, nunca se corrige ni se borra.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- permission: catálogo de código.
REVOKE INSERT, UPDATE, DELETE ON permission FROM app_user;

-- Control de migraciones: solo el administrador.
REVOKE ALL ON schema_migration FROM app_user;

-- Instaladores de DDL: no son API de aplicación.
REVOKE EXECUTE ON FUNCTION app.instalar_triggers_vigencia(text)   FROM app_user;
REVOKE EXECUTE ON FUNCTION app.instalar_trigger_auditoria(text)   FROM app_user;
REVOKE EXECUTE ON FUNCTION app.instalar_rls_tenant_company(text)  FROM app_user;
REVOKE EXECUTE ON FUNCTION app.instalar_rls_tenant(text)          FROM app_user;
REVOKE EXECUTE ON FUNCTION app.instalar_rls_hibrida(text)         FROM app_user;
REVOKE EXECUTE ON FUNCTION app.instalar_rls_hibrida_tenant(text)  FROM app_user;

-- =============================================================================
-- 032_ingest_resolver_buzon.sql — A4, Ola 1: resolver la empresa dueña de un
-- buzón de correo ANTES de que exista ninguna sesión.
--
-- POR QUÉ HACE FALTA (esquema congelado, se justifica antes de tocarlo):
-- `company` usa `instalar_rls_tenant('company')` (012_rls.sql): sus filas solo
-- son visibles para una sesión YA vinculada a ese tenant. Pero resolver el
-- buzón de un correo entrante es EXACTAMENTE lo contrario: todavía no se sabe
-- a qué tenant pertenece — es lo que se está averiguando. Es el mismo
-- problema del huevo y la gallina que D-023 ya resolvió para el login:
-- `app.buscar_credencial(text)` busca la fila de `"user"` por correo ANTES de
-- que haya sesión, con una función `SECURITY DEFINER` de superficie mínima.
-- Aquí se aplica el mismo patrón para `company.buzon_email`.
--
-- Sin esta función, la única forma de resolver el buzón sería una conexión
-- con privilegio de superusuario/BYPASSRLS en el camino de ingest — exactamente
-- lo que D-004 prohíbe para cualquier camino que toque una petición real.
--
-- Superficie expuesta: SOLO `id` y `tenant_id` de la empresa, y solo cuando
-- `buzon_email` coincide EXACTO y la empresa está `activa`. No se expone NIT,
-- razón social ni ningún otro dato de la empresa — el correo que llega no ha
-- demostrado tener derecho a ver nada de eso todavía.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.resolver_empresa_por_buzon(p_buzon text)
  RETURNS TABLE(company_id uuid, tenant_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
BEGIN
  RETURN QUERY
    SELECT c.id, c.tenant_id
      FROM company c
     WHERE c.buzon_email = lower(p_buzon)
       AND c.estado = 'activa';
END $$;

COMMENT ON FUNCTION app.resolver_empresa_por_buzon(text) IS
  'Resuelve el buzón dedicado de la sección 10.1 antes de que exista sesión. SECURITY DEFINER + row_security=off a propósito (mismo patrón que app.buscar_credencial, D-023): sin esto, ingest necesitaría un rol con privilegio sobre toda la tabla company. Expone solo (id, tenant_id), nunca datos de la empresa.';

-- Puede llamarse SIN sesión (es la razón de ser de la función) y también
-- dentro de una sesión ya abierta, así que se concede a app_user sin
-- condición — no a PUBLIC, para que quede en el inventario de funciones
-- DEFINER que A14 audita.
REVOKE ALL ON FUNCTION app.resolver_empresa_por_buzon(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolver_empresa_por_buzon(text) TO app_user;

-- =============================================================================
-- 181_a14_d089_catalogo_global_solo_lectura.sql — A14, compuerta AMPLIADA de
-- D-089. Cierra V-47.
--
-- QUÉ SE MIDIÓ, NO QUÉ SE SUPUSO. Auditando el punto 2 del encargo («la
-- personalización por empresa NO puede editar el catálogo base»), A14 atacó
-- `account` con SQL directo desde una sesión de negocio real (`app_user`, RLS
-- activa, token presentado) y encontró que la política híbrida de la migración
-- 012 deja DOS caminos abiertos sobre las filas globales (`tenant_id IS NULL`):
--
--   1. `DELETE FROM account WHERE tenant_id IS NULL` — PROSPERA. La cláusula
--      USING de la política híbrida incluye las filas globales para que se
--      puedan LEER, y un DELETE no tiene WITH CHECK que lo detenga. Medido:
--      el catálogo base quedó en cero filas desde la sesión de una firma
--      cualquiera. Con el PUC completo de D-089 eso son 2.506 cuentas que
--      desaparecen para TODAS las firmas de la plataforma.
--   2. `UPDATE account SET tenant_id = <el mío>` (o `company_id = <la mía>`) —
--      PROSPERA. La fila vieja satisface USING por ser global y la fila nueva
--      satisface WITH CHECK por ser mía: una firma se APROPIA de una fila del
--      catálogo compartido y se la quita a todas las demás.
--
-- El agujero NO es de D-089 ni de `account`: es de la política híbrida de la
-- Ola 0 y alcanza a las dieciocho tablas que la usan. A14 lo comprobó también
-- en `uvt_value`: `DELETE FROM uvt_value` desde una sesión de firma borra el
-- valor de la UVT para toda la plataforma, y con la UVT borrada el motor deja
-- de calcular cualquier retención (se niega, correctamente, pero se niega para
-- todo el mundo). En `tax_rule` el guardia append-only de la 001 tapaba el
-- DELETE de una vigencia que YA rige (PR003) — pero no el de una vigencia
-- FUTURA, ni el de una fila de `tax_concept`, ni el de un `municipality`.
--
-- Es una violación de la Regla de Oro 7 en su forma más literal: el aislamiento
-- lo tiene que imponer el motor, y aquí una firma escribía —destruía— datos
-- compartidos por todas. Y de la Regla de Oro 3 por la puerta de atrás: si una
-- vigencia global se puede borrar, «recalcular una factura de enero en julio da
-- el mismo resultado» deja de ser cierto.
--
-- -----------------------------------------------------------------------------
-- LA REGLA QUE SE IMPONE
-- -----------------------------------------------------------------------------
-- Desde una SESIÓN DE NEGOCIO, una fila de catálogo global (`tenant_id IS
-- NULL`) es de SOLO LECTURA: ni UPDATE ni DELETE. Se lee, se hereda y se
-- sobreescribe creando la fila propia de la firma o de la empresa —que es
-- exactamente el mecanismo de precedencia que D-064 ya construyó y que
-- `ocultarCuentaGenerica` ya usa—, pero la fila compartida no se toca.
--
-- SIN SESIÓN NO SE APLICA. Las migraciones, los seeds de A1 y las tareas de
-- plataforma corren sin token presentado (`app.session_id() IS NULL`): ahí la
-- garantía la da el privilegio, no este guardia. Es el mismo criterio que ya
-- usa `app.exigir_permiso` (016). Sin esa salida, ningún seed podría corregir
-- nunca una fila global y la migración 180 no podría cerrar una vigencia.
--
-- POR QUÉ UN TRIGGER Y NO ARREGLAR LA POLÍTICA. Cambiar la cláusula USING de
-- la política híbrida a «solo lo mío» rompería la LECTURA del catálogo global,
-- que es la razón de ser de la política. PostgreSQL no permite USING distintos
-- para SELECT y para DELETE dentro de una política FOR ALL, así que habría que
-- partir cada una de las dieciocho políticas en cuatro (SELECT/INSERT/UPDATE/
-- DELETE) y mantenerlas alineadas para siempre. Un guardia BEFORE, uno solo,
-- escrito una vez, dice la misma verdad para las dieciocho tablas y para las
-- que vengan.
--
-- POR QUÉ EL TRIGGER SE LLAMA `<tabla>_zz_global_solo_lectura`. PostgreSQL
-- dispara los BEFORE de fila en orden alfabético. El sufijo `zz` lo deja el
-- ÚLTIMO, para no robarle el diagnóstico a ningún guardia más específico: una
-- cuenta global en uso sigue diciendo `PU001`, una vigencia que ya rige sigue
-- diciendo `PR003`, y `CT001` solo aparece cuando nada más habría hablado.
-- Ninguna prueba existente cambia de código de error.
--
-- REGLA DE ORO 2: aquí no hay ni una tarifa, ni una base, ni una UVT, ni un
-- tope, ni un calendario. Es aislamiento multi-tenant.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.trg_catalogo_global_solo_lectura() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_tenant uuid;
BEGIN
  -- Camino administrativo: migraciones, seeds, worker de plataforma. No hay
  -- rol de negocio que evaluar y la garantía la da el privilegio.
  IF app.session_id() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_tenant := OLD.tenant_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION
      'CATALOGO_GLOBAL_SOLO_LECTURA: esta fila de % es del catálogo global que comparten TODAS las firmas de la plataforma; desde una sesión de negocio no se modifica ni se borra. Para apartarse del catálogo, cree la fila propia de su firma o de su empresa con el mismo código: la precedencia empresa > firma > global hace que gane la suya, y las demás firmas conservan la compartida.',
      TG_TABLE_NAME
      USING ERRCODE = 'CT001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.trg_catalogo_global_solo_lectura() IS
  'A14 (V-47): desde una sesion de negocio, una fila de catalogo global (tenant_id IS NULL) no se actualiza ni se borra. La politica RLS hibrida las expone a UPDATE/DELETE porque su USING las incluye para poder LEERLAS; este guardia cierra ese lado. Sin sesion (migraciones y seeds) no se aplica.';


-- -----------------------------------------------------------------------------
-- Instalador, para que la lista de tablas sea un dato y no un copiar-pegar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.instalar_catalogo_global_solo_lectura(p_tabla text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                 p_tabla || '_zz_global_solo_lectura', p_tabla);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.trg_catalogo_global_solo_lectura()',
    p_tabla || '_zz_global_solo_lectura', p_tabla);
END $$;

REVOKE ALL ON FUNCTION app.instalar_catalogo_global_solo_lectura(text) FROM PUBLIC, app_user, app_auth;

-- Las DIECIOCHO tablas con RLS híbrida (012, 019, 060, 130, 175). Si mañana
-- aparece una decimonovena, la prueba `tests/adversarial/a14-d089-ampliada`
-- («toda tabla con RLS híbrida lleva el guardia») lo dice antes de que llegue a
-- producción: el inventario no se mantiene a mano.
SELECT app.instalar_catalogo_global_solo_lectura('account');
SELECT app.instalar_catalogo_global_solo_lectura('niif_mapping');
SELECT app.instalar_catalogo_global_solo_lectura('municipality');
SELECT app.instalar_catalogo_global_solo_lectura('municipality_ica_rule');
SELECT app.instalar_catalogo_global_solo_lectura('ciiu_activity');
SELECT app.instalar_catalogo_global_solo_lectura('uvt_value');
SELECT app.instalar_catalogo_global_solo_lectura('smmlv_value');
SELECT app.instalar_catalogo_global_solo_lectura('rounding_rule');
SELECT app.instalar_catalogo_global_solo_lectura('tax_concept');
SELECT app.instalar_catalogo_global_solo_lectura('tax_rule');
SELECT app.instalar_catalogo_global_solo_lectura('tax_calendar');
SELECT app.instalar_catalogo_global_solo_lectura('concepto_causacion');
SELECT app.instalar_catalogo_global_solo_lectura('role');
SELECT app.instalar_catalogo_global_solo_lectura('exogena_format');
SELECT app.instalar_catalogo_global_solo_lectura('parametro_clasificacion');
SELECT app.instalar_catalogo_global_solo_lectura('prompt_clasificacion');
SELECT app.instalar_catalogo_global_solo_lectura('exogena_account_mapping');
SELECT app.instalar_catalogo_global_solo_lectura('department');


-- -----------------------------------------------------------------------------
-- `role_permission` — el mismo agujero, por la puerta de al lado.
--
-- No tiene `tenant_id` propio: su política lo hereda del rol
-- (`r.tenant_id IS NULL OR r.tenant_id = app.current_tenant_id()`), así que
-- también expone a UPDATE/DELETE las filas de los ROLES DEL SISTEMA, que son
-- globales. `DELETE FROM role_permission WHERE role_id = <rol de sistema>` deja
-- sin permisos a ese rol para TODAS las firmas de la plataforma. La aplicación
-- lo defiende (`RolBlindadoError` en `editarRol`/`eliminarRol`), pero eso es
-- exactamente lo que la Regla de Oro 7 prohíbe: el aislamiento lo impone el
-- motor, no la aplicación.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_role_permission_global_solo_lectura() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_tenant uuid;
  v_codigo text;
BEGIN
  IF app.session_id() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT r.tenant_id, r.codigo INTO v_tenant, v_codigo
    FROM public.role r WHERE r.id = OLD.role_id;

  IF FOUND AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'CATALOGO_GLOBAL_SOLO_LECTURA: el rol "%" es del sistema y lo comparten todas las firmas: sus permisos no se editan desde una sesión de negocio. Cree un rol propio de su firma con los permisos que necesite.',
      v_codigo
      USING ERRCODE = 'CT001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS role_permission_zz_global_solo_lectura ON role_permission;
CREATE TRIGGER role_permission_zz_global_solo_lectura
  BEFORE UPDATE OR DELETE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION app.trg_role_permission_global_solo_lectura();

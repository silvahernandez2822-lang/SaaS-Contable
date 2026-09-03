-- =============================================================================
-- 176_a8_d087_permisos_parametros.sql — D-087, Fase 4 del Módulo de Parámetros.
--
-- DOS COSAS, ninguna reescribe lógica:
--
--   A. GRANULARIDAD DE PERMISO POR SUBMÓDULO (tarea 2). Hoy toda la sección
--      `/parametros` se gobierna con UN código: `parametro.editar` /
--      `parametro.leer` (más `puc.editar` / `puc.leer` para el PUC). Se añaden
--      códigos por submódulo al catálogo `permission`:
--        · parametro.tarifas.{leer,editar}
--        · parametro.valores_base.{leer,editar}
--        · parametro.reteica.{leer,editar}
--        · parametro.puc.{leer,editar}
--      La resolución sigue siendo por FILAS en `role_permission` (D-066/D-084):
--      dar más granularidad = INSERTAR filas, no cambiar código. Quien HOY tiene
--      el permiso grueso recibe el fino equivalente por `INSERT ... SELECT`
--      desde las asignaciones que ya existen — sin un solo `UPDATE`, y sin
--      inventar un modelo de roles nuevo (eso lo trae la Fase 8, agregando más
--      filas). El comportamiento observable no cambia en esta ola.
--
--      La ESCRITURA en la base la siguen imponiendo los triggers de 016 sobre
--      `parametro.editar` (tax_rule, uvt_value, smmlv_value, rounding_rule,
--      municipality_ica_rule) y `puc.editar` (account): NO se retarget ningún
--      trigger aquí. Los códigos finos son, por ahora, para que la INTERFAZ
--      muestre u oculte cada submódulo con precisión; la Fase 8 podrá
--      retargetear los triggers cuando exista un rol que necesite editar un
--      submódulo y no otro. Mientras tanto, como todo rol con `parametro.editar`
--      recibe los cuatro `*.editar`, el candado de la base no se relaja.
--
--   B. DETALLE DEL SIMULADOR DE IMPACTO (tarea 3). Las funciones
--      `app.simular_impacto_*` de 080 devuelven CONTEOS ("N conceptos, M
--      proveedores"). D-087 exige además poder LISTAR esos conceptos y
--      proveedores concretos. Se añaden `app.detalle_impacto_*` que devuelven
--      las filas reales usando EXACTAMENTE el mismo `WHERE` que la función de
--      conteo hermana — así el detalle nunca diverge del número.
--
-- Regla de Oro 2: aquí no hay ni una tarifa, base, UVT, tope ni calendario.
-- Son permisos y consultas de apoyo a la interfaz.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Catálogo de permisos por submódulo
--
-- `modulo` = 'parametrizacion', el MISMO de `parametro.leer` / `parametro.editar`
-- (014). Corregido por A12 en la revisión de seguridad de D-087: la pantalla
-- `/admin/roles` arma la matriz agrupando por `permission.modulo`, y un módulo
-- 'parametros' aparte habría puesto dos grupos casi homónimos —«parametrizacion»
-- y «parametros»— uno al lado del otro, con la casilla que SÍ manda (el grueso)
-- separada de las que no. En una pantalla de otorgar privilegios, dos etiquetas
-- que se leen igual son una trampa de configuración.
-- -----------------------------------------------------------------------------
INSERT INTO permission (codigo, nombre, descripcion, modulo, accion_tipo) VALUES
  ('parametro.tarifas.leer',        'Consultar tarifas (tax_rule)',
   'Ver retefuente, autorretencion, ReteIVA, ReteICA por actividad, IVA y tabla de salarios', 'parametrizacion', 'ver'),
  ('parametro.tarifas.editar',      'Editar tarifas (tax_rule)',
   'Abrir una vigencia nueva de una tarifa de tax_rule (cierra la anterior, nunca UPDATE)', 'parametrizacion', 'editar'),
  ('parametro.valores_base.leer',   'Consultar valores base (UVT / SMMLV / redondeo)',
   'Ver UVT, SMMLV, auxilio de transporte y regla de redondeo general', 'parametrizacion', 'ver'),
  ('parametro.valores_base.editar', 'Editar valores base (UVT / SMMLV / redondeo)',
   'Abrir una vigencia nueva de UVT, SMMLV o redondeo general', 'parametrizacion', 'editar'),
  ('parametro.reteica.leer',        'Consultar ReteICA por municipio',
   'Ver bases minimas y tarifa general de municipality_ica_rule', 'parametrizacion', 'ver'),
  ('parametro.reteica.editar',      'Editar ReteICA por municipio',
   'Abrir una vigencia nueva de bases minimas / tarifa general de un municipio', 'parametrizacion', 'editar'),
  ('parametro.puc.leer',            'Consultar el PUC desde Parametros',
   'Ver el plan de cuentas efectivo de la empresa desde el submodulo de parametros', 'parametrizacion', 'ver'),
  ('parametro.puc.editar',          'Editar el PUC desde Parametros',
   'Crear u ocultar cuentas y fijar el modo de herencia del PUC desde el submodulo de parametros', 'parametrizacion', 'editar')
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Preservar el comportamiento actual: quien tiene el permiso grueso recibe el
-- fino equivalente. `INSERT ... SELECT` desde `role_permission` — nunca UPDATE.
-- `admin_firma` tiene TODOS los códigos grueso como filas explicitas (D-066),
-- asi que recibe los ocho finos y la invariante "admin_firma lo tiene todo"
-- (compuerta de arranque) se mantiene.
-- -----------------------------------------------------------------------------
INSERT INTO role_permission (role_id, permission_codigo)
SELECT rp.role_id, x.fino
  FROM role_permission rp
  JOIN (VALUES
    ('parametro.editar', 'parametro.tarifas.editar'),
    ('parametro.editar', 'parametro.valores_base.editar'),
    ('parametro.editar', 'parametro.reteica.editar'),
    ('parametro.leer',   'parametro.tarifas.leer'),
    ('parametro.leer',   'parametro.valores_base.leer'),
    ('parametro.leer',   'parametro.reteica.leer'),
    ('puc.editar',       'parametro.puc.editar'),
    ('puc.leer',         'parametro.puc.leer')
  ) AS x(grueso, fino) ON x.grueso = rp.permission_codigo
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- B. Detalle del simulador de impacto — MISMAS consultas base que 080, pero
--    devolviendo las filas concretas en vez del conteo.
-- -----------------------------------------------------------------------------

-- B.1 — conceptos y proveedores afectados por una tarifa de tax_rule.
CREATE OR REPLACE FUNCTION app.detalle_impacto_tax_concept(p_tax_concept_id uuid)
  RETURNS TABLE(clase text, codigo text, nombre text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  WITH afectados AS (
    SELECT cc.id, cc.codigo, cc.nombre
      FROM concepto_causacion cc
     WHERE cc.tenant_id = v_tenant
       AND (cc.tax_concept_retefuente_id       = p_tax_concept_id
         OR cc.tax_concept_reteiva_id          = p_tax_concept_id
         OR cc.tax_concept_reteiva_exterior_id = p_tax_concept_id
         OR cc.tax_concept_reteica_id          = p_tax_concept_id
         OR cc.tax_concept_autorretencion_id   = p_tax_concept_id)
  )
  SELECT 'concepto'::text, a.codigo::text, a.nombre::text
    FROM afectados a
  UNION ALL
  SELECT 'proveedor'::text,
         (tp.tipo_documento || ' ' || tp.numero_documento)::text,
         tp.razon_social::text
    FROM (SELECT DISTINCT ra.third_party_id
            FROM retention_applied ra
           WHERE ra.tenant_id = v_tenant
             AND ra.concepto_causacion_id IN (SELECT id FROM afectados)
             AND ra.third_party_id IS NOT NULL) d
    JOIN third_party tp ON tp.id = d.third_party_id
  ORDER BY 1, 3, 2;
END $$;

COMMENT ON FUNCTION app.detalle_impacto_tax_concept(uuid) IS
  'D-087: filas concretas (conceptos de causacion + proveedores) detras del conteo de app.simular_impacto_tax_concept. Mismo WHERE, para que detalle y conteo no diverjan.';

-- B.2 — conceptos y proveedores con historial de ReteICA en un municipio.
CREATE OR REPLACE FUNCTION app.detalle_impacto_municipio_ica(p_municipality_id uuid)
  RETURNS TABLE(clase text, codigo text, nombre text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  SELECT 'concepto'::text, cc.codigo::text, cc.nombre::text
    FROM (SELECT DISTINCT ra.concepto_causacion_id AS id
            FROM retention_applied ra
           WHERE ra.tenant_id = v_tenant AND ra.municipality_id = p_municipality_id
             AND ra.tipo = 'reteica' AND ra.concepto_causacion_id IS NOT NULL) d
    JOIN concepto_causacion cc ON cc.id = d.id
  UNION ALL
  SELECT 'proveedor'::text,
         (tp.tipo_documento || ' ' || tp.numero_documento)::text,
         tp.razon_social::text
    FROM (SELECT DISTINCT ra.third_party_id AS id
            FROM retention_applied ra
           WHERE ra.tenant_id = v_tenant AND ra.municipality_id = p_municipality_id
             AND ra.tipo = 'reteica' AND ra.third_party_id IS NOT NULL) d
    JOIN third_party tp ON tp.id = d.id
  ORDER BY 1, 3, 2;
END $$;

COMMENT ON FUNCTION app.detalle_impacto_municipio_ica(uuid) IS
  'D-087: filas concretas detras del conteo de app.simular_impacto_municipio_ica. Mismo WHERE.';

-- B.3 — conceptos y proveedores de la firma afectados por un valor base
--        (UVT / SMMLV / redondeo general): mismo alcance que
--        app.simular_impacto_valor_base (todos los de la firma).
CREATE OR REPLACE FUNCTION app.detalle_impacto_valor_base()
  RETURNS TABLE(clase text, codigo text, nombre text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
BEGIN
  PERFORM app.exigir_permiso('parametro.editar');
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay tenant en la sesión' USING ERRCODE = 'SE001';
  END IF;

  RETURN QUERY
  SELECT 'concepto'::text, cc.codigo::text, cc.nombre::text
    FROM concepto_causacion cc
   WHERE cc.tenant_id = v_tenant
  UNION ALL
  SELECT 'proveedor'::text,
         (tp.tipo_documento || ' ' || tp.numero_documento)::text,
         tp.razon_social::text
    FROM (SELECT DISTINCT ra.third_party_id AS id
            FROM retention_applied ra
           WHERE ra.tenant_id = v_tenant AND ra.third_party_id IS NOT NULL) d
    JOIN third_party tp ON tp.id = d.id
  ORDER BY 1, 3, 2;
END $$;

COMMENT ON FUNCTION app.detalle_impacto_valor_base() IS
  'D-087: filas concretas detras del conteo de app.simular_impacto_valor_base. Mismo alcance de firma.';

GRANT EXECUTE ON FUNCTION app.detalle_impacto_tax_concept(uuid)   TO app_user;
GRANT EXECUTE ON FUNCTION app.detalle_impacto_municipio_ica(uuid) TO app_user;
GRANT EXECUTE ON FUNCTION app.detalle_impacto_valor_base()        TO app_user;

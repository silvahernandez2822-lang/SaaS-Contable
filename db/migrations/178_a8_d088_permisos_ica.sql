-- =============================================================================
-- 178_a8_d088_permisos_ica.sql — D-088, submódulo de parametrización de ICA por
-- municipio: permiso propio.
--
-- Misma mecánica que 176 (D-087): se añaden dos códigos por submódulo al
-- catálogo `permission` y se reparten por FILAS en `role_permission` con un
-- `INSERT ... SELECT` desde las asignaciones que ya existen — nunca un `UPDATE`,
-- nunca un modelo de roles nuevo.
--
--   · parametro.ica.leer   — ver la pantalla de ICA por municipio (bases
--     mínimas, tipo de medición, tabla de actividades gravadas y sus tarifas).
--   · parametro.ica.editar — abrir vigencia nueva de la regla del municipio o
--     de una tarifa por actividad, y la carga masiva de un municipio completo.
--
-- La ESCRITURA en la base la siguen imponiendo los triggers de 016 sobre
-- `municipality_ica_rule` y `tax_rule` (`parametro.editar`): 178 NO retargetea
-- ningún trigger. El código fino sirve para que la INTERFAZ muestre u oculte el
-- submódulo con precisión y para fallar temprano con un mensaje útil; el candado
-- real sigue siendo `parametro.editar`. Como todo rol con `parametro.editar`
-- recibe aquí `parametro.ica.editar`, el candado de la base no se relaja.
--
-- ALCANCE: nivel FIRMA. Igual que el catálogo DANE de D-086 y las bases mínimas
-- de ReteICA (176/`parametro.reteica.*`), la parametrización de ICA por
-- municipio es dato compartido entre las empresas-cliente de la firma. El
-- permiso se resuelve por `v_user_permission` acotada a la empresa en contexto
-- (o a toda la firma si no hay empresa seleccionada), exactamente como los ocho
-- de D-087; la escritura crea filas con `company_id NULL` (compartidas) salvo
-- que el contador pida un override de una sola empresa.
--
-- Regla de Oro 2: aquí no hay ni una tarifa, base, UVT, tope ni calendario.
-- Los dos únicos INSERT son a `permission` y `role_permission`: identificadores.
-- =============================================================================

INSERT INTO permission (codigo, nombre, descripcion, modulo, accion_tipo) VALUES
  ('parametro.ica.leer',   'Consultar la parametrización de ICA por municipio',
   'Ver bases minimas, tipo de medicion (por factura / por periodo) y la tabla de actividades gravadas de ICA por municipio', 'parametrizacion', 'ver'),
  ('parametro.ica.editar', 'Editar la parametrización de ICA por municipio',
   'Abrir vigencia nueva de la regla del municipio o de una tarifa por actividad (gravada/no gravada), y la carga masiva de un municipio completo', 'parametrizacion', 'editar')
ON CONFLICT (codigo) DO NOTHING;

-- Quien tiene el permiso grueso recibe el fino equivalente. `INSERT ... SELECT`
-- desde `role_permission` — nunca UPDATE. `admin_firma` tiene el grueso como
-- fila explicita (D-066), asi que recibe los dos finos y la invariante
-- "admin_firma lo tiene todo" (compuerta de arranque) se mantiene.
INSERT INTO role_permission (role_id, permission_codigo)
SELECT rp.role_id, x.fino
  FROM role_permission rp
  JOIN (VALUES
    ('parametro.editar', 'parametro.ica.editar'),
    ('parametro.leer',   'parametro.ica.leer')
  ) AS x(grueso, fino) ON x.grueso = rp.permission_codigo
ON CONFLICT DO NOTHING;

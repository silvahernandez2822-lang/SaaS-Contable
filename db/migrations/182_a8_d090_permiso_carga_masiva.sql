-- =============================================================================
-- 182_a8_d090_permiso_carga_masiva.sql — D-090, Fase 6: módulo central de carga
-- masiva (`/carga-masiva`). Permiso propio de ACCESO a la pantalla.
--
-- Misma mecánica que 176 (D-087) y 178 (D-088): un código nuevo en el catálogo
-- `permission`, repartido por FILAS en `role_permission` con un
-- `INSERT ... SELECT` desde las asignaciones que ya existen — nunca un
-- `UPDATE`, nunca un modelo de roles nuevo.
--
--   · carga_masiva.acceder — ver la pantalla `/carga-masiva` (la portada y
--     `/carga-masiva/:catalogo`). NO autoriza a escribir en ningún catálogo:
--     eso lo sigue exigiendo el permiso propio de cada uno
--     (`parametro.editar`, `tercero.editar`, `puc.editar`, `parametro.puc.
--     editar`, `parametro.ica.editar`...) por el trigger de la tabla (016).
--     Un usuario con `carga_masiva.acceder` pero sin el permiso de un
--     catálogo concreto ve la pantalla y la plantilla, y recibe el aviso «no
--     tiene el permiso» al intentar cargar — exactamente el mismo
--     comportamiento que ya tenía la pantalla antes de esta migración,
--     ahora detrás de una puerta de entrada.
--
-- A QUIÉN SE LE OTORGA POR DEFECTO: a los roles que hoy tienen operativamente
-- algo que cargar por archivo, es decir, cualquiera de los permisos "editar"
-- de un catálogo de `DEFINICIONES` (`parametro.editar`, `puc.editar`,
-- `tercero.editar`, `concepto.editar`). Con los cinco roles de 014 eso es:
--   · admin_firma       (tiene los cuatro)
--   · admin_tributario  (parametro.editar, puc.editar, tercero.editar)
--   · contador          (concepto.editar, tercero.editar)
--   · auxiliar_causacion (tercero.editar)
-- `solo_lectura` NO lo recibe: no tiene ningún permiso de edición de catálogo,
-- así que la pantalla solo le mostraría quince avisos de "sin permiso" sin una
-- sola acción posible — abrirle la puerta no cambia nada que pueda hacer.
--
-- Regla de Oro 2: aquí no hay ni una tarifa, base, UVT, tope ni calendario.
-- El único INSERT es de un código de permiso: un identificador, no un dato
-- tributario.
-- =============================================================================

INSERT INTO permission (codigo, nombre, descripcion, modulo, accion_tipo) VALUES
  ('carga_masiva.acceder', 'Entrar al módulo de carga masiva',
   'Ver la pantalla /carga-masiva y sus subpáginas por catálogo. No autoriza a escribir en ningún catálogo: eso lo sigue exigiendo el permiso propio de cada uno (parametro.editar, tercero.editar, puc.editar...) por el trigger de la tabla.',
   'parametrizacion', 'ver')
ON CONFLICT (codigo) DO NOTHING;

-- Quien tiene CUALQUIERA de los cuatro permisos "editar" de catálogo recibe el
-- acceso al módulo. `DISTINCT` evita una fila duplicada para el rol que tenga
-- más de uno de los cuatro (p. ej. `admin_firma`, que los tiene todos):
-- `role_permission` tiene PK (role_id, permission_codigo), así que el
-- `ON CONFLICT DO NOTHING` ya bastaría por sí solo, pero el DISTINCT deja la
-- intención explícita en la propia consulta.
INSERT INTO role_permission (role_id, permission_codigo)
SELECT DISTINCT rp.role_id, 'carga_masiva.acceder'
  FROM role_permission rp
 WHERE rp.permission_codigo IN ('parametro.editar', 'puc.editar', 'tercero.editar', 'concepto.editar')
ON CONFLICT DO NOTHING;

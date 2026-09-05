-- =============================================================================
-- 184_a14_d092_cierre_escalada_por_update_de_acceso.sql — A14, compuerta D-092
--
-- V-57. AGUJERO REAL, ENCONTRADO EN LA COMPUERTA DE D-092 Y CERRADO AQUI.
--
-- La migracion 183 puso tres puertas contra la auto-escalada y dejo abierta la
-- de al lado. `app.trg_acceso_no_escalar` (puerta 2) empieza asi:
--
--   IF TG_OP = 'UPDATE'
--      AND NOT (OLD.revocado_en IS NOT NULL AND NEW.revocado_en IS NULL)
--   THEN RETURN NEW; END IF;
--
-- Es decir: del UPDATE solo le interesa la REACTIVACION. El razonamiento
-- escrito en 183 es «un acceso que pasa de revocado a vigente vuelve a
-- conferir; revocarlo, o tocar cualquier otra columna, no». La primera mitad es
-- cierta. La segunda es falsa, y la falsedad es la escalada entera:
--
--   UPDATE user_company_access SET role_id = <admin_firma> WHERE id = <el mio>;
--
-- El acceso nunca estuvo revocado, asi que no es una reactivacion; no es un
-- INSERT, asi que la puerta 2 no lo mira; no toca `role_permission`, asi que la
-- puerta 1 no lo mira; no toca `user_permission_override`, asi que la puerta 3
-- no lo mira. `role.es_todopoderoso` no se modifica —RL001 sigue en pie—: se
-- APUNTA a un rol que ya lo era. Y `usuario.administrar` basta para escribir en
-- la tabla (016) y la RLS deja escribir la empresa en contexto, que es la
-- propia. Resultado medido, no supuesto: una sesion con `usuario.administrar` y
-- nada mas se asciende a si misma a `admin_firma` con una sola sentencia, y
-- `app.tiene_permiso` le devuelve `true` para todo el catalogo a la siguiente
-- peticion. La ficha D-092 dice «las tres unicas vias por las que un permiso
-- llega a una persona»: son tres tablas, pero cuatro sentencias.
--
-- QUE CAMBIA. El guardia deja de preguntar «¿es una reactivacion?» y pasa a
-- preguntar lo unico que importa: «¿esta fila, DESPUES del UPDATE, confiere
-- algo que antes no confería?». Se comprueba cuando la fila queda VIGENTE y
-- cambia cualquiera de las cuatro columnas que deciden qué confiere y a quién:
-- `role_id`, `user_id`, `company_id` y `tenant_id`. Cambiar el usuario sin
-- cambiar el rol es la misma escalada por otro lado —mover a mi nombre el
-- acceso `contador` de otro—, y por eso entra tambien.
--
-- QUE NO CAMBIA, a proposito:
--   · REVOCAR sigue siendo libre (`NEW.revocado_en IS NOT NULL` sale antes de
--     mirar nada). Bajarle permisos a alguien no es escalada, y un guardia que
--     lo impidiera dejaria a la firma sin poder contener un incidente (183).
--   · Un UPDATE que no toca ninguna de las cuatro columnas —`updated_at` y
--     poco mas— sigue pasando sin coste.
--   · El rol todopoderoso sigue pasando sin esfuerzo: para el
--     `app.tiene_permiso` es `true` para cualquier codigo.
--   · Sin sesion (migraciones, seeds, `src/bootstrap`) el guardia se salta,
--     igual que en 183: ese camino corre con privilegio.
--   · Los SQLSTATE son los mismos (`PO002`), el nombre del trigger es el mismo
--     y la firma de la funcion es la misma: esto es un `CREATE OR REPLACE` del
--     cuerpo, no un modelo nuevo.
--
-- La 183 no se edita: esta aplicada y una migracion aplicada tiene checksum.
--
-- REGLA DE ORO 2: aqui no hay ni una tarifa, base, UVT, tope ni calendario.
-- Los unicos literales son nombres de columna y SQLSTATE: identificadores.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.trg_acceso_no_escalar() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
DECLARE
  v_falta text;
BEGIN
  IF app.session_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- La fila queda REVOCADA: no confiere nada. Bajar nunca se restringe.
    IF NEW.revocado_en IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- La fila queda vigente. Si ya lo estaba y no cambio ninguna de las cuatro
    -- columnas que deciden QUE confiere y A QUIEN, no hay nada que comprobar.
    IF OLD.revocado_en IS NULL
       AND NEW.role_id    IS NOT DISTINCT FROM OLD.role_id
       AND NEW.user_id    IS NOT DISTINCT FROM OLD.user_id
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
       AND NEW.tenant_id  IS NOT DISTINCT FROM OLD.tenant_id
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Un rol todopoderoso confiere TODO el catalogo, incluido lo que se anada
  -- manana: solo puede repartirlo quien hoy ejerce todo el catalogo.
  IF EXISTS (SELECT 1 FROM public.role r WHERE r.id = NEW.role_id AND r.es_todopoderoso) THEN
    SELECT p.codigo INTO v_falta
      FROM public.permission p
     WHERE NOT app.tiene_permiso(p.codigo)
     LIMIT 1;
  ELSE
    SELECT rp.permission_codigo INTO v_falta
      FROM public.role_permission rp
     WHERE rp.role_id = NEW.role_id
       AND NOT app.tiene_permiso(rp.permission_codigo)
     LIMIT 1;
  END IF;

  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION
      'ESCALADA_DE_PRIVILEGIO: ese rol confiere el permiso "%", que quien lo otorga no tiene',
      v_falta
      USING ERRCODE = 'PO002',
            HINT = 'Otorgue un rol cuyas capacidades usted mismo ejerza, o pidaselo al administrador de la firma.';
  END IF;

  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION app.trg_acceso_no_escalar() IS
  'D-092 (183) + V-57 (184): nadie confiere por user_company_access un permiso que no ejerce. Se comprueba en el INSERT y en todo UPDATE que deje la fila VIGENTE cambiando role_id, user_id, company_id o tenant_id — no solo en la reactivacion, que era el agujero de 183. Revocar nunca se restringe.';

-- Mismo criterio de 183: una funcion de trigger no se llama a mano. El
-- privilegio EXECUTE se comprueba al CREAR el trigger, no al dispararlo, y
-- `CREATE OR REPLACE` no reinstala el trigger — pero sí puede devolver el
-- ACL por defecto, asi que se vuelve a revocar (D-034).
REVOKE EXECUTE ON FUNCTION app.trg_acceso_no_escalar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.trg_acceso_no_escalar() FROM app_user;

-- =============================================================================
-- 183_a12_d092_permiso_individual_y_antiescalada.sql — A12, D-092
--
-- Dos cosas, las dos impuestas por el motor y no por la aplicacion.
--
-- A. PERMISO INDIVIDUAL POR USUARIO, POR ENCIMA DEL ROL, CON MOTIVO
--    OBLIGATORIO (`user_permission_override`).
--
--    Hasta hoy el permiso efectivo de una persona salia 100% de su ROL:
--    `v_user_permission` (011) y `v_user_permission_efectivo` (170) son las
--    dos derivadas de `role_permission` + `user_company_access`. Lo que
--    ESTADO_PROYECTO llamaba «permisos granulares por usuario» era en
--    realidad «una firma puede fabricarse un rol a medida y dárselo a una
--    sola persona» — granularidad a nivel de ROL, no un permiso puntual
--    otorgado a un usuario concreto.
--
--    La diferencia importa para auditoria, no para comodidad. «Al auxiliar
--    Perez se le dio `reporte.exportar` el 3 de diciembre porque el contador
--    estaba incapacitado y habia que presentar la exogena» es una frase que
--    hoy NO se puede reconstruir: lo unico que quedaria es un rol nuevo
--    llamado «auxiliar_2» con una descripcion que alguien escribio a las
--    ocho de la noche. `motivo` es NOT NULL y con longitud minima justo por
--    eso: un permiso especial sin razon documentada es un hueco de
--    trazabilidad (Regla de Oro 6).
--
--    LA TABLA ES APPEND-ONLY, y no por simetria con el ledger sino porque el
--    dato que guarda es una DECISION, no un estado. Revocar una excepcion no
--    es borrar la fila que la otorgo: es tomar una decision nueva, con su
--    propio motivo, su propio autor y su propia fecha. Si revocar hiciera
--    `DELETE`, la pregunta «¿quien tuvo `asiento.publicar` en marzo y por
--    que?» quedaria sin respuesta — que es exactamente la pregunta que esta
--    tabla existe para contestar. El efecto vigente de un (usuario, empresa,
--    permiso) es su fila mas reciente no vencida.
--
--    `vence_en` permite la excepcion TEMPORAL («solo mientras dure el cierre
--    de diciembre»), que es la forma sana de conceder un permiso puntual: se
--    apaga sola. Solo aplica a `otorgado`: una revocacion que se apagara sola
--    seria una trampa.
--
-- B. NADIE OTORGA LO QUE NO TIENE (anti-escalada, tres puertas).
--
--    El vector de ataque obvio de un modulo de administracion es que quien
--    administra usuarios se ascienda a si mismo. HOY ESO ES POSIBLE y no es
--    teorico: `usuario.administrar` alcanza para (1) crear un rol propio de
--    la firma con TODO el catalogo (`crearRol` + `fijarPermisosDeRol`) y
--    (2) auto-asignarselo (`asignarRol`). Es decir, `usuario.administrar`
--    era transitivamente equivalente a todos los permisos del producto.
--    Con los cinco roles de sistema de 014 solo `admin_firma` lo tiene —y
--    ese es todopoderoso por definicion (D-066), asi que no escala nada—,
--    pero desde D-067 una firma puede crear un rol propio con
--    `usuario.administrar` y nada mas, y creer honestamente que le esta
--    dando a alguien «solo la pantalla de usuarios».
--
--    La regla que se impone es la clasica y la unica que se puede comprobar
--    en el motor: **una sesion no puede conferir un permiso que ella misma no
--    ejerce**. Se aplica en las tres unicas vias por las que un permiso llega
--    a una persona:
--
--      1. `role_permission` INSERT      — meter un permiso en un rol.
--      2. `user_company_access` INSERT / reactivacion — dar un rol entero.
--      3. `user_permission_override` INSERT con efecto 'otorgado'.
--
--    QUITAR nunca se restringe: bajarle permisos a alguien no es escalada, y
--    un guardia que lo impidiera dejaria a la firma sin poder contener un
--    incidente. Por eso la puerta 1 es solo sobre INSERT y la 3 solo sobre
--    'otorgado'.
--
--    Un rol `es_todopoderoso` pasa las tres puertas sin esfuerzo: para el,
--    `app.tiene_permiso` devuelve true para cualquier codigo (D-066). El
--    administrador de firma no pierde ni una capacidad. Sin sesion
--    (migraciones, seeds, `src/bootstrap`) el guardia se salta a proposito,
--    igual que `app.exigir_permiso`: ese camino corre con privilegio, y la
--    garantia la da el privilegio, no el permiso de negocio.
--
-- REGLA DE ORO 2: aqui no hay ni una tarifa, base, UVT, tope ni calendario.
-- Los unicos literales son codigos de permiso y SQLSTATE: identificadores.
-- =============================================================================


-- =============================================================================
-- A. TABLA DE PERMISO INDIVIDUAL
-- =============================================================================

CREATE TABLE user_permission_override (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  company_id         uuid NOT NULL REFERENCES company(id),
  user_id            uuid NOT NULL REFERENCES "user"(id),
  permission_codigo  text NOT NULL REFERENCES permission(codigo),
  efecto             text NOT NULL CHECK (efecto IN ('otorgado', 'revocado')),
  motivo             text NOT NULL,
  vence_en           timestamptz,
  otorgado_por       uuid REFERENCES "user"(id),
  otorgado_en        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Un motivo de tres letras no es un motivo. El minimo no pretende garantizar
  -- calidad —nada la garantiza— sino impedir el "x" que se escribe para pasar
  -- de pantalla. La longitud es de FORMATO, no un valor de negocio (RO 2).
  CONSTRAINT upo_motivo_ck CHECK (length(btrim(motivo)) >= 10),

  -- Una revocacion que se apagara sola seria una trampa: el permiso volveria
  -- sin que nadie lo decidiera. Solo el otorgamiento puede ser temporal.
  CONSTRAINT upo_vence_solo_otorgado_ck
    CHECK (vence_en IS NULL OR efecto = 'otorgado'),

  -- Mismo patron de 002/018: el alcance se amarra con FK compuesta, no solo
  -- con RLS. Un override de la firma A nunca puede apuntar a la empresa o al
  -- usuario de la firma B, ni con la RLS desactivada.
  CONSTRAINT upo_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT upo_user_fk FOREIGN KEY (user_id, tenant_id)
    REFERENCES "user" (id, tenant_id)
);

-- El indice esta pensado para la consulta que corre en CADA comprobacion de
-- permiso: «la fila mas reciente de este usuario, esta empresa y este codigo».
CREATE INDEX upo_resolucion_idx
  ON user_permission_override (tenant_id, user_id, permission_codigo, company_id, otorgado_en DESC);

CREATE INDEX upo_historial_idx
  ON user_permission_override (tenant_id, otorgado_en DESC);

COMMENT ON TABLE user_permission_override IS
  'D-092: permiso individual otorgado o revocado a UN usuario sobre UNA empresa, por encima de lo que le da su rol, con motivo obligatorio. APPEND-ONLY: revocar una excepcion es una fila nueva, nunca un DELETE — la pregunta que esta tabla contesta es "quien tuvo este permiso, cuando y por que", y un DELETE la deja sin respuesta. El efecto vigente de un (usuario, empresa, permiso) es su fila mas reciente no vencida.';

COMMENT ON COLUMN user_permission_override.motivo IS
  'D-092, Regla de Oro 6: por que se concedio (o se retiro) la excepcion. NOT NULL y con longitud minima: un permiso especial sin razon documentada es un hueco de trazabilidad.';

COMMENT ON COLUMN user_permission_override.vence_en IS
  'D-092: excepcion temporal ("solo mientras dure el cierre"). Vencida, el permiso vuelve a resolverse por el rol sin que nadie tenga que acordarse de apagarla. Solo aplica a efecto = otorgado.';

COMMENT ON COLUMN user_permission_override.otorgado_por IS
  'Lo fija el trigger desde la sesion, no la aplicacion: quien concede una excepcion no puede firmarla con el nombre de otro.';

-- -----------------------------------------------------------------------------
-- RLS de doble nivel, con la variante de `audit_log` (012) y NO la de
-- `instalar_rls_tenant_company`, por una razon concreta:
--
-- `app.tiene_permiso` tiene que poder resolver la excepcion tambien cuando NO
-- hay empresa en contexto (edicion de un parametro de la firma: alli
-- `app.current_company_id()` es NULL y el permiso se resuelve contra cualquier
-- acceso vigente del usuario en la firma, exactamente como en 016/170). La
-- politica cruda `company_id = app.current_company_id()` devuelve CERO filas
-- justo en ese caso —NULL = NULL no es verdadero— y la excepcion desapareceria
-- en silencio precisamente cuando mas importa. Es la misma trampa que D-026
-- documento para `user_company_access` y que alli se resolvio con un espejo en
-- el esquema `app`; aqui se resuelve sin espejo, con la politica escrita a
-- mano.
--
-- CONSECUENCIA DECLARADA, no descubierta despues: con una empresa en contexto,
-- un administrador solo ve y solo escribe las excepciones DE ESA EMPRESA. Para
-- repartir permisos sobre otra empresa de la firma hay que cambiarse a ella en
-- el selector. Es el mismo comportamiento que ya tenia `user_company_access`
-- desde 012, y es el estricto: la empresa es la unidad del aislamiento
-- (D-021/D-022), no un parametro de la peticion.
-- -----------------------------------------------------------------------------
ALTER TABLE user_permission_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_override FORCE  ROW LEVEL SECURITY;
CREATE POLICY user_permission_override_rls ON user_permission_override FOR ALL
  USING      (tenant_id = app.current_tenant_id()
              AND (app.current_company_id() IS NULL OR company_id = app.current_company_id()))
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND (app.current_company_id() IS NULL OR company_id = app.current_company_id()));

-- El alcance de las dos FK a filas de la propia firma ya lo imponen las FK
-- compuestas de arriba. `otorgado_por` no la tiene (es opcional), asi que va
-- por el guardia generico de 018.
SELECT app.instalar_guardia_alcance('user_permission_override', 'otorgado_por', 'user');

-- Escribir una excepcion es administrar usuarios. Lo exige el motor, no el
-- servicio (D-025).
SELECT app.instalar_permiso_escritura('user_permission_override', 'usuario.administrar');

-- Toda fila queda en el audit_log con su motivo dentro de `valor_nuevo`.
SELECT app.instalar_trigger_auditoria('user_permission_override');

-- -----------------------------------------------------------------------------
-- Append-only, al modo de `audit_log` (AU001): ni el superusuario corrige una
-- decision de permisos. El trigger no mira quien es.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_override_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
BEGIN
  RAISE EXCEPTION
    'OVERRIDE_INMUTABLE: una decision de permiso individual no se edita ni se borra (%)', TG_OP
    USING ERRCODE = 'PO003',
          HINT = 'Para retirar la excepcion, inserte una fila nueva con efecto = revocado y su motivo. Asi queda quien la quito, cuando y por que.';
END $fn$;

CREATE TRIGGER user_permission_override_append_only
  BEFORE UPDATE OR DELETE ON user_permission_override
  FOR EACH ROW EXECUTE FUNCTION app.trg_override_append_only();

-- -----------------------------------------------------------------------------
-- Puerta 3 de la anti-escalada + firma obligatoria del autor.
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER porque consulta `app.acceso_usuario_empresa`, el espejo de
-- D-026 sobre el que NINGUN rol de aplicacion tiene privilegio —y esa ausencia
-- de privilegio es una garantia que no se toca: sin ella, `app_user` podria
-- leer el mapa de accesos de su firma sin pasar por RLS. Mismo criterio que
-- `app.tiene_permiso` (016), que es SECURITY DEFINER por lo mismo.
CREATE OR REPLACE FUNCTION app.trg_override_blindaje() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $fn$
BEGIN
  -- Sin sesion es el camino administrativo (migraciones, seeds, bootstrap):
  -- corre con privilegio y la garantia la da el privilegio (016).
  IF app.session_id() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Quien concede firma con su nombre, no con el que escriba la aplicacion.
  NEW.otorgado_por := app.current_user_id();

  IF NEW.vence_en IS NOT NULL AND NEW.vence_en <= now() THEN
    RAISE EXCEPTION 'OVERRIDE_VENCIMIENTO_PASADO: la excepcion venceria antes de empezar'
      USING ERRCODE = 'PO001';
  END IF;

  -- El administrador tiene que tener acceso vigente a la empresa sobre la que
  -- concede. Con una empresa en contexto esto ya lo impone la RLS; el caso que
  -- cubre este guardia es el OTRO — sin empresa en contexto (parametros de la
  -- firma) la politica deja pasar cualquier empresa del tenant, y sin esta
  -- comprobacion un administrador de la empresa A podria repartir permisos
  -- sobre la empresa B sin haber puesto nunca un pie en ella.
  IF NOT EXISTS (
    SELECT 1 FROM app.acceso_usuario_empresa a
     WHERE a.user_id     = app.current_user_id()
       AND a.company_id  = NEW.company_id
       AND a.revocado_en IS NULL
  ) THEN
    RAISE EXCEPTION
      'OVERRIDE_EMPRESA_AJENA: no se pueden repartir permisos sobre una empresa a la que uno no tiene acceso vigente'
      USING ERRCODE = 'PO004';
  END IF;

  IF NEW.efecto = 'otorgado' THEN
    -- Nadie se asciende a si mismo. Es el vector de ataque obvio del modulo.
    IF NEW.user_id = app.current_user_id() THEN
      RAISE EXCEPTION
        'AUTO_OTORGAMIENTO: nadie se concede a si mismo un permiso que no tiene; pidaselo a otro administrador'
        USING ERRCODE = 'PO001';
    END IF;

    -- Nadie confiere lo que no ejerce. Un rol todopoderoso pasa siempre.
    IF NOT app.tiene_permiso(NEW.permission_codigo) THEN
      RAISE EXCEPTION
        'ESCALADA_DE_PRIVILEGIO: no se puede conceder el permiso "%" porque quien lo concede no lo tiene',
        NEW.permission_codigo
        USING ERRCODE = 'PO002',
              HINT = 'Administrar usuarios no es tener todos los permisos. Pidale la excepcion a alguien que si ejerza ese permiso.';
    END IF;
  END IF;

  RETURN NEW;
END $fn$;

-- El nombre lleva `zz_` para que dispare DESPUES de
-- `user_permission_override_permiso` (016 exige `usuario.administrar`) y de
-- `..._fk_alcance`: PostgreSQL dispara los BEFORE de fila en orden alfabetico,
-- y el diagnostico util es «le falta el permiso de administracion» antes que
-- «esta intentando escalar».
CREATE TRIGGER user_permission_override_zz_blindaje
  BEFORE INSERT ON user_permission_override
  FOR EACH ROW EXECUTE FUNCTION app.trg_override_blindaje();

-- Una funcion de trigger SECURITY DEFINER no debe poder LLAMARSE a mano: seria
-- una puerta lateral concedida gratis. PostgreSQL comprueba el privilegio
-- EXECUTE al CREAR el trigger, no al dispararlo, asi que se puede retirar
-- despues sin desarmar nada. Con esto la funcion no entra en el inventario de
-- «SECURITY DEFINER ejecutables por app_user» que vigila
-- `tests/adversarial/evasion.test.ts`, y ese inventario NO hay que ampliarlo
-- para dar cabida a esta ficha: un canario que se ensancha cada vez que
-- alguien anade una funcion deja de ser un canario.
REVOKE EXECUTE ON FUNCTION app.trg_override_blindaje() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.trg_override_blindaje() FROM app_user;
REVOKE EXECUTE ON FUNCTION app.trg_override_append_only() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.trg_override_append_only() FROM app_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_permission_override TO app_user;


-- =============================================================================
-- B. PUERTAS 1 Y 2 DE LA ANTI-ESCALADA
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Puerta 1 — meter un permiso en un rol.
-- Solo INSERT: quitar un permiso de un rol nunca es escalada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_role_permission_no_escalar() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
BEGIN
  IF app.session_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT app.tiene_permiso(NEW.permission_codigo) THEN
    RAISE EXCEPTION
      'ESCALADA_DE_PRIVILEGIO: no se puede meter el permiso "%" en un rol porque quien lo hace no lo tiene',
      NEW.permission_codigo
      USING ERRCODE = 'PO002',
            HINT = 'Un rol no es una via para repartir capacidades que uno mismo no ejerce. Administrar usuarios no equivale a tener todos los permisos.';
  END IF;

  RETURN NEW;
END $fn$;

-- `zz_` por el mismo motivo: despues de `role_permission_blindaje` (170, el
-- rol todopoderoso) para que RL001 siga siendo el diagnostico de ese caso.
CREATE TRIGGER role_permission_zz_no_escalar
  BEFORE INSERT ON role_permission
  FOR EACH ROW EXECUTE FUNCTION app.trg_role_permission_no_escalar();

-- -----------------------------------------------------------------------------
-- Puerta 2 — dar un rol entero a alguien (o reactivar un acceso revocado).
--
-- Otorgar `contador` a alguien confiere de un golpe los diecinueve permisos de
-- ese rol. Sin esta puerta, la puerta 1 seria decorativa: bastaria con asignar
-- un rol de sistema que ya trae lo que uno no tiene.
-- -----------------------------------------------------------------------------
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

  -- En UPDATE solo interesa la REACTIVACION: un acceso que pasa de revocado a
  -- vigente vuelve a conferir. Revocarlo, o tocar cualquier otra columna, no.
  IF TG_OP = 'UPDATE' AND NOT (OLD.revocado_en IS NOT NULL AND NEW.revocado_en IS NULL) THEN
    RETURN NEW;
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

CREATE TRIGGER user_company_access_zz_no_escalar
  BEFORE INSERT OR UPDATE ON user_company_access
  FOR EACH ROW EXECUTE FUNCTION app.trg_acceso_no_escalar();

-- Mismo criterio que arriba: ninguna de las dos se llama a mano.
REVOKE EXECUTE ON FUNCTION app.trg_role_permission_no_escalar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.trg_role_permission_no_escalar() FROM app_user;
REVOKE EXECUTE ON FUNCTION app.trg_acceso_no_escalar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.trg_acceso_no_escalar() FROM app_user;


-- =============================================================================
-- C. `app.tiene_permiso` v3 — el override entra en la resolucion
--
-- Orden de precedencia, de mas fuerte a mas debil:
--
--   1. ROL TODOPODEROSO. Gana siempre, incluso sobre una revocacion
--      individual. No es un descuido: si una excepcion pudiera quitarle
--      `usuario.administrar` al administrador de firma, un clic dejaria a la
--      firma sin nadie que pueda otorgar permisos — que es EXACTAMENTE el
--      agujero que D-066 cerro con RL001, reabierto por otra puerta.
--   2. EXCEPCION INDIVIDUAL vigente (la fila mas reciente no vencida).
--      'revocado' niega aunque el rol conceda; 'otorgado' concede aunque el
--      rol no conceda.
--   3. EL ROL, como hasta hoy (170).
--
-- Una excepcion VENCIDA es invisible: no cuenta ni para conceder ni para
-- negar, y la decision anterior —si la hubo— vuelve a mandar. Es la lectura
-- coherente con «la excepcion duraba lo que duraba el cierre»: al terminar, se
-- vuelve al estado que habia antes de ella, no a un limbo.
--
-- El resto del predicado (sesion viva, acceso no revocado, empresa en
-- contexto) es identico al de 170 y sigue siendo la garantia de aislamiento.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.tiene_permiso(p_codigo text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog, app, public
  AS $fn$
    WITH ses AS (
      SELECT s.user_id, s.tenant_id
        FROM app.session_context s
       WHERE s.token_hash  = app.hash_token(app.token_presentado())
         AND s.revocada_en IS NULL
         AND s.expira_en   > now()
    ),
    accesos AS (
      SELECT a.role_id, r.es_todopoderoso, r.activo,
             (rp.permission_codigo IS NOT NULL) AS por_rol
        FROM ses
        JOIN app.acceso_usuario_empresa a
          ON a.user_id     = ses.user_id
         AND a.tenant_id   = ses.tenant_id
         AND a.revocado_en IS NULL
        JOIN public.role r ON r.id = a.role_id AND r.activo
        LEFT JOIN public.role_permission rp
          ON rp.role_id = a.role_id AND rp.permission_codigo = p_codigo
       WHERE app.current_company_id() IS NULL OR a.company_id = app.current_company_id()
    ),
    excepcion AS (
      SELECT o.efecto
        FROM ses
        JOIN public.user_permission_override o
          ON o.user_id   = ses.user_id
         AND o.tenant_id = ses.tenant_id
       WHERE o.permission_codigo = p_codigo
         AND (app.current_company_id() IS NULL OR o.company_id = app.current_company_id())
         AND o.otorgado_en <= now()
         AND (o.vence_en IS NULL OR o.vence_en > now())
       ORDER BY o.otorgado_en DESC, o.id DESC
       LIMIT 1
    )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM accesos WHERE es_todopoderoso)      THEN true
      WHEN (SELECT efecto FROM excepcion) = 'revocado'               THEN false
      WHEN (SELECT efecto FROM excepcion) = 'otorgado'
           AND EXISTS (SELECT 1 FROM accesos)                        THEN true
      ELSE EXISTS (SELECT 1 FROM accesos WHERE por_rol)
    END
  $fn$;

COMMENT ON FUNCTION app.tiene_permiso(text) IS
  'D-066 + D-092: un rol es_todopoderoso concede cualquier permiso y ninguna excepcion individual se lo quita; por debajo manda la excepcion individual vigente de user_permission_override (otorgado/revocado, la mas reciente no vencida); por debajo, role_permission. Un rol inactivo no concede nada.';

-- -----------------------------------------------------------------------------
-- La vista de permisos efectivos tiene que contar lo mismo que la funcion, o
-- la pantalla «permisos efectivos de este usuario» mentiria justo sobre las
-- excepciones, que es lo unico que no se puede deducir mirando el rol.
--
-- Se reemplaza `v_user_permission_efectivo` (170) en su sitio. `security_
-- invoker = true` (D-019) se conserva: la vista se lee con la RLS de quien
-- pregunta, no con la del dueño.
-- -----------------------------------------------------------------------------
DROP VIEW v_user_permission_efectivo;

CREATE VIEW v_user_permission_efectivo WITH (security_invoker = true) AS
WITH excepcion AS (
  -- DISTINCT ON = la fila mas reciente no vencida por (usuario, empresa,
  -- permiso). Es la misma regla de resolucion de `app.tiene_permiso`, escrita
  -- una vez por cada lado porque una vista no puede llamar a la funcion sin
  -- perder el conjunto.
  SELECT DISTINCT ON (o.user_id, o.company_id, o.permission_codigo)
         o.tenant_id, o.company_id, o.user_id, o.permission_codigo, o.efecto,
         o.motivo, o.vence_en, o.otorgado_por, o.otorgado_en
    FROM user_permission_override o
   WHERE o.otorgado_en <= now()
     AND (o.vence_en IS NULL OR o.vence_en > now())
   ORDER BY o.user_id, o.company_id, o.permission_codigo, o.otorgado_en DESC, o.id DESC
)
SELECT uca.tenant_id, uca.company_id, uca.user_id,
       r.id AS role_id, r.codigo AS role_codigo, r.es_todopoderoso,
       p.codigo AS permission_codigo, p.modulo, p.accion_tipo,
       -- De donde sale este permiso: del rol, o de una excepcion individual.
       CASE WHEN r.es_todopoderoso                      THEN 'rol_todopoderoso'
            WHEN e.efecto = 'otorgado'
             AND NOT EXISTS (SELECT 1 FROM role_permission rp
                              WHERE rp.role_id = r.id AND rp.permission_codigo = p.codigo)
                                                        THEN 'excepcion_individual'
            WHEN e.efecto = 'otorgado'                  THEN 'rol_y_excepcion'
            ELSE 'rol' END AS origen,
       e.motivo      AS excepcion_motivo,
       e.vence_en    AS excepcion_vence_en,
       e.otorgado_en AS excepcion_otorgada_en
  FROM user_company_access uca
  JOIN role r ON r.id = uca.role_id AND r.activo
  CROSS JOIN permission p
  LEFT JOIN excepcion e
    ON e.user_id           = uca.user_id
   AND e.company_id        = uca.company_id
   AND e.permission_codigo = p.codigo
 WHERE uca.revocado_en IS NULL
   AND (
        r.es_todopoderoso
     OR e.efecto = 'otorgado'
     OR (e.efecto IS DISTINCT FROM 'revocado'
         AND EXISTS (SELECT 1 FROM role_permission rp
                      WHERE rp.role_id = r.id AND rp.permission_codigo = p.codigo))
   );

COMMENT ON VIEW v_user_permission_efectivo IS
  'D-066 + D-092: permisos que un usuario PUEDE ejercer por empresa, ya resueltos — incluye los que da un rol todopoderoso sin fila en role_permission, suma los otorgados por excepcion individual vigente y resta los revocados por excepcion. `origen` dice de donde sale cada uno.';

GRANT SELECT ON v_user_permission_efectivo TO app_user;

-- -----------------------------------------------------------------------------
-- `v_user_permission` (011) se deja INTACTA a proposito: describe las filas
-- OTORGADAS por rol, que es una pregunta distinta y legitima («¿que dice la
-- tabla de otorgamientos?»). Cambiarla haria que dos vistas contaran lo mismo
-- y ninguna contara lo otro.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 170_a16_ola4_operacion_real.sql — Ola 4, «Operación real»
--
-- Cinco cosas que el sistema necesitaba para que una firma pudiera OPERARLO,
-- no solo demostrarlo. Todas se imponen en el motor, no en la aplicación.
--
-- A. CARGA MASIVA AUDITADA (D-063). `audit_log.accion` no contemplaba una
--    carga de archivo. Cargar 400 terceros de un .xlsx es una escritura en
--    bloque sobre datos con consecuencia tributaria: si el rastro fuera una
--    fila INSERT por tercero, nadie podría responder «¿de qué archivo salió
--    esto y quién lo subió?». Se añade la acción 'CARGA_MASIVA' y la función
--    `app.registrar_carga_masiva`, que escribe UNA fila de cabecera por
--    archivo, dentro de la MISMA transacción que inserta las filas.
--
-- B. PUC POR EMPRESA (D-064 y D-065). `account` ya admitía filas globales
--    (tenant NULL) y filas de empresa desde 003, pero nadie definía qué pasa
--    cuando el mismo código existe en los dos alcances, y no había forma de
--    decir «esta empresa usa su propio plan». Se define la regla de
--    precedencia en una vista, `v_account_efectivo`, y el interruptor por
--    empresa vive en `company_setting` (clave 'puc.solo_propio').
--
-- C. ROL TODOPODEROSO BLINDADO EN EL MOTOR (D-066). Hasta hoy `admin_firma`
--    era todopoderoso solo porque 014 le insertó todas las filas de
--    `role_permission`: un DELETE sobre esa tabla —desde la interfaz nueva de
--    administración, o desde un `psql`— dejaba a la firma sin nadie que
--    pudiera volver a otorgar permisos. Se añade `role.es_todopoderoso`, se
--    hace que `app.tiene_permiso` lo respete SIN mirar `role_permission`, y
--    se prohíbe con triggers desotorgar, desactivar o borrar ese rol.
--
-- D. ROLES PROPIOS DE CADA FIRMA (D-067). `role.tenant_id` ya permitía roles
--    de firma desde 002. Faltaba (i) poder inactivar un rol sin borrarlo y
--    (ii) una clasificación del catálogo de permisos que permita presentarlos
--    como la matriz «módulo × ver/editar/aprobar/administrar» que pide un
--    administrador de firma. Se añaden `role.activo` y
--    `permission.accion_tipo`.
--
-- E. APROBACIÓN JERÁRQUICA DE CORRECCIONES (D-068). «El junior corrige, el
--    revisor aprueba» se modela como ESTADO del recurso corregido
--    (`document_correction.estado`), no como un permiso especial: el permiso
--    decide quién mueve el estado, el estado vive en los datos.
-- =============================================================================


-- =============================================================================
-- A. CARGA MASIVA AUDITADA
-- =============================================================================

-- La lista se reescribe ENTERA, no se «amplia»: PostgreSQL no sabe anadir un
-- valor a un CHECK. Por eso hay que copiar la de 090 —que ya habia anadido los
-- dos verbos de token de A13— y no la de 009. Perder uno por el camino no lo
-- avisa el motor al aplicar la migracion: lo avisa mucho despues, cuando el
-- canal de correo intenta escribir su rastro y revienta.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_accion_check;
ALTER TABLE audit_log ADD  CONSTRAINT audit_log_accion_check
  CHECK (accion IN ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT',
                    'ACCESO_DENEGADO','APROBACION','PUBLICACION','REVERSA',
                    'TOKEN_INTEGRACION_EMITIDO','TOKEN_INTEGRACION_REVOCADO',
                    'CARGA_MASIVA'));

CREATE OR REPLACE FUNCTION app.registrar_carga_masiva(
  p_entidad      text,
  p_archivo      text,
  p_filas_ok     integer,
  p_filas_error  integer,
  p_detalle      jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
DECLARE
  v_id bigint;
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion que registrar'
      USING ERRCODE = 'SE001';
  END IF;

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
          'CARGA_MASIVA', p_entidad, p_archivo,
          COALESCE(p_detalle, '{}'::jsonb)
            || jsonb_build_object('archivo',     p_archivo,
                                  'filas_ok',    p_filas_ok,
                                  'filas_error', p_filas_error),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END $fn$;

COMMENT ON FUNCTION app.registrar_carga_masiva(text, text, integer, integer, jsonb) IS
  'D-063: cabecera de auditoria de una carga masiva — quien subio que archivo, a que catalogo, cuantas filas entraron y cuantas se rechazaron. No sustituye la auditoria fila a fila de app.trg_audit: la resume y la ata a un archivo.';

GRANT EXECUTE ON FUNCTION app.registrar_carga_masiva(text, text, integer, integer, jsonb) TO app_user;


-- =============================================================================
-- B. PUC GENERICO + PUC PROPIO POR EMPRESA
--
-- REGLA DE PRECEDENCIA (D-064), en una frase: el PUC de una empresa NO
-- reemplaza al generico, lo SOBREESCRIBE CUENTA POR CUENTA y lo COMPLEMENTA.
--
-- Para cada `codigo` de cuenta gana la fila del alcance mas especifico que
-- exista: empresa (3) > firma (2) > global (1). Una empresa que quiera
-- ESCONDER una cuenta del PUC generico no la borra —no puede: la RLS no le
-- deja escribir la fila global— sino que crea la suya con el mismo codigo y
-- `activo = false`.
--
-- Se descarto «el PUC propio reemplaza el generico entero» como
-- comportamiento por defecto: obligaria a cargar las ~200 cuentas del 2650 a
-- toda empresa que solo quiera anadir tres auxiliares, y el primer efecto de
-- un archivo incompleto seria un ledger sin cuentas donde imputar.
--
-- INTERRUPTOR EXPLICITO (D-065): una firma SI puede querer el reemplazo total
-- para una empresa concreta (plan de cuentas heredado de otro software). Eso
-- se activa a mano, por empresa, con `company_setting` clave 'puc.solo_propio'
-- valor `true`, y entonces `v_account_efectivo` deja de mostrarle lo global y
-- lo de la firma. Es una decision del administrador, nunca un efecto colateral
-- de cargar un archivo.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.puc_solo_propio() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, app, public
  AS $fn$
    SELECT COALESCE(
      (SELECT (cs.valor #>> '{}') = 'true'
         FROM public.company_setting cs
        WHERE cs.company_id = app.current_company_id()
          AND cs.clave = 'puc.solo_propio'),
      false)
  $fn$;

COMMENT ON FUNCTION app.puc_solo_propio() IS
  'D-065: la empresa en contexto usa exclusivamente su propio plan de cuentas (true) o hereda el generico y lo sobreescribe cuenta por cuenta (false, por defecto).';

GRANT EXECUTE ON FUNCTION app.puc_solo_propio() TO app_user;

-- -----------------------------------------------------------------------------
-- `v_account_efectivo`: el PUC que ve la empresa en contexto, ya resuelto.
--
-- `security_invoker = true` (igual que el resto de vistas, 011): la vista NO
-- es un atajo alrededor de la RLS — cada fila que devuelve tuvo que pasar la
-- politica hibrida de `account` para la sesion que consulta.
-- -----------------------------------------------------------------------------
CREATE VIEW v_account_efectivo WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.codigo)
       a.id, a.tenant_id, a.company_id, a.codigo, a.nombre, a.nivel, a.parent_id,
       a.naturaleza, a.permite_movimiento, a.requiere_tercero, a.requiere_centro_costo,
       a.requiere_base_gravable, a.clase_puc, a.activo,
       CASE WHEN a.company_id IS NOT NULL THEN 'empresa'
            WHEN a.tenant_id  IS NOT NULL THEN 'firma'
            ELSE 'global' END AS alcance
  FROM account a
 WHERE NOT app.puc_solo_propio()
    OR a.company_id = app.current_company_id()
 ORDER BY a.codigo,
          (CASE WHEN a.company_id IS NOT NULL THEN 3
                WHEN a.tenant_id  IS NOT NULL THEN 2
                ELSE 1 END) DESC;

COMMENT ON VIEW v_account_efectivo IS
  'D-064: PUC efectivo de la empresa en contexto. Una fila por codigo; gana el alcance mas especifico (empresa > firma > global). Una cuenta con activo=false esconde la generica del mismo codigo.';

GRANT SELECT ON v_account_efectivo TO app_user;


-- =============================================================================
-- C. EL ROL TODOPODEROSO, BLINDADO EN EL MOTOR
-- =============================================================================

ALTER TABLE role ADD COLUMN es_todopoderoso boolean NOT NULL DEFAULT false;
ALTER TABLE role ADD COLUMN activo          boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN role.es_todopoderoso IS
  'D-066: rol con TODOS los permisos por definicion, no por las filas de role_permission. Ni la interfaz ni un UPDATE directo pueden desotorgarle un permiso.';
COMMENT ON COLUMN role.activo IS
  'D-067: un rol se inactiva, no se borra — igual que un usuario. Un rol inactivo no concede ningun permiso y no se puede asignar.';

UPDATE role SET es_todopoderoso = true
 WHERE tenant_id IS NULL AND codigo = 'admin_firma';

-- -----------------------------------------------------------------------------
-- `app.tiene_permiso` v2. Dos cambios sobre la version de 016:
--   1. Un acceso cuyo rol es `es_todopoderoso` concede CUALQUIER permiso sin
--      consultar `role_permission`. Ese es el blindaje: vaciar la tabla no
--      desarma al administrador de firma.
--   2. Un rol con `activo = false` no concede nada, ni siquiera lo que tenga
--      en `role_permission`.
-- El resto del predicado (sesion viva, acceso no revocado, empresa en
-- contexto) es identico y sigue siendo la garantia de aislamiento.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tiene_permiso(p_codigo text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog, app, public
  AS $fn$
    SELECT EXISTS (
      SELECT 1
        FROM app.session_context s
        JOIN app.acceso_usuario_empresa a
          ON a.user_id     = s.user_id
         AND a.tenant_id   = s.tenant_id
         AND a.revocado_en IS NULL
        JOIN public.role r ON r.id = a.role_id AND r.activo
        LEFT JOIN public.role_permission rp
          ON rp.role_id = a.role_id AND rp.permission_codigo = p_codigo
       WHERE s.token_hash  = app.hash_token(app.token_presentado())
         AND s.revocada_en IS NULL
         AND s.expira_en   > now()
         AND (r.es_todopoderoso OR rp.permission_codigo IS NOT NULL)
         AND (app.current_company_id() IS NULL OR a.company_id = app.current_company_id())
    )
  $fn$;

COMMENT ON FUNCTION app.tiene_permiso(text) IS
  'D-066: un rol es_todopoderoso concede cualquier permiso sin mirar role_permission; un rol inactivo no concede ninguno.';

-- -----------------------------------------------------------------------------
-- Blindaje 1: no se le quitan permisos a un rol todopoderoso.
-- No es que «no haga falta» (las filas de role_permission de admin_firma
-- siguen existiendo y sirven para mostrarlas en la interfaz): es que borrarlas
-- desde una pantalla de administracion daria la falsa impresion de haber
-- degradado el rol.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_rol_todopoderoso_intocable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
DECLARE
  v_rol uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
BEGIN
  IF TG_OP <> 'INSERT'
     AND EXISTS (SELECT 1 FROM public.role r WHERE r.id = v_rol AND r.es_todopoderoso) THEN
    RAISE EXCEPTION
      'ROL_BLINDADO: el rol % es todopoderoso; sus permisos no se editan ni se quitan', v_rol
      USING ERRCODE = 'RL001',
            HINT = 'Para degradar a alguien, quitele ESE rol y deje otro (user_company_access). El rol en si no se degrada.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER role_permission_blindaje
  BEFORE INSERT OR UPDATE OR DELETE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION app.trg_rol_todopoderoso_intocable();

-- -----------------------------------------------------------------------------
-- Blindaje 2: el rol todopoderoso no se desactiva, no se degrada y no se borra.
-- Tampoco se puede FABRICAR uno nuevo desde la aplicacion: `es_todopoderoso`
-- solo se enciende con la credencial privilegiada (sin sesion), es decir por
-- migracion. Una firma que pudiera crearse roles todopoderosos a voluntad
-- convertiria el blindaje en un adorno.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_rol_blindado() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.es_todopoderoso OR OLD.es_sistema THEN
      RAISE EXCEPTION 'ROL_BLINDADO: el rol % (%) es del sistema y no se borra', OLD.id, OLD.codigo
        USING ERRCODE = 'RL001',
              HINT = 'Los roles del sistema se inactivan (activo = false); el todopoderoso ni eso.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.es_todopoderoso AND app.session_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ROL_BLINDADO: un rol todopoderoso solo se crea por migracion, nunca desde la aplicacion'
      USING ERRCODE = 'RL001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.es_todopoderoso AND NOT NEW.es_todopoderoso THEN
      RAISE EXCEPTION 'ROL_BLINDADO: el rol % no puede dejar de ser todopoderoso', OLD.codigo
        USING ERRCODE = 'RL001';
    END IF;
    IF OLD.es_todopoderoso AND NOT NEW.activo THEN
      RAISE EXCEPTION 'ROL_BLINDADO: el rol todopoderoso % no se puede inactivar', OLD.codigo
        USING ERRCODE = 'RL001',
              HINT = 'Si nadie tuviera este rol activo, la firma se quedaria sin quien otorgue permisos.';
    END IF;
    IF NEW.es_todopoderoso AND NOT OLD.es_todopoderoso AND app.session_id() IS NOT NULL THEN
      RAISE EXCEPTION 'ROL_BLINDADO: no se puede ascender un rol a todopoderoso desde la aplicacion'
        USING ERRCODE = 'RL001';
    END IF;
  END IF;

  RETURN NEW;
END $fn$;

CREATE TRIGGER role_blindaje
  BEFORE INSERT OR UPDATE OR DELETE ON role
  FOR EACH ROW EXECUTE FUNCTION app.trg_rol_blindado();

-- El catalogo de `role` YA lo audita 009 (`role_audit`), asi que no se vuelve a
-- instalar: un segundo trigger de auditoria sobre la misma tabla duplicaria
-- cada fila del audit_log. `role_permission` NO se audita y a proposito: su
-- unica via de escritura desde la aplicacion es `fijarPermisosDeRol`, que corre
-- en la misma transaccion que el UPDATE de `role` — y ese si deja rastro.


-- =============================================================================
-- D. ROLES PROPIOS: CLASIFICACION DEL CATALOGO DE PERMISOS
--
-- `permission.modulo` ya agrupaba los permisos. Lo que faltaba para presentar
-- la matriz «modulo x ver / editar / aprobar» que pide un administrador de
-- firma era el EJE VERTICAL. Se anade como columna del catalogo, no como una
-- tabla nueva: es un atributo del permiso, no una entidad.
-- =============================================================================

ALTER TABLE permission ADD COLUMN accion_tipo text NOT NULL DEFAULT 'editar'
  CHECK (accion_tipo IN ('ver', 'editar', 'aprobar', 'administrar'));

COMMENT ON COLUMN permission.accion_tipo IS
  'D-067: eje vertical de la matriz de permisos por modulo. ver = consultar; editar = modificar datos; aprobar = mover un recurso a un estado que otro no puede; administrar = tocar la configuracion del modulo.';

UPDATE permission SET accion_tipo = 'ver' WHERE codigo IN (
  'documento.leer','asiento.leer','parametro.leer','puc.leer','concepto.leer',
  'tercero.leer','reporte.leer','empresa.leer','usuario.leer','auditoria.leer');

UPDATE permission SET accion_tipo = 'aprobar' WHERE codigo IN (
  'causacion.aprobar','causacion.reversar','asiento.publicar','periodo.cerrar');

UPDATE permission SET accion_tipo = 'administrar' WHERE codigo IN (
  'empresa.administrar','usuario.administrar');

-- Permiso nuevo: aprobar o rechazar la correccion que hizo otro (bloque E).
INSERT INTO permission (codigo, nombre, descripcion, modulo, accion_tipo) VALUES
  ('documento.aprobar_correccion', 'Aprobar correcciones de documentos',
   'Aprobar o rechazar la correccion de AIU o de municipio que registro otro usuario, antes de que el motor la use',
   'documentos', 'aprobar');

-- `admin_firma` lo recibe como todos los demas aunque su poder no dependa de
-- esta tabla (D-066): la invariante «admin_firma tiene TODOS los permisos del
-- catalogo» se comprueba en la compuerta de arranque leyendo `role_permission`,
-- y dejarlo fuera la rompería sin que el rol perdiera nada de verdad.
INSERT INTO role_permission (role_id, permission_codigo)
SELECT r.id, 'documento.aprobar_correccion'
  FROM role r
 WHERE r.tenant_id IS NULL AND r.codigo IN ('admin_firma', 'contador');

-- -----------------------------------------------------------------------------
-- Permisos efectivos de un usuario, ya resueltos: incluye lo que concede el
-- rol todopoderoso, que no esta en `role_permission`.
-- `v_user_permission` (011) se conserva intacta: describe las filas otorgadas.
-- Esta describe lo que la sesion PUEDE hacer, que no es lo mismo.
-- -----------------------------------------------------------------------------
CREATE VIEW v_user_permission_efectivo WITH (security_invoker = true) AS
SELECT uca.tenant_id, uca.company_id, uca.user_id,
       r.id AS role_id, r.codigo AS role_codigo, r.es_todopoderoso,
       p.codigo AS permission_codigo, p.modulo, p.accion_tipo
  FROM user_company_access uca
  JOIN role r ON r.id = uca.role_id AND r.activo
  JOIN permission p
    ON r.es_todopoderoso
   OR EXISTS (SELECT 1 FROM role_permission rp
               WHERE rp.role_id = r.id AND rp.permission_codigo = p.codigo)
 WHERE uca.revocado_en IS NULL;

COMMENT ON VIEW v_user_permission_efectivo IS
  'D-066: permisos que un usuario PUEDE ejercer por empresa, incluidos los que le da un rol todopoderoso sin fila en role_permission.';

GRANT SELECT ON v_user_permission_efectivo TO app_user;


-- =============================================================================
-- E. APROBACION JERARQUICA DE CORRECCIONES (D-068)
--
-- «El junior corrige y el revisor aprueba» NO es un permiso especial: es un
-- ESTADO del recurso corregido. El permiso decide QUIEN mueve el estado; el
-- estado vive en los datos y se puede consultar, filtrar y auditar.
--
-- POR QUE EL ESTADO INICIAL DEPENDE DE QUIEN CORRIGE, Y NO ES SIEMPRE
-- 'pendiente_revision': un contador que corrige su propio documento no tiene a
-- quien pedirle la aprobacion — quedaria una bandeja de revision que nadie
-- vacia, y en la practica la gente aprobaria su propia fila, que es peor que
-- no tener el circuito. Asi que quien YA tiene `documento.aprobar_correccion`
-- inserta directamente en 'aprobado' (y queda en el audit_log como suyo);
-- quien no lo tiene deja la correccion 'pendiente_revision' y el motor NO la
-- usa hasta que alguien la apruebe.
--
-- QUE PASA SI NADIE APRUEBA: el documento se causa como si la correccion no
-- existiera —que es el comportamiento anterior a esta migracion— y la
-- correccion sigue visible como pendiente. Nunca se aplica a medias.
-- =============================================================================

ALTER TABLE document_correction
  ADD COLUMN estado          text NOT NULL DEFAULT 'aprobado'
                               CHECK (estado IN ('pendiente_revision','aprobado','rechazado')),
  ADD COLUMN revisado_por    uuid REFERENCES "user"(id),
  ADD COLUMN revisado_en     timestamptz,
  ADD COLUMN motivo_revision text;

COMMENT ON COLUMN document_correction.estado IS
  'D-068: pendiente_revision (la registro alguien sin documento.aprobar_correccion y el motor NO la usa), aprobado (el motor la usa), rechazado (queda como historia, el motor no la usa).';

CREATE INDEX document_correction_pendiente_idx
  ON document_correction (company_id, estado, creado_en DESC)
  WHERE estado = 'pendiente_revision';

-- -----------------------------------------------------------------------------
-- Quien puede mover el estado, y hasta donde.
--   - Insertar en 'aprobado' exige `documento.aprobar_correccion`. Sin el, la
--     fila nace 'pendiente_revision' aunque el cliente pida otra cosa: el
--     motor la corrige en vez de rechazarla, para que un formulario mal
--     armado no se convierta en un error incomprensible para el auxiliar.
--   - Cambiar el estado de una fila ya escrita exige el permiso, siempre.
--   - Los datos de la correccion (valor, municipio, motivo) son inmutables:
--     `document_correction` es append-only (comentario de 070). Corregir una
--     correccion es insertar otra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_correccion_revision() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app.session_id() IS NOT NULL AND NEW.estado = 'aprobado' THEN
      IF app.tiene_permiso('documento.aprobar_correccion') THEN
        NEW.revisado_por := COALESCE(NEW.revisado_por, app.current_user_id());
        NEW.revisado_en  := COALESCE(NEW.revisado_en, now());
      ELSE
        NEW.estado       := 'pendiente_revision';
        NEW.revisado_por := NULL;
        NEW.revisado_en  := NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.tipo, NEW.linea_numero, NEW.valor_aiu_centavos, NEW.municipio_operacion_id,
      NEW.motivo, NEW.creado_por, NEW.source_document_id)
     IS DISTINCT FROM
     (OLD.tipo, OLD.linea_numero, OLD.valor_aiu_centavos, OLD.municipio_operacion_id,
      OLD.motivo, OLD.creado_por, OLD.source_document_id) THEN
    RAISE EXCEPTION 'CORRECCION_INMUTABLE: una correccion no se edita; se registra otra'
      USING ERRCODE = 'RL002';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF OLD.estado <> 'pendiente_revision' THEN
      RAISE EXCEPTION 'CORRECCION_YA_REVISADA: la correccion % ya esta en estado %', OLD.id, OLD.estado
        USING ERRCODE = 'RL002';
    END IF;
    PERFORM app.exigir_permiso('documento.aprobar_correccion');
    NEW.revisado_por := COALESCE(NEW.revisado_por, app.current_user_id());
    NEW.revisado_en  := COALESCE(NEW.revisado_en, now());
  END IF;

  RETURN NEW;
END $fn$;

-- Nombre elegido para que dispare DESPUES de `document_correction_permiso`
-- (orden alfabetico de triggers BEFORE): primero se comprueba que la sesion
-- puede tocar la tabla, y solo entonces se decide el estado.
CREATE TRIGGER document_correction_revision
  BEFORE INSERT OR UPDATE ON document_correction
  FOR EACH ROW EXECUTE FUNCTION app.trg_correccion_revision();

-- `revisado_por` es una FK nueva a `"user"`, y toda FK a una tabla con alcance
-- necesita su guardia (D-032): sin ella, una fila de la empresa A podria
-- declarar como revisor a un usuario de otra firma. La comprobacion de clave
-- foranea de PostgreSQL no pasa por RLS, asi que esto NO lo cubre la FK. El
-- guardia de 070 se reinstala con las TRES columnas porque
-- `instalar_guardia_alcance` crea un unico trigger por tabla.
DROP TRIGGER document_correction_fk_alcance ON document_correction;
SELECT app.instalar_guardia_alcance('document_correction',
  'municipio_operacion_id', 'municipality',
  'revisado_por',           'user',
  'creado_por',             'user');

SELECT app.instalar_trigger_auditoria('document_correction');


-- =============================================================================
-- F. FORZAR CAMBIO DE CONTRASENA (D-069, parte del modulo de administracion)
--
-- Un administrador que le fija una contrasena a otro usuario CONOCE esa
-- contrasena. Dejarla vivir indefinidamente convierte al administrador en
-- suplantador permanente de cualquiera de su firma. Con esta bandera, la
-- contrasena que fija el administrador sirve para UNA entrada y obliga a
-- cambiarla.
-- =============================================================================

ALTER TABLE "user" ADD COLUMN debe_cambiar_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "user".debe_cambiar_password IS
  'D-069: la contrasena actual la fijo un administrador. La sesion se abre, pero la aplicacion obliga a cambiarla antes de nada.';

-- -----------------------------------------------------------------------------
-- La bandera es parte de la CREDENCIAL PROPIA, no de la administracion.
--
-- `app.trg_permiso_usuario` (016) deja que un usuario actualice sus propias
-- columnas de credencial sin `usuario.administrar`, con una lista blanca de
-- columnas. `debe_cambiar_password` es nueva y no estaba en esa lista, asi que
-- apagarla —que es EXACTAMENTE lo que hace cambiar la propia contrasena—
-- exigia ser administrador. Resultado: la persona a la que se le acaba de fijar
-- una contrasena era la unica que no podia cumplir la obligacion.
--
-- Se reescribe la funcion entera (no hay forma de «anadir» a un array dentro de
-- una funcion ya creada) conservando el resto del predicado tal cual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_permiso_usuario() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $fn$
DECLARE
  v_cambios text[];
BEGIN
  IF app.session_id() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(n.key), '{}')
      INTO v_cambios
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

    -- Contabilidad del inicio de sesion.
    IF v_cambios <@ ARRAY['ultimo_acceso_en','intentos_fallidos','bloqueado_hasta','updated_at'] THEN
      RETURN NEW;
    END IF;

    -- Credenciales propias. `debe_cambiar_password` entra aqui (D-069): apagar
    -- la obligacion es el efecto de cumplirla, y solo se puede apagar cambiando
    -- de verdad la contrasena, porque el UPDATE viene junto con el hash nuevo.
    IF NEW.id = app.current_user_id()
       AND v_cambios <@ ARRAY['password_hash','password_algoritmo','password_actualizado_en',
                              'mfa_habilitado','mfa_secret_cifrado','mfa_secret_alg',
                              'mfa_confirmado_en','debe_cambiar_password','updated_at'] THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM app.exigir_permiso('usuario.administrar');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;

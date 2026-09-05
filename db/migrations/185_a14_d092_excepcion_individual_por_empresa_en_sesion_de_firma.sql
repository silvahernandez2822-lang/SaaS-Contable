-- =============================================================================
-- 185_a14_d092_excepcion_individual_por_empresa_en_sesion_de_firma.sql
-- A14, compuerta de CIERRE de D-092.
--
-- V-60. DEFECTO REAL, MEDIDO, INTRODUCIDO POR LA MIGRACION 183.
--
-- `app.tiene_permiso` de 183 resuelve la excepcion individual asi:
--
--   excepcion AS (
--     SELECT o.efecto FROM ... user_permission_override o
--      WHERE o.permission_codigo = p_codigo
--        AND (app.current_company_id() IS NULL OR o.company_id = app.current_company_id())
--        ...
--      ORDER BY o.otorgado_en DESC, o.id DESC LIMIT 1)
--
-- Con empresa en contexto es correcto. SIN empresa en contexto —la «sesion de
-- firma» de D-015/D-022, que es la que usa el LAYOUT RAIZ en TODA ruta— el
-- filtro por empresa desaparece y el `LIMIT 1` se queda con la excepcion mas
-- reciente DE CUALQUIER EMPRESA, que luego decide por toda la firma. El bloque
-- `accesos`, en cambio, hace lo contrario: sin empresa en contexto une TODAS
-- las empresas (`EXISTS ... WHERE por_rol`). Las dos mitades de la misma
-- funcion tienen semanticas opuestas, y la asimetria se midio en los dos
-- sentidos con un contador con acceso a DOS empresas de la misma firma:
--
--   · `documento.leer` REVOCADO solo en la empresa B
--       -> en A: true (lo da el rol)   en B: false   en SESION DE FIRMA: false
--     Una revocacion acotada a UNA empresa VETA la firma entera. Y eso no es
--     «una seccion menos»: `app.empresas_accesibles()` exige `documento.leer`,
--     asi que en la sesion de firma revienta con SE002, la aplicacion degrada a
--     `origen: 'sin_permiso'`, el selector de empresas del shell se queda VACIO
--     y el contador NO PUEDE SIQUIERA VOLVER A LA EMPRESA A, donde su permiso
--     esta intacto. Es el mismo bloqueo total que D-092-bis vino a cerrar,
--     por la puerta de al lado.
--   · `usuario.administrar` OTORGADO solo en la empresa B, sin rol que lo de
--       -> en A: false   en B: true   en SESION DE FIRMA: true
--     El otorgado SI se une. Otorgar propaga a la firma; revocar tambien, pero
--     al reves. Cual de las dos gana depende de `otorgado_en DESC`: es decir,
--     del ORDEN EN QUE SE ESCRIBIERON las excepciones de empresas distintas.
--     Una decision de permisos que depende de eso no es una regla.
--
-- QUE CAMBIA. La excepcion pasa a resolverse POR EMPRESA —una fila efectiva por
-- empresa, con `DISTINCT ON (company_id)`, que es exactamente la regla que ya
-- usa la vista `v_user_permission_efectivo` de 183— y el resultado se combina
-- con el rol DE ESA MISMA EMPRESA. Al final se agrega con un `EXISTS`: la
-- sesion de firma concede si hay AL MENOS UNA empresa donde el permiso se
-- concede. Esa es la semantica que la funcion ya tenia para los roles desde
-- 070; ahora la excepcion individual la comparte en vez de contradecirla.
--
-- QUE NO CAMBIA, y es lo importante:
--
--   · CON EMPRESA EN CONTEXTO el resultado es IDENTICO al de 183, caso por
--     caso: todopoderoso -> true; `revocado` -> false por encima del rol;
--     `otorgado` + acceso vigente -> true; si no, el rol. Ahi vive toda la
--     seguridad de D-092 (los triggers PO001..PO004 corren con empresa en
--     contexto) y ahi no se toca ni un bit. Hay prueba que lo recorre para
--     TODO el catalogo de `permission`, permiso por permiso.
--   · El rol todopoderoso sigue concediendo todo y ninguna excepcion se lo
--     quita.
--   · Una excepcion vencida o futura sigue sin contar (`otorgado_en <= now()`,
--     `vence_en IS NULL OR vence_en > now()`), y una vencida no concede NI
--     niega: manda el rol.
--   · Un rol inactivo (`role.activo`) sigue sin conceder nada.
--   · La firma, el nombre, el SQLSTATE y los privilegios de la funcion son los
--     mismos: es un `CREATE OR REPLACE` del cuerpo.
--   · `v_user_permission_efectivo` NO se toca: es por empresa por definicion
--     (tiene columna `company_id`), asi que ya contaba lo mismo que esta
--     funcion cuando hay empresa en contexto, que es cuando se comparan.
--
-- Por que no se «arregla» en la aplicacion: la aplicacion no puede. Quien
-- rechaza es el motor (`app.empresas_accesibles()` -> `exigir_permiso`), y
-- rodearlo desde TypeScript seria un filtro de aplicacion sobre una decision de
-- permisos — lo contrario de la Regla de Oro 7.
--
-- La 183 no se edita: esta aplicada y una migracion aplicada tiene checksum.
--
-- REGLA DE ORO 2: aqui no hay ni una tarifa, base, UVT, tope ni calendario.
-- Los unicos literales son nombres de columna y los dos valores del enum
-- `efecto` ('otorgado' / 'revocado'), que son identificadores del modelo.
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
    -- Un acceso vigente por (empresa, rol). Con empresa en contexto, solo la
    -- de contexto; sin ella, todas las de la firma — igual que en 070/183.
    accesos AS (
      SELECT a.company_id, r.es_todopoderoso,
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
    -- V-60: UNA excepcion efectiva POR EMPRESA (la mas reciente no vencida),
    -- no una sola para toda la firma. Misma regla que la vista de 183.
    excepcion AS (
      SELECT DISTINCT ON (o.company_id) o.company_id, o.efecto
        FROM ses
        JOIN public.user_permission_override o
          ON o.user_id   = ses.user_id
         AND o.tenant_id = ses.tenant_id
       WHERE o.permission_codigo = p_codigo
         AND (app.current_company_id() IS NULL OR o.company_id = app.current_company_id())
         AND o.otorgado_en <= now()
         AND (o.vence_en IS NULL OR o.vence_en > now())
       ORDER BY o.company_id, o.otorgado_en DESC, o.id DESC
    ),
    -- La decision, resuelta EN CADA EMPRESA con la excepcion de esa empresa y
    -- el rol de esa empresa. Misma precedencia de 183, sin mezclar empresas.
    por_empresa AS (
      SELECT CASE
               WHEN a.es_todopoderoso        THEN true
               WHEN x.efecto = 'revocado'    THEN false
               WHEN x.efecto = 'otorgado'    THEN true
               ELSE a.por_rol
             END AS concede
        FROM accesos a
        LEFT JOIN excepcion x ON x.company_id = a.company_id
    )
    SELECT EXISTS (SELECT 1 FROM por_empresa WHERE concede)
  $fn$;

COMMENT ON FUNCTION app.tiene_permiso(text) IS
  'D-066 + D-092 (183) + V-60 (185): la decision se resuelve POR EMPRESA y se agrega con EXISTS. En cada empresa: un rol es_todopoderoso concede cualquier permiso y ninguna excepcion se lo quita; por debajo manda la excepcion individual vigente de user_permission_override (la mas reciente no vencida DE ESA EMPRESA); por debajo, role_permission. Un rol inactivo no concede nada. Con empresa en contexto el resultado es identico al de 183; sin empresa (sesion de firma) concede si al menos una empresa concede, en vez de dejar que la excepcion mas reciente de cualquier empresa decida por toda la firma.';

-- `CREATE OR REPLACE` conserva el ACL, pero D-034 pide que toda migracion deje
-- el privilegio escrito donde se pueda leer: esta funcion la llama la aplicacion
-- (016), a diferencia de las funciones de trigger.
GRANT EXECUTE ON FUNCTION app.tiene_permiso(text) TO app_user;

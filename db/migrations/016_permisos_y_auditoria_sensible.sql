-- =============================================================================
-- 016_permisos_y_auditoria_sensible.sql — Agente A12, Ola 0
--
-- Dos cosas, ambas impuestas por el motor y no por la aplicación:
--
-- A. PERMISOS GRANULARES POR ROL. 014 dejó los 25 permisos y los 5 roles como
--    datos. Aquí se vuelven una restricción: un trigger `BEFORE` en cada tabla
--    de escritura exige el permiso correspondiente a la sesión en curso. Un
--    auxiliar de causación que intente tocar `tax_rule` recibe SE002 del motor;
--    un rol de solo lectura no escribe en ninguna parte.
--
--    Cuando NO hay sesión (migraciones, seeds de A1, tareas de plataforma) el
--    control se salta a propósito: ese camino corre con un rol privilegiado y
--    la garantía la da el privilegio, no el permiso de negocio. Un `app_user`
--    sin sesión tampoco pasa, pero lo detiene antes la RLS: sin sesión no hay
--    tenant y ninguna fila satisface la política.
--
-- B. AUDITORÍA DE LO SENSIBLE. 009 ya audita paramétricas, PUC, mapeo NIIF,
--    conceptos, aprobaciones y cambios de acceso. Faltaban el ledger, el cierre
--    de período, la empresa, la cuenta de usuario (con las credenciales
--    redactadas) y el acceso denegado a datos de otra empresa.
--
-- ORDEN DE DISPARO: PostgreSQL ejecuta los triggers `BEFORE` de fila en orden
-- alfabético. `<tabla>_permiso` queda después de `<tabla>_inmutable` y de
-- `<tabla>_before_insert`, y antes de `<tabla>_vigencia_append_only`. Es el
-- orden correcto: la inmutabilidad del ledger (LG001) se diagnostica antes que
-- la falta de permiso, y la falta de permiso antes que la mecánica de vigencias.
-- =============================================================================

-- =============================================================================
-- A. PERMISOS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ¿La sesión en curso tiene este permiso?
--
-- Se resuelve por los accesos vigentes del usuario de la sesión dentro de su
-- tenant. Si hay una empresa en contexto, solo cuentan los roles otorgados
-- sobre ESA empresa; si no la hay (edición de un parámetro de la firma, sin
-- empresa), cuenta cualquier acceso vigente del usuario en el tenant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tiene_permiso(p_codigo text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM app.session_context s
        JOIN app.acceso_usuario_empresa a
          ON a.user_id     = s.user_id
         AND a.tenant_id   = s.tenant_id
         AND a.revocado_en IS NULL
        JOIN public.role_permission rp ON rp.role_id = a.role_id
       WHERE s.token_hash  = app.hash_token(app.token_presentado())
         AND s.revocada_en IS NULL
         AND s.expira_en   > now()
         AND rp.permission_codigo = p_codigo
         AND (app.current_company_id() IS NULL OR a.company_id = app.current_company_id())
    )
  $$;

CREATE OR REPLACE FUNCTION app.exigir_permiso(p_codigo text) RETURNS void
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  -- Sin sesión no hay rol de negocio que evaluar: es el camino administrativo
  -- (migraciones, seeds, plataforma). La RLS sigue gobernando a app_user.
  IF app.session_id() IS NULL THEN
    RETURN;
  END IF;

  IF app.tiene_permiso(p_codigo) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION
    'PERMISO_INSUFICIENTE: la sesión del usuario % no tiene el permiso "%" sobre esta empresa',
    app.current_user_id(), p_codigo
    USING ERRCODE = 'SE002',
          HINT    = 'Los permisos de cada rol están en role_permission (migración 014). Consulte v_user_permission.';
END $$;

-- Trigger genérico: el permiso exigido viaja como argumento del trigger.
CREATE OR REPLACE FUNCTION app.trg_exigir_permiso() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  PERFORM app.exigir_permiso(TG_ARGV[0]);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.instalar_permiso_escritura(p_tabla text, p_permiso text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.trg_exigir_permiso(%L)',
    p_tabla || '_permiso', p_tabla, p_permiso);
END $$;

-- -----------------------------------------------------------------------------
-- Parametrización tributaria (sección 6.2, punto 5: solo el administrador
-- tributario y el de firma crean vigencias nuevas).
-- -----------------------------------------------------------------------------
SELECT app.instalar_permiso_escritura('tax_rule',              'parametro.editar');
SELECT app.instalar_permiso_escritura('tax_concept',           'parametro.editar');
SELECT app.instalar_permiso_escritura('tax_calendar',          'parametro.editar');
SELECT app.instalar_permiso_escritura('uvt_value',             'parametro.editar');
SELECT app.instalar_permiso_escritura('smmlv_value',           'parametro.editar');
SELECT app.instalar_permiso_escritura('rounding_rule',         'parametro.editar');
SELECT app.instalar_permiso_escritura('municipality',          'parametro.editar');
SELECT app.instalar_permiso_escritura('municipality_ica_rule', 'parametro.editar');
SELECT app.instalar_permiso_escritura('ciiu_activity',         'parametro.editar');

-- Plan de cuentas y mapeo NIIF (cambios de mapeo PUC, sección 14.1).
SELECT app.instalar_permiso_escritura('account',      'puc.editar');
SELECT app.instalar_permiso_escritura('niif_mapping', 'puc.editar');
SELECT app.instalar_permiso_escritura('cost_center',  'puc.editar');

-- Conceptos de causación y memoria de clasificación.
SELECT app.instalar_permiso_escritura('concepto_causacion',    'concepto.editar');
SELECT app.instalar_permiso_escritura('memoria_clasificacion', 'concepto.editar');

-- Terceros y sus atributos fiscales versionados.
SELECT app.instalar_permiso_escritura('third_party',                  'tercero.editar');
SELECT app.instalar_permiso_escritura('third_party_fiscal_attribute', 'tercero.editar');
SELECT app.instalar_permiso_escritura('third_party_activity',         'tercero.editar');

-- Documentos y extracción.
SELECT app.instalar_permiso_escritura('source_document', 'documento.cargar');
SELECT app.instalar_permiso_escritura('extraction',      'documento.cargar');

-- Causación.
SELECT app.instalar_permiso_escritura('retention_applied', 'causacion.crear');
SELECT app.instalar_permiso_escritura('journal_line',      'causacion.crear');

-- Aprobación humana obligatoria.
SELECT app.instalar_permiso_escritura('approval', 'causacion.aprobar');

-- Cierre de período.
SELECT app.instalar_permiso_escritura('fiscal_period', 'periodo.cerrar');

-- Administración de la firma.
SELECT app.instalar_permiso_escritura('company',         'empresa.administrar');
SELECT app.instalar_permiso_escritura('company_setting', 'empresa.administrar');
SELECT app.instalar_permiso_escritura('user_company_access', 'usuario.administrar');
SELECT app.instalar_permiso_escritura('role',                'usuario.administrar');
SELECT app.instalar_permiso_escritura('role_permission',     'usuario.administrar');

-- -----------------------------------------------------------------------------
-- journal_entry: el permiso depende de la transición, no de la tabla.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_permiso_journal_entry() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF app.session_id() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.reverses_entry_id IS NOT NULL THEN
      PERFORM app.exigir_permiso('causacion.reversar');
    ELSE
      PERFORM app.exigir_permiso('causacion.crear');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.estado = 'posted' AND OLD.estado <> 'posted' THEN
      PERFORM app.exigir_permiso('asiento.publicar');
    ELSE
      PERFORM app.exigir_permiso('causacion.editar_borrador');
    END IF;
    RETURN NEW;
  END IF;

  PERFORM app.exigir_permiso('causacion.reversar');
  RETURN OLD;
END $$;

CREATE TRIGGER journal_entry_permiso
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION app.trg_permiso_journal_entry();

-- -----------------------------------------------------------------------------
-- "user": administrar cuentas ajenas exige `usuario.administrar`, pero hay dos
-- escrituras legítimas que no son administración y no deben exigirlo:
--   1. la contabilidad del propio inicio de sesión (último acceso, intentos);
--   2. que un usuario cambie SU contraseña o configure SU segundo factor.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_permiso_usuario() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
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

    -- Contabilidad del inicio de sesión.
    IF v_cambios <@ ARRAY['ultimo_acceso_en','intentos_fallidos','bloqueado_hasta','updated_at'] THEN
      RETURN NEW;
    END IF;

    -- Credenciales propias.
    IF NEW.id = app.current_user_id()
       AND v_cambios <@ ARRAY['password_hash','password_algoritmo','password_actualizado_en',
                              'mfa_habilitado','mfa_secret_cifrado','mfa_secret_alg',
                              'mfa_confirmado_en','updated_at'] THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM app.exigir_permiso('usuario.administrar');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_permiso
  BEFORE INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION app.trg_permiso_usuario();

-- =============================================================================
-- B. AUDITORÍA DE ACCIONES SENSIBLES
-- =============================================================================

-- Ledger: creación, publicación y reversa quedan registradas (Regla de Oro 6).
SELECT app.instalar_trigger_auditoria('journal_entry');
-- Cierre de período fiscal.
SELECT app.instalar_trigger_auditoria('fiscal_period');
-- Configuración de la empresa-cliente.
SELECT app.instalar_trigger_auditoria('company');

-- -----------------------------------------------------------------------------
-- "user": se audita, pero NUNCA con las credenciales dentro. Un audit_log que
-- copiara `password_hash` convertiría el registro de auditoría en el botín.
-- Las escrituras de pura contabilidad de sesión no generan ruido: el inicio de
-- sesión ya se registra como LOGIN desde app.abrir_sesion().
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_audit_usuario() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_old     jsonb;
  v_new     jsonb;
  v_row     jsonb;
  v_cambios text[];
  k         text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(n.key), '{}')
      INTO v_cambios
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF v_cambios <@ ARRAY['ultimo_acceso_en','intentos_fallidos','bloqueado_hasta','updated_at'] THEN
      RETURN NULL;
    END IF;
  END IF;

  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

  FOREACH k IN ARRAY ARRAY['password_hash','mfa_secret_cifrado'] LOOP
    IF v_old IS NOT NULL AND v_old ? k THEN
      v_old := jsonb_set(v_old, ARRAY[k], to_jsonb('[redactado]'::text));
    END IF;
    IF v_new IS NOT NULL AND v_new ? k THEN
      v_new := jsonb_set(v_new, ARRAY[k], to_jsonb('[redactado]'::text));
    END IF;
  END LOOP;

  v_row := COALESCE(v_new, v_old);

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_anterior, valor_nuevo, ip, user_agent, request_id)
  VALUES (COALESCE(NULLIF(v_row->>'tenant_id','')::uuid, app.current_tenant_id()),
          app.current_company_id(),
          app.current_user_id(),
          TG_OP, TG_TABLE_NAME, v_row->>'id',
          v_old, v_new,
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id());

  RETURN NULL;
END $$;

CREATE TRIGGER user_audit
  AFTER INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION app.trg_audit_usuario();

-- -----------------------------------------------------------------------------
-- Acceso denegado a datos de otra empresa (sección 14.1, cuarto punto).
--
-- `app.current_company_id()` ya devuelve NULL cuando la sesión pide una empresa
-- sobre la que no tiene acceso, y la RLS hace el resto: cero filas. Pero cero
-- filas en silencio no es un registro de auditoría. Esta función deja la huella
-- explícita, y la levanta la capa de servicio ANTES de abrir el contexto de
-- trabajo, en su propia transacción, para que el registro sobreviva al rechazo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.registrar_acceso_denegado(
  p_entidad    text,
  p_entidad_id text,
  p_motivo     text
) RETURNS bigint
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_id bigint;
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesión que registrar'
      USING ERRCODE = 'SE001';
  END IF;

  INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                         valor_nuevo, ip, user_agent, request_id)
  VALUES (app.current_tenant_id(), NULL, app.current_user_id(),
          'ACCESO_DENEGADO', p_entidad, p_entidad_id,
          jsonb_build_object('motivo', p_motivo),
          app.current_ip(),
          NULLIF(current_setting('app.user_agent', true), ''),
          app.current_request_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Exige que la empresa pedida esté autorizada; si no, deja huella y rechaza.
CREATE OR REPLACE FUNCTION app.exigir_empresa(p_company_id uuid) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF app.session_id() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA: no hay sesión vigente'
      USING ERRCODE = 'SE001';
  END IF;

  IF p_company_id IS NOT NULL AND app.current_company_id() IS DISTINCT FROM p_company_id THEN
    PERFORM app.registrar_acceso_denegado(
      'company', p_company_id::text,
      'la sesión pidió operar sobre una empresa sobre la que no tiene acceso vigente');
    RAISE EXCEPTION
      'EMPRESA_NO_AUTORIZADA: la sesión no tiene acceso vigente a la empresa %', p_company_id
      USING ERRCODE = 'SE003';
  END IF;

  RETURN app.current_company_id();
END $$;

-- =============================================================================
-- PRIVILEGIOS
-- =============================================================================

-- El registro de sesiones visible lo escriben las funciones de 015, no la
-- aplicación: así el espejo no puede desviarse de app.session_context a mano.
REVOKE INSERT, UPDATE, DELETE ON user_session FROM app_user;

-- Instaladores de DDL: no son API de aplicación (mismo criterio que 013).
REVOKE EXECUTE ON FUNCTION app.instalar_permiso_escritura(text, text) FROM PUBLIC, app_user, app_auth;

GRANT EXECUTE ON FUNCTION app.tiene_permiso(text)                          TO app_user;
GRANT EXECUTE ON FUNCTION app.exigir_permiso(text)                         TO app_user;
GRANT EXECUTE ON FUNCTION app.exigir_empresa(uuid)                         TO app_user;
GRANT EXECUTE ON FUNCTION app.registrar_acceso_denegado(text, text, text)  TO app_user;

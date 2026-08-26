-- =============================================================================
-- 001_fundacion.sql — Agente A2, Ola 0
-- Esquema auxiliar `app`, rol de aplicación, funciones de contexto de tenant
-- y funciones de trigger genéricas reutilizadas por el resto de migraciones.
--
-- CÓDIGOS DE ERROR PROPIOS (SQLSTATE). Las pruebas verifican estos códigos,
-- no mensajes de la aplicación:
--   LG001  LEDGER_INMUTABLE          UPDATE/DELETE sobre asiento publicado
--   LG002  ASIENTO_DESBALANCEADO     débitos <> créditos al publicar
--   LG003  ASIENTO_SIN_PARTIDAS      asiento publicado con menos de 2 partidas
--   LG004  CUENTA_NO_IMPUTABLE       partida contra cuenta que no permite movimiento
--   LG005  PERIODO_CERRADO           publicación sobre período fiscal no abierto
--   LG006  ASIENTO_SIN_APROBACION    publicación sin aprobación 'aprobado'
--   LG007  ASIENTO_DEBE_NACER_BORRADOR  INSERT directo en estado 'posted'
--   LG008  REVERSA_INVALIDA          reversa mal referenciada
--   PR001  VIGENCIA_INMUTABLE        UPDATE de un valor paramétrico ya vigente
--   PR002  VIGENCIA_SOLAPADA         dos vigencias activas para la misma clave
--   PR003  VIGENCIA_NO_BORRABLE      DELETE de una vigencia que ya estuvo vigente
--   AU001  AUDITORIA_INMUTABLE       UPDATE/DELETE sobre audit_log
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
  'Funciones de infraestructura: contexto de tenant, triggers genéricos de '
  'inmutabilidad y vigencias. No contiene datos de negocio.';

-- -----------------------------------------------------------------------------
-- Rol de aplicación (D-004): la aplicación NUNCA se conecta como superusuario.
-- Un superusuario ignora RLS en silencio; probar aislamiento desde una sesión
-- superusuario produce un falso PASS.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA app    TO app_user;

-- Privilegios por defecto para todo lo que creen las migraciones siguientes.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO app_user;

-- -----------------------------------------------------------------------------
-- Contexto de sesión. Lo fija `withTenantContext` (src/db/tenant-context.ts)
-- con set_config(..., true) => local a la transacción.
-- Devuelven NULL si no hay contexto: así una consulta sin contexto ve 0 filas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_company_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_ip() RETURNS inet
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.ip', true), '')::inet $$;

CREATE OR REPLACE FUNCTION app.current_request_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.request_id', true), '') $$;

-- -----------------------------------------------------------------------------
-- Resolución por vigencia (Regla de Oro 3). El motor (A3) resuelve SIEMPRE por
-- la fecha del hecho económico, nunca por la fecha de proceso.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.esta_vigente(
  p_vigente_desde date,
  p_vigente_hasta date,
  p_fecha_hecho   date
) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT p_fecha_hecho >= p_vigente_desde
       AND (p_vigente_hasta IS NULL OR p_fecha_hecho <= p_vigente_hasta)
  $$;

CREATE OR REPLACE FUNCTION app.rango_vigencia(
  p_vigente_desde date,
  p_vigente_hasta date
) RETURNS daterange
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT daterange(p_vigente_desde, COALESCE(p_vigente_hasta, 'infinity'::date), '[]') $$;

-- -----------------------------------------------------------------------------
-- updated_at automático (solo tablas operativas; las paramétricas no se editan)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- Append-only puro: ni UPDATE ni DELETE. Usado por audit_log.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'AUDITORIA_INMUTABLE: % es append-only; % está prohibido a nivel de base de datos',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'AU001';
END $$;

-- -----------------------------------------------------------------------------
-- Vigencias append-only (sección 6.2 del mega-prompt):
--   1. Editar un parámetro NUNCA hace UPDATE del valor.
--   2. Lo único que puede cambiar en una fila existente es `vigente_hasta`,
--      y solo para cerrarla (de NULL a una fecha >= vigente_desde).
--   3. Una vigencia que ya empezó no se puede borrar. Una vigencia futura sí
--      (cancelar un cambio programado que aún no surtió efecto).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_vigencia_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.vigente_desde <= CURRENT_DATE THEN
      RAISE EXCEPTION
        'VIGENCIA_NO_BORRABLE: la fila % de % rige desde % y ya surtió efecto; ciérrela con vigente_hasta en vez de borrarla',
        OLD.id, TG_TABLE_NAME, OLD.vigente_desde
        USING ERRCODE = 'PR003';
    END IF;
    RETURN OLD;
  END IF;

  -- Todo lo que no sea `vigente_hasta` debe quedar idéntico.
  -- `clave_vigencia` se excluye porque es una columna GENERATED: en un trigger
  -- BEFORE todavía no está calculada en NEW y siempre parecería un cambio. No
  -- se pierde control: se deriva de columnas que sí se comparan.
  v_old := to_jsonb(OLD) - 'vigente_hasta' - 'clave_vigencia';
  v_new := to_jsonb(NEW) - 'vigente_hasta' - 'clave_vigencia';
  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION
      'VIGENCIA_INMUTABLE: en % solo se permite cerrar la vigencia (vigente_hasta). Para cambiar un valor inserte una vigencia nueva (fila %).',
      TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'PR001';
  END IF;

  IF NEW.vigente_hasta IS DISTINCT FROM OLD.vigente_hasta THEN
    IF OLD.vigente_hasta IS NOT NULL THEN
      RAISE EXCEPTION
        'VIGENCIA_INMUTABLE: la vigencia % de % ya está cerrada en % y no se puede reabrir ni mover',
        OLD.id, TG_TABLE_NAME, OLD.vigente_hasta
        USING ERRCODE = 'PR001';
    END IF;
    IF NEW.vigente_hasta IS NULL THEN
      RAISE EXCEPTION
        'VIGENCIA_INMUTABLE: no se puede reabrir la vigencia % de %',
        OLD.id, TG_TABLE_NAME
        USING ERRCODE = 'PR001';
    END IF;
    IF NEW.vigente_hasta < OLD.vigente_desde THEN
      RAISE EXCEPTION
        'VIGENCIA_INMUTABLE: vigente_hasta (%) es anterior a vigente_desde (%) en %',
        NEW.vigente_hasta, OLD.vigente_desde, TG_TABLE_NAME
        USING ERRCODE = 'PR001';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- Dos vigencias activas para la misma clave lógica en fechas que se solapan
-- harían no determinista la resolución del motor de reglas. Se prohíbe.
--
-- Se implementa con trigger y no con EXCLUDE porque `btree_gist` NO está
-- disponible en PGlite (verificado 2026-08-26: "extension btree_gist is not
-- available"), y una restricción que solo exista en producción no sirve.
--
-- Es AFTER y no BEFORE porque `clave_vigencia` es una columna GENERATED, que
-- Postgres calcula después de los triggers BEFORE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_vigencia_sin_solape() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_existe boolean;
BEGIN
  EXECUTE format(
    'SELECT EXISTS (
       SELECT 1 FROM %I.%I t
        WHERE t.clave_vigencia = $1
          AND t.id <> $2
          AND app.rango_vigencia(t.vigente_desde, t.vigente_hasta)
              && app.rango_vigencia($3, $4)
     )', TG_TABLE_SCHEMA, TG_TABLE_NAME)
  INTO v_existe
  USING NEW.clave_vigencia, NEW.id, NEW.vigente_desde, NEW.vigente_hasta;

  IF v_existe THEN
    RAISE EXCEPTION
      'VIGENCIA_SOLAPADA: en % ya existe una vigencia para la clave "%" que se cruza con el rango % .. %',
      TG_TABLE_NAME, NEW.clave_vigencia, NEW.vigente_desde,
      COALESCE(NEW.vigente_hasta::text, 'indefinida')
      USING ERRCODE = 'PR002';
  END IF;

  RETURN NULL;
END $$;

-- Atajo para no repetir 8 veces el mismo par de CREATE TRIGGER.
CREATE OR REPLACE FUNCTION app.instalar_triggers_vigencia(p_tabla text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.trg_vigencia_append_only()',
    p_tabla || '_vigencia_append_only', p_tabla);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.trg_vigencia_sin_solape()',
    p_tabla || '_vigencia_sin_solape', p_tabla);
END $$;

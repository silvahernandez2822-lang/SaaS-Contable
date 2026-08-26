-- =============================================================================
-- 002_organizacion.sql — Estructura organizacional (sección 15)
--   tenant (firma contable) -> company (empresa-cliente) -> fiscal_period
--   "user", role, permission, role_permission, user_company_access
--
-- NOTA sobre el nombre `"user"`: `user` es palabra reservada en PostgreSQL.
-- D-006 obliga a usar los nombres literales de la sección 15, así que la tabla
-- se llama `"user"` y SIEMPRE debe ir entrecomillada. Sin comillas, `FROM user`
-- se interpreta como la función USER y falla de inmediato (error 42703), nunca
-- en silencio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenant — la firma contable. Raíz del aislamiento.
-- -----------------------------------------------------------------------------
CREATE TABLE tenant (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit                 text NOT NULL,
  razon_social        text NOT NULL,
  nombre_comercial    text,
  email_contacto      text NOT NULL,
  estado              text NOT NULL DEFAULT 'activo'
                        CHECK (estado IN ('activo', 'suspendido', 'cancelado')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_nit_uq UNIQUE (nit)
);

COMMENT ON TABLE tenant IS 'Firma contable. Nivel 1 del aislamiento multi-tenant (Regla de Oro 7).';

-- -----------------------------------------------------------------------------
-- company — la empresa-cliente de la firma. Nivel 2 del aislamiento.
-- -----------------------------------------------------------------------------
CREATE TABLE company (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  nit                       text NOT NULL,
  digito_verificacion       smallint CHECK (digito_verificacion BETWEEN 0 AND 9),
  razon_social              text NOT NULL,
  nombre_comercial          text,
  direccion                 text,
  municipality_id           uuid,   -- FK en 005 (municipality se crea después)
  ciiu_principal_id         uuid,   -- FK en 005
  -- Atributos fiscales de la empresa (determinan si es agente de retención)
  regimen                   text NOT NULL DEFAULT 'ordinario'
                              CHECK (regimen IN ('ordinario', 'simple', 'no_responsable_iva')),
  es_gran_contribuyente     boolean NOT NULL DEFAULT false,
  es_autorretenedor_renta   boolean NOT NULL DEFAULT false,
  es_agente_retencion_renta boolean NOT NULL DEFAULT true,
  es_agente_retencion_iva   boolean NOT NULL DEFAULT false,
  es_agente_retencion_ica   boolean NOT NULL DEFAULT false,
  es_responsable_iva        boolean NOT NULL DEFAULT true,
  -- Canal de ingest (sección 10.1): buzón dedicado por empresa
  buzon_email               text,
  estado                    text NOT NULL DEFAULT 'activa'
                              CHECK (estado IN ('activa', 'suspendida', 'archivada')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_tenant_nit_uq UNIQUE (tenant_id, nit),
  CONSTRAINT company_buzon_uq      UNIQUE (buzon_email),
  -- Permite FK compuestas (id, tenant_id) desde las tablas hijas.
  CONSTRAINT company_id_tenant_uq  UNIQUE (id, tenant_id)
);

CREATE INDEX company_tenant_idx ON company (tenant_id);

COMMENT ON TABLE company IS 'Empresa-cliente. Nivel 2 del aislamiento. `company_id` es el segundo eje de toda política RLS.';

-- -----------------------------------------------------------------------------
-- fiscal_period — período contable. Un asiento no se publica en período cerrado.
-- -----------------------------------------------------------------------------
CREATE TABLE fiscal_period (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  company_id    uuid NOT NULL REFERENCES company(id),
  anio          smallint NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  mes           smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  fecha_inicio  date NOT NULL,
  fecha_fin     date NOT NULL,
  estado        text NOT NULL DEFAULT 'abierto'
                  CHECK (estado IN ('abierto', 'cerrado', 'bloqueado')),
  cerrado_en    timestamptz,
  cerrado_por   uuid,   -- FK a "user" más abajo
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_period_uq        UNIQUE (company_id, anio, mes),
  CONSTRAINT fiscal_period_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT fiscal_period_rango_ck  CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT fiscal_period_tenant_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id)
);

CREATE INDEX fiscal_period_scope_idx ON fiscal_period (tenant_id, company_id, anio, mes);

-- -----------------------------------------------------------------------------
-- "user" — usuario de la firma. Pertenece a un tenant, no a una company:
-- el acceso por empresa se otorga en user_company_access.
-- Sesiones y MFA los implementa A12; aquí queda el espacio.
-- -----------------------------------------------------------------------------
CREATE TABLE "user" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  email             text NOT NULL,
  nombre_completo   text NOT NULL,
  documento         text,
  -- Credenciales: A12 define el algoritmo. Aquí solo el espacio y el hash.
  password_hash     text,
  password_actualizado_en timestamptz,
  mfa_habilitado    boolean NOT NULL DEFAULT false,
  mfa_secret_cifrado text,
  estado            text NOT NULL DEFAULT 'activo'
                      CHECK (estado IN ('activo', 'suspendido', 'invitado', 'inactivo')),
  ultimo_acceso_en  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_uq      UNIQUE (email),
  CONSTRAINT user_id_tenant_uq  UNIQUE (id, tenant_id),
  CONSTRAINT user_email_ck      CHECK (email = lower(email))
);

CREATE INDEX user_tenant_idx ON "user" (tenant_id);

ALTER TABLE fiscal_period
  ADD CONSTRAINT fiscal_period_cerrado_por_fk FOREIGN KEY (cerrado_por) REFERENCES "user"(id);

-- -----------------------------------------------------------------------------
-- user_session — reservada para A12 (sesiones, refresh, revocación).
-- A2 solo deja el esquema y los permisos; A12 implementa el flujo.
-- -----------------------------------------------------------------------------
CREATE TABLE user_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  user_id       uuid NOT NULL REFERENCES "user"(id),
  token_hash    text NOT NULL,
  emitida_en    timestamptz NOT NULL DEFAULT now(),
  expira_en     timestamptz NOT NULL,
  revocada_en   timestamptz,
  mfa_superado  boolean NOT NULL DEFAULT false,
  ip            inet,
  user_agent    text,
  CONSTRAINT user_session_token_uq UNIQUE (token_hash),
  CONSTRAINT user_session_tenant_fk FOREIGN KEY (user_id, tenant_id)
    REFERENCES "user" (id, tenant_id)
);

CREATE INDEX user_session_user_idx ON user_session (user_id);

COMMENT ON TABLE user_session IS 'Espacio reservado para A12 (Ola 0, seguridad). A2 no implementa el flujo de sesión.';

-- -----------------------------------------------------------------------------
-- permission — catálogo global de permisos granulares. Es código, no dato de
-- negocio: no tiene tenant y app_user solo lo lee.
-- -----------------------------------------------------------------------------
CREATE TABLE permission (
  codigo      text PRIMARY KEY,
  nombre      text NOT NULL,
  descripcion text NOT NULL,
  modulo      text NOT NULL
);

-- -----------------------------------------------------------------------------
-- role — los cinco roles mínimos de la sección 14.1 llegan como filas globales
-- (tenant_id NULL). Una firma puede definir roles propios (tenant_id = suyo).
-- -----------------------------------------------------------------------------
CREATE TABLE role (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenant(id),   -- NULL = rol global del sistema
  codigo       text NOT NULL,
  nombre       text NOT NULL,
  descripcion  text NOT NULL,
  es_sistema   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_codigo_uq UNIQUE NULLS NOT DISTINCT (tenant_id, codigo)
);

CREATE TABLE role_permission (
  role_id           uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_codigo text NOT NULL REFERENCES permission(codigo),
  PRIMARY KEY (role_id, permission_codigo)
);

-- -----------------------------------------------------------------------------
-- user_company_access — qué usuario entra a qué empresa y con qué rol.
-- -----------------------------------------------------------------------------
CREATE TABLE user_company_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  company_id   uuid NOT NULL REFERENCES company(id),
  user_id      uuid NOT NULL REFERENCES "user"(id),
  role_id      uuid NOT NULL REFERENCES role(id),
  otorgado_por uuid REFERENCES "user"(id),
  otorgado_en  timestamptz NOT NULL DEFAULT now(),
  revocado_en  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uca_uq UNIQUE (company_id, user_id, role_id),
  CONSTRAINT uca_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT uca_user_fk FOREIGN KEY (user_id, tenant_id)
    REFERENCES "user" (id, tenant_id)
);

CREATE INDEX uca_user_idx    ON user_company_access (user_id);
CREATE INDEX uca_company_idx ON user_company_access (tenant_id, company_id);

COMMENT ON CONSTRAINT uca_user_fk ON user_company_access IS
  'FK compuesta: un usuario nunca puede recibir acceso a una empresa de otro tenant, ni con RLS desactivada.';

-- updated_at automático
CREATE TRIGGER tenant_updated_at   BEFORE UPDATE ON tenant   FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER company_updated_at  BEFORE UPDATE ON company  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER fiscal_period_updated_at BEFORE UPDATE ON fiscal_period FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER user_updated_at     BEFORE UPDATE ON "user"   FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER role_updated_at     BEFORE UPDATE ON role     FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
CREATE TRIGGER uca_updated_at      BEFORE UPDATE ON user_company_access FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

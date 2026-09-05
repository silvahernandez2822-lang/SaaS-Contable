/**
 * Harness de base de datos compartido por TODOS los agentes.
 *
 * Qué hace:
 *  - Levanta una base limpia (PGlite en memoria) o se conecta a la de
 *    `DATABASE_URL` si existe, sin que la prueba cambie una línea.
 *  - Aplica las migraciones reales de `db/migrations/`. Nunca hay un esquema
 *    "de pruebas" distinto del de producción.
 *  - Garantiza los roles `app_user` y `app_auth` con sus GRANTs y sus REVOKEs.
 *  - Expone `asTenant(...)` (corre como app_user, con RLS activa y una sesión
 *    REAL emitida por `app.abrir_sesion`) y `asAdmin(...)` (superusuario, para
 *    el montaje del escenario).
 *
 * CAMBIO DE A12 RESPECTO A LA VERSIÓN DE A2 (cierre de D-020): `asTenant` ya no
 * fija `app.tenant_id`. Emite una sesión de verdad y presenta su token; el
 * tenant lo deriva la base de datos. Fijar `app.tenant_id` a mano no tiene
 * ningún efecto, y hay una prueba que lo demuestra.
 *
 * Por defecto la sesión usa el rol de negocio `admin_firma`, para que las
 * pruebas que no tratan sobre permisos no tengan que declararlos. Para probar
 * permisos, pase `rolCodigo` en las opciones.
 *
 * Regla que no se negocia (D-004): toda prueba de aislamiento debe correr
 * dentro de `asTenant`. Dentro de `asAdmin` se es superusuario y el motor
 * ignora RLS, así que una prueba de aislamiento ahí da un falso PASS.
 *
 * LIMITACIÓN CONOCIDA DEL ENTORNO DE PRUEBAS (D-024): en PGlite la conexión
 * subyacente es superusuario y `SET LOCAL ROLE app_user` es una degradación
 * REVERSIBLE — desde dentro de `asTenant` se puede hacer `RESET ROLE` y volver
 * a ser superusuario. Es decir: estas pruebas demuestran que las políticas
 * funcionan, no que la aplicación no pueda saltárselas. En producción la
 * aplicación se conecta con un rol de login que ES `app_user`, y ahí
 * `RESET ROLE` no lleva a ninguna parte.
 */
import { createDb } from '../../src/db/client';
import { migrate } from '../../src/db/migrate';
import { ROL_APLICACION, withSessionContext } from '../../src/db/tenant-context';
import { isPostgresError } from '../../src/db/types';
import type { DbHandle, PostgresError, SqlClient } from '../../src/db/types';
import { generarTokenSesion } from '../../src/auth/sesion';
import { ROLES } from '../../src/auth/permisos';

/** Opciones de una sesión de prueba. */
export interface OpcionesTenant {
  /** Usuario dueño de la sesión. Si falta, el harness crea uno técnico. */
  userId?: string | null;
  /** IP que verá el audit_log. */
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** Rol de BASE DE DATOS. Por defecto `app_user`. */
  role?: string;
  /** Rol de NEGOCIO por código: admin_firma, contador, auxiliar_causacion... */
  rolCodigo?: string;
  /** Rol de negocio por id. Tiene prioridad sobre `rolCodigo`. */
  rolId?: string;
  /** Minutos de vigencia de la sesión emitida. */
  minutos?: number;
  /** Fuerza emitir una sesión nueva en vez de reutilizar la del caché. */
  sesionNueva?: boolean;
}

export interface TestDb {
  readonly driver: 'pglite' | 'postgres';
  /** Cliente crudo. Úselo solo si necesita algo fuera de asAdmin/asTenant. */
  readonly client: DbHandle;
  /** Superusuario / dueño del esquema. Ignora RLS: solo para montar datos. */
  asAdmin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  /** Rol `app_user` con una sesión real emitida y RLS activa. */
  asTenant<T>(
    tenantId: string,
    companyId: string | null,
    fn: (tx: SqlClient) => Promise<T>,
    extra?: OpcionesTenant,
  ): Promise<T>;
  /** Emite una sesión y devuelve su token, sin ejecutar nada. */
  emitirSesion(
    tenantId: string,
    companyId: string | null,
    extra?: OpcionesTenant,
  ): Promise<{ token: string; userId: string; sessionId: string }>;
  close(): Promise<void>;
}

/**
 * Los roles y sus privilegios ya los crean `001_fundacion.sql`,
 * `013_grants.sql`, `015` y `016`. Esto los reafirma para que el harness
 * funcione también contra una base preexistente cuya migración se aplicó con
 * otro usuario. Los REVOKE van DESPUÉS de los GRANT masivos: si no, un
 * `GRANT ... ON ALL FUNCTIONS` le devolvería a `app_user` la capacidad de
 * emitir sesiones, que es justo lo que 015 le quita.
 */
async function asegurarRolesAplicacion(db: DbHandle): Promise<void> {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROL_APLICACION}') THEN
        CREATE ROLE ${ROL_APLICACION} NOLOGIN NOBYPASSRLS NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
        CREATE ROLE app_auth NOLOGIN NOBYPASSRLS NOINHERIT;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO ${ROL_APLICACION}, app_auth;
    GRANT USAGE ON SCHEMA app    TO ${ROL_APLICACION}, app_auth;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO ${ROL_APLICACION};
    GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO ${ROL_APLICACION};
    GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA app    TO ${ROL_APLICACION};

    REVOKE UPDATE, DELETE          ON audit_log        FROM ${ROL_APLICACION};
    REVOKE INSERT, UPDATE, DELETE  ON permission       FROM ${ROL_APLICACION};
    REVOKE ALL                     ON schema_migration FROM ${ROL_APLICACION};

    -- A12: el rol de las peticiones no emite sesiones ni lee credenciales.
    REVOKE INSERT, UPDATE, DELETE ON user_session FROM ${ROL_APLICACION};

    -- A2 (018): el guardia de alcance es SECURITY DEFINER. El privilegio
    -- EXECUTE de una función de trigger se comprueba al CREAR el trigger, no al
    -- dispararlo, así que revocarlo no lo desactiva y sí lo saca de la
    -- superficie de funciones DEFINER invocables por la aplicación.
    REVOKE ALL ON FUNCTION app.trg_fk_alcance() FROM PUBLIC, ${ROL_APLICACION};

    -- A12 (D-092, migración 183): mismo caso que \`trg_fk_alcance\`. Las cuatro
    -- funciones de trigger de 183 —dos de ellas SECURITY DEFINER— se revocan en
    -- la migración, y el GRANT masivo de arriba se las devolvería. D-034: todo
    -- REVOKE de una migración se espeja aquí, o el banco de pruebas queda más
    -- permisivo que producción y el inventario de \`evasion.test.ts\` mide una
    -- superficie que no es la real.
    REVOKE ALL ON FUNCTION app.trg_override_blindaje()            FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.trg_override_append_only()         FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.trg_role_permission_no_escalar()   FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.trg_acceso_no_escalar()            FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM ${ROL_APLICACION}, app_auth;
    REVOKE ALL ON FUNCTION app.abrir_sesion(uuid, text, inet, text, boolean, integer)
      FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.buscar_credencial(text) FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.registrar_login_fallido(text, uuid, uuid, text, inet, text)
      FROM PUBLIC, ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.contar_intento_fallido(uuid) FROM PUBLIC, ${ROL_APLICACION};

    -- A13 (090): autenticar un token de integración es del camino de
    -- autenticación, igual que buscar_credencial/abrir_sesion (D-023) — el
    -- GRANT masivo de arriba se lo devolvería a ${ROL_APLICACION} si no se
    -- revocara aquí también (D-034: todo REVOKE de una migración se espeja
    -- en el harness o el banco de pruebas queda más permisivo que producción).
    REVOKE ALL ON FUNCTION app.autenticar_token_integracion(text) FROM PUBLIC, ${ROL_APLICACION};

    -- A12 (100, cierre de V-1): app.resolver_empresa_por_buzon ya no es
    -- ejecutable por ningún rol de aplicación. Su GRANT original (032) se
    -- concedió con el argumento de que "no cruza firmas"; A14 midió que sí,
    -- porque el buzón ES el parámetro que identifica al tenant. El espejo
    -- aquí es obligatorio (D-034): sin él, el GRANT masivo ON ALL FUNCTIONS
    -- de arriba se lo devuelve y el banco de pruebas seguiría demostrando la
    -- fuga que producción ya no tiene.
    REVOKE ALL ON FUNCTION app.resolver_empresa_por_buzon(text)
      FROM PUBLIC, ${ROL_APLICACION}, app_auth;

    REVOKE ALL ON FUNCTION app.instalar_permiso_escritura(text, text)
      FROM PUBLIC, ${ROL_APLICACION}, app_auth;
    REVOKE ALL ON FUNCTION app.instalar_triggers_vigencia(text)  FROM ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.instalar_trigger_auditoria(text)  FROM ${ROL_APLICACION};

    -- A14: estos cuatro REVOKE los hace 013_grants.sql y el GRANT masivo de
    -- arriba los deshacía, dejando el harness MÁS permisivo que producción. Un
    -- REVOKE que faltara en una migración no lo habría detectado ninguna prueba.
    REVOKE ALL ON FUNCTION app.instalar_rls_tenant_company(text) FROM ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.instalar_rls_tenant(text)         FROM ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.instalar_rls_hibrida(text)        FROM ${ROL_APLICACION};
    REVOKE ALL ON FUNCTION app.instalar_rls_hibrida_tenant(text) FROM ${ROL_APLICACION};

    -- A14 (017): la coherencia (usuario, firma) es del camino de autenticación.
    REVOKE ALL   ON FUNCTION app.usuario_pertenece(uuid, uuid) FROM PUBLIC, ${ROL_APLICACION};
    GRANT EXECUTE ON FUNCTION app.usuario_pertenece(uuid, uuid) TO app_auth;

    -- A6 (040): reclamar/completar/fallar un trabajo de la cola son del
    -- worker de plataforma (withAdminContext), nunca de la sesión de negocio.
    -- Sin este REVOKE, el GRANT masivo de arriba le devolvería a
    -- ${ROL_APLICACION} la capacidad de fabricar "completado" sobre el
    -- trabajo de otra firma sin pasar por RLS (D-034: todo REVOKE nuevo de
    -- una migración hay que espejarlo aquí o el banco de pruebas queda más
    -- permisivo que producción).
    REVOKE ALL ON FUNCTION app.reclamar_siguiente_job(text)    FROM PUBLIC, ${ROL_APLICACION}, app_auth;
    REVOKE ALL ON FUNCTION app.completar_job(uuid, jsonb)      FROM PUBLIC, ${ROL_APLICACION}, app_auth;
    REVOKE ALL ON FUNCTION app.fallar_job(uuid, text, integer) FROM PUBLIC, ${ROL_APLICACION}, app_auth;

    -- A12: alcance de app_auth, exactamente autenticar y nada más.
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_auth;
    GRANT SELECT ON "user"    TO app_auth;
    GRANT INSERT ON audit_log TO app_auth;
    -- A13 (091): registrar una llamada de integración que NO se autenticó
    -- (integration_call_log, tenant_id NULL) es del mismo perímetro que
    -- ACCESO_DENEGADO en audit_log — el REVOKE ALL de arriba se lo quita si
    -- no se vuelve a conceder aquí (D-034).
    GRANT INSERT ON integration_call_log TO app_auth;
    GRANT USAGE  ON ALL SEQUENCES IN SCHEMA public TO app_auth;
    GRANT EXECUTE ON FUNCTION app.abrir_sesion(uuid, text, inet, text, boolean, integer) TO app_auth;
    GRANT EXECUTE ON FUNCTION app.buscar_credencial(text)                                TO app_auth;
    GRANT EXECUTE ON FUNCTION app.registrar_login_fallido(text, uuid, uuid, text, inet, text) TO app_auth;
    GRANT EXECUTE ON FUNCTION app.contar_intento_fallido(uuid)                           TO app_auth;
    GRANT EXECUTE ON FUNCTION app.sesion_actual()                     TO app_auth;
    GRANT EXECUTE ON FUNCTION app.hash_token(text)                    TO app_auth;
    GRANT EXECUTE ON FUNCTION app.token_presentado()                  TO app_auth;
    GRANT EXECUTE ON FUNCTION app.current_tenant_id()                 TO app_auth;
    GRANT EXECUTE ON FUNCTION app.current_company_id()                TO app_auth;
    GRANT EXECUTE ON FUNCTION app.current_user_id()                   TO app_auth;
    GRANT EXECUTE ON FUNCTION app.cerrar_sesion(text)                 TO app_auth;
  `);
}

export interface CreateTestDbOptions {
  /** Muestra por consola cada migración aplicada. */
  verbose?: boolean;
}

export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestDb> {
  const client = await createDb();
  await migrate(client, options.verbose ? { logger: (m) => console.log(m) } : {});
  await asegurarRolesAplicacion(client);

  /** Sesiones ya emitidas, para no gastar una por cada `asTenant`. */
  const cache = new Map<string, { token: string; userId: string; sessionId: string }>();

  /**
   * Usuario técnico por (tenant, rol). Se separa por rol a propósito: si todos
   * los roles compartieran usuario, los permisos se acumularían y una prueba de
   * "el auxiliar no puede X" pasaría por accidente.
   */
  async function usuarioTecnico(tx: SqlClient, tenantId: string, rol: string): Promise<string> {
    const email = `harness-${rol}-${tenantId}@pruebas.local`;
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [
      email,
    ]);
    if (rows[0]) return rows[0].id;

    const { rows: creado } = await tx.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, nombre_completo, estado)
       VALUES ($1, $2, 'Usuario técnico del harness de pruebas', 'activo')
       RETURNING id`,
      [tenantId, email],
    );
    return creado[0]!.id;
  }

  async function emitirSesion(
    tenantId: string,
    companyId: string | null,
    extra: OpcionesTenant = {},
  ): Promise<{ token: string; userId: string; sessionId: string }> {
    const rolId = extra.rolId ?? null;
    const rolCodigo = extra.rolCodigo ?? null;
    const clave = [
      tenantId,
      companyId ?? '',
      extra.userId ?? '',
      rolId ?? '',
      rolCodigo ?? '',
      extra.minutos ?? '',
    ].join('|');

    if (!extra.sesionNueva) {
      const previa = cache.get(clave);
      if (previa) return previa;
    }

    const emitida = await client.transaction(async (tx) => {
      let roleId = rolId;
      if (!roleId && rolCodigo) {
        const { rows } = await tx.query<{ id: string }>(
          'SELECT id FROM role WHERE codigo = $1 AND tenant_id IS NULL',
          [rolCodigo],
        );
        if (!rows[0]) throw new Error(`No existe el rol de sistema "${rolCodigo}".`);
        roleId = rows[0].id;
      }
      roleId ??= ROLES.ADMIN_FIRMA;

      const userId =
        extra.userId ?? (await usuarioTecnico(tx, tenantId, rolCodigo ?? roleId.slice(-2)));

      if (companyId) {
        await tx.query(
          `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, user_id, role_id) DO NOTHING`,
          [tenantId, companyId, userId, roleId],
        );
      }

      const token = generarTokenSesion();
      const { rows } = await tx.query<{ session_id: string }>(
        'SELECT app.abrir_sesion($1, $2, $3::inet, $4, $5, $6) AS session_id',
        [userId, token, extra.ip ?? null, extra.userAgent ?? null, true, extra.minutos ?? 480],
      );
      return { token, userId, sessionId: rows[0]!.session_id };
    });

    cache.set(clave, emitida);
    return emitida;
  }

  return {
    driver: client.driver,
    client,
    asAdmin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      return client.transaction(fn);
    },
    emitirSesion,
    async asTenant<T>(
      tenantId: string,
      companyId: string | null,
      fn: (tx: SqlClient) => Promise<T>,
      extra: OpcionesTenant = {},
    ): Promise<T> {
      const { token } = await emitirSesion(tenantId, companyId, extra);
      return withSessionContext(
        client,
        {
          sessionToken: token,
          companyId,
          ip: extra.ip ?? null,
          userAgent: extra.userAgent ?? null,
          requestId: extra.requestId ?? null,
          ...(extra.role === undefined ? {} : { role: extra.role }),
        },
        fn,
      );
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

// -----------------------------------------------------------------------------
// Aserciones sobre errores del motor
// -----------------------------------------------------------------------------

/**
 * Ejecuta `fn` esperando que PostgreSQL la rechace con un SQLSTATE concreto.
 *
 * Es la pieza central de las compuertas: una prueba solo cuenta si el rechazo
 * viene del motor. Si `fn` no lanza, o lanza algo que no es un error de
 * Postgres, o el SQLSTATE no coincide, esta función falla con un mensaje que
 * dice exactamente qué pasó.
 */
export async function esperarErrorPg(
  fn: () => Promise<unknown>,
  sqlstate: string,
  descripcion = 'la operación',
): Promise<PostgresError> {
  let error: unknown;
  let huboError = false;
  try {
    await fn();
  } catch (e) {
    huboError = true;
    error = e;
  }

  if (!huboError) {
    throw new Error(
      `Se esperaba que ${descripcion} fuera rechazada por PostgreSQL con SQLSTATE ${sqlstate}, ` +
        'pero la operación tuvo éxito. Esto es exactamente el falso PASS que invalida la Ola 0.',
    );
  }

  if (!isPostgresError(error)) {
    throw new Error(
      `Se esperaba un error de PostgreSQL con SQLSTATE ${sqlstate} en ${descripcion}, ` +
        `pero llegó ${error instanceof Error ? `un ${error.name}: ${error.message}` : String(error)}. ` +
        'Un throw de TypeScript no demuestra que la garantía esté en la base de datos.',
    );
  }

  if (error.code !== sqlstate) {
    throw new Error(
      `${descripcion}: se esperaba SQLSTATE ${sqlstate} y llegó ${error.code}. Mensaje: ${error.message}`,
    );
  }

  return error;
}

/** UUID aleatorio, para que las pruebas no choquen entre sí en un Postgres compartido. */
export function uuid(): string {
  return crypto.randomUUID();
}

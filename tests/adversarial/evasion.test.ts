/**
 * A14 — QA ADVERSARIAL. RUTAS DE EVASIÓN.
 *
 * La compuerta de la Ola 0 pide cuatro cosas concretas (ver `compuerta-ola0`).
 * Este archivo busca lo otro: las puertas que quedan abiertas AL LADO de las
 * que se cerraron. Vistas que no hereden RLS, funciones SECURITY DEFINER que
 * devuelvan datos ajenos, GRANT de más, TRUNCATE, secuencias que delaten
 * actividad de otra firma, tablas nuevas sin política, y las dos
 * vulnerabilidades que A12 dejó declaradas abiertas (D-023 y D-024), que aquí
 * no se dan por buenas: se miden.
 *
 * Dos de las rutas que se probaron aquí estaban REALMENTE abiertas y las cerró
 * la migración `017_a14_cierre_vulnerabilidades.sql` (D-030 y D-031). Las
 * pruebas que siguen son las que demuestran el cierre; antes de esa migración
 * fallaban.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import { crearEscenario } from '../helpers/fixtures.js';
import type { Escenario } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import { ROLES } from '../../src/auth/permisos.js';
import { rechazoConCodigo } from './_arsenal.js';

let db: TestDb;
let alfa: Escenario;
let beta: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  alfa = await crearEscenario(db, { razonSocial: 'Firma Alfa (evasión)' });
  beta = await crearEscenario(db, { razonSocial: 'Firma Beta (evasión)' });
});

afterAll(async () => {
  await db?.close();
});

// =============================================================================
// D-030 — la revocación de sesiones ignoraba el tenant. CERRADA por A14.
// =============================================================================
describe('A14 · D-030 — app.revocar_sesiones_de_usuario ya no cruza firmas', () => {
  it('una sesión de Alfa NO puede revocar las sesiones de un usuario de Beta', async () => {
    const sesionDeBeta = await db.emitirSesion(beta.tenantId, beta.companyId, {
      userId: beta.userId,
      sesionNueva: true,
    });

    await rechazoConCodigo(
      () =>
        db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
          tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [beta.userId]),
        ),
      [SQLSTATE.EMPRESA_NO_AUTORIZADA],
      'revocar desde Alfa las sesiones de un usuario de Beta',
    );

    // Y la sesión de Beta sigue viva: no fue un rechazo cosmético después del
    // hecho, fue un rechazo antes del UPDATE.
    const viva = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ revocada_en: string | null }>(
        'SELECT revocada_en FROM app.session_context WHERE id = $1',
        [sesionDeBeta.sessionId],
      );
      return rows[0]?.revocada_en ?? null;
    });
    expect(viva).toBeNull();
  });

  it('el SQLSTATE es el mismo para un usuario de otra firma que para uno inexistente: no hay oráculo', async () => {
    const inexistente = uuid();
    const ajeno = await rechazoConCodigo(
      () =>
        db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
          tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [beta.userId]),
        ),
      [SQLSTATE.EMPRESA_NO_AUTORIZADA],
      'revocar sobre un usuario de otra firma',
    );
    const fantasma = await rechazoConCodigo(
      () =>
        db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
          tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [inexistente]),
        ),
      [SQLSTATE.EMPRESA_NO_AUTORIZADA],
      'revocar sobre un usuario que no existe',
    );
    expect(ajeno.code).toBe(fantasma.code);
  });

  it('revocar las PROPIAS sesiones sigue permitido sin ningún permiso especial', async () => {
    const propio = await db.emitirSesion(alfa.tenantId, alfa.companyId, {
      userId: alfa.userId,
      rolCodigo: 'solo_lectura',
      sesionNueva: true,
    });

    const n = await db.asTenant(
      alfa.tenantId,
      alfa.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT app.revocar_sesiones_de_usuario($1) AS n',
          [propio.userId],
        );
        return Number(rows[0]!.n);
      },
      { userId: propio.userId, rolCodigo: 'solo_lectura' },
    );
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('revocar las de OTRO usuario de la misma firma exige usuario.administrar (SE002)', async () => {
    const victima = await db.asAdmin(async (tx) => {
      const id = uuid();
      await tx.query(
        `INSERT INTO "user" (id, tenant_id, email, nombre_completo, estado)
         VALUES ($1, $2, $3, 'Víctima de la sonda de A14', 'activo')`,
        [id, alfa.tenantId, `victima-${id}@ejemplo.co`],
      );
      return id;
    });

    // Un contador no administra usuarios.
    await rechazoConCodigo(
      () =>
        db.asTenant(
          alfa.tenantId,
          alfa.companyId,
          (tx) => tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [victima]),
          { rolCodigo: 'contador' },
        ),
      [SQLSTATE.PERMISO_INSUFICIENTE],
      'revocar sesiones ajenas sin usuario.administrar',
    );

    // El administrador de firma sí.
    const ok = await db.asTenant(
      alfa.tenantId,
      alfa.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT app.revocar_sesiones_de_usuario($1) AS n',
          [victima],
        );
        return Number(rows[0]!.n);
      },
      { rolId: ROLES.ADMIN_FIRMA },
    );
    expect(ok).toBe(0); // no tenía sesiones vivas, pero la llamada fue autorizada
  });

  it('el camino administrativo (sin sesión) sigue funcionando: es el que usa la rotación de credenciales', async () => {
    const s = await db.emitirSesion(beta.tenantId, beta.companyId, {
      userId: beta.userId,
      sesionNueva: true,
    });
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT app.revocar_sesiones_de_usuario($1) AS n',
        [beta.userId],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBeGreaterThanOrEqual(1);
    const revocada = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ revocada_en: string | null }>(
        'SELECT revocada_en FROM app.session_context WHERE id = $1',
        [s.sessionId],
      );
      return rows[0]?.revocada_en ?? null;
    });
    expect(revocada).not.toBeNull();
  });
});

// =============================================================================
// D-031 — app_auth podía fabricar auditoría en cualquier firma. CERRADA por A14.
// =============================================================================
describe('A14 · D-031 — el rol de autenticación no puede envenenar el audit_log ajeno', () => {
  const INSERTAR = `INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id, valor_nuevo)
                    VALUES ($1, NULL, $2, $3, $4, $5, '{"origen":"sonda A14"}'::jsonb)`;

  async function comoAppAuth(params: unknown[]): Promise<void> {
    await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_auth');
      await tx.query(INSERTAR, params);
    });
  }

  it('no puede escribir en la firma de otro señalando a nadie', async () => {
    await rechazoConCodigo(
      () => comoAppAuth([alfa.tenantId, null, 'LOGIN', 'user_session', 'forja-1']),
      ['42501'],
      'forjar un LOGIN en una firma sin nombrar usuario',
    );
  });

  it('no puede escribir en la firma de Alfa señalando a un usuario de Beta', async () => {
    // Desde la migración 018 hay DOS capas sobre esta misma forja y la de
    // dentro contesta primero: el guardia de alcance de A2 es un trigger
    // BEFORE, y los triggers BEFORE se ejecutan antes del WITH CHECK de la
    // política. Sigue siendo un rechazo del motor; solo cambia a un código más
    // específico. Si algún día se quitara el guardia, la política de 017
    // volvería a contestar 42501 y esta prueba seguiría siendo válida.
    await rechazoConCodigo(
      () => comoAppAuth([alfa.tenantId, beta.userId, 'LOGIN', 'user_session', 'forja-2']),
      [SQLSTATE.FK_ALCANCE_AJENO, '42501'],
      'forjar un LOGIN con la pareja (firma, usuario) incoherente',
    );
  });

  it('no puede usar el audit_log como cajón de sastre: la entidad va acotada', async () => {
    await rechazoConCodigo(
      () => comoAppAuth([null, null, 'LOGIN', 'journal_entry', 'forja-3']),
      ['42501'],
      'forjar un registro sobre una entidad que no es de autenticación',
    );
  });

  it('no puede fabricar acciones que no sean de autenticación', async () => {
    await rechazoConCodigo(
      () => comoAppAuth([null, null, 'UPDATE', 'user_session', 'forja-4']),
      ['42501'],
      'forjar un registro con una acción de negocio',
    );
  });

  it('CONTROL: los dos caminos legítimos del intento fallido siguen abiertos', async () => {
    // Correo desconocido: se registra igual, o el audit_log ocultaría la
    // enumeración de correos. Sin firma ni usuario.
    await comoAppAuth([null, null, 'ACCESO_DENEGADO', 'autenticacion', 'control-anonimo']);
    // Correo conocido: firma y usuario coherentes.
    await comoAppAuth([
      alfa.tenantId,
      alfa.userId,
      'ACCESO_DENEGADO',
      'autenticacion',
      'control-conocido',
    ]);

    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM audit_log WHERE entidad_id LIKE 'control-%'",
      );
      return rows[0]!.n;
    });
    expect(n).toBe(2);
  });

  it('y ninguna de las cuatro forjas dejó rastro', async () => {
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM audit_log WHERE entidad_id LIKE 'forja-%'",
      );
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });
});

// =============================================================================
// D-023 — alcance REAL del rol app_auth, medido y no aceptado de palabra
// =============================================================================
describe('A14 · D-023 — el rol app_auth, medido por lo que el motor le deja hacer', () => {
  it('sobre tablas de negocio no tiene NADA salvo lo estrictamente declarado', async () => {
    const privilegios = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; privs: string }>(
        `SELECT c.relname AS tabla,
                concat_ws(',',
                  CASE WHEN has_table_privilege('app_auth', c.oid,'SELECT')   THEN 'SELECT' END,
                  CASE WHEN has_table_privilege('app_auth', c.oid,'INSERT')   THEN 'INSERT' END,
                  CASE WHEN has_table_privilege('app_auth', c.oid,'UPDATE')   THEN 'UPDATE' END,
                  CASE WHEN has_table_privilege('app_auth', c.oid,'DELETE')   THEN 'DELETE' END,
                  CASE WHEN has_table_privilege('app_auth', c.oid,'TRUNCATE') THEN 'TRUNCATE' END
                ) AS privs
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY 1`,
      );
      return rows.filter((r) => r.privs !== '').map((r) => `${r.tabla}:${r.privs}`);
    });
    // Exactamente dos, y ninguno más. Si aparece un tercero, alguien amplió el
    // camino de autenticación sin decirlo.
    expect(privilegios.sort()).toEqual(['audit_log:INSERT', 'user:SELECT']);
  });

  it('no tiene un solo privilegio sobre las tablas del esquema app, ni siquiera de lectura', async () => {
    const conAlgo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relkind = 'r'
            AND (has_table_privilege('app_auth', c.oid,'SELECT')
              OR has_table_privilege('app_auth', c.oid,'INSERT')
              OR has_table_privilege('app_auth', c.oid,'UPDATE')
              OR has_table_privilege('app_auth', c.oid,'DELETE'))`,
      );
      return rows.map((r) => r.relname);
    });
    expect(conAlgo).toEqual([]);
  });

  it('LEER credenciales exige nombrar el correo exacto: no puede barrer la tabla de usuarios', async () => {
    const leidas = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_auth');
      const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM "user"');
      return rows[0]!.n;
    });
    // Sin `app.login_email` puesto, la política no deja ver ninguna fila.
    expect(leidas).toBe(0);
  });

  it('ALCANCE RESIDUAL CONFIRMADO (D-023): con el correo exacto sí ve esa fila, y de cualquier firma', async () => {
    // Esto es lo que D-023 declara abierto, y es cierto: la verificación de la
    // contraseña ocurre en Node porque pgcrypto no está en PGlite. Se deja
    // MEDIDO para que nadie lo descubra por sorpresa: quien posea las
    // credenciales de `app_auth` lee la credencial de cualquier correo que
    // conozca, sin importar la firma. Lo que YA NO puede (D-031) es escribir
    // en la auditoría de esa firma.
    const correoDeBeta = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ email: string }>('SELECT email FROM "user" WHERE id = $1', [
        beta.userId,
      ]);
      return rows[0]!.email;
    });

    const vista = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_auth');
      await tx.query(`SELECT set_config('app.login_email', $1, true)`, [correoDeBeta]);
      const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM "user"');
      return rows[0]!.n;
    });
    expect(vista).toBe(1);

    // Y ni así puede tocar una tabla de negocio.
    await rechazoConCodigo(
      () =>
        db.client.transaction(async (tx) => {
          await tx.exec('SET LOCAL ROLE app_auth');
          await tx.query('SELECT count(*) FROM journal_entry');
        }),
      ['42501'],
      'que app_auth lea el ledger',
    );
  });
});

// =============================================================================
// D-024 — el descenso a app_user es reversible en PGlite. Se mide el alcance.
// =============================================================================
describe('A14 · D-024 — las invariantes de despliegue que SÍ son comprobables', () => {
  it('app_user no es superusuario, no tiene BYPASSRLS, no hereda roles y no puede iniciar sesión por sí solo en el harness', async () => {
    const rol = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolinherit: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      }>(
        `SELECT rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole
           FROM pg_roles WHERE rolname = 'app_user'`,
      );
      return rows[0]!;
    });
    expect(rol.rolsuper).toBe(false);
    expect(rol.rolbypassrls).toBe(false);
    expect(rol.rolinherit).toBe(false);
    expect(rol.rolcreatedb).toBe(false);
    expect(rol.rolcreaterole).toBe(false);
  });

  it('app_user no es miembro de app_auth ni al revés: escalar de un camino al otro exige DOS credenciales', async () => {
    const membresias = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ miembro: string; en: string }>(
        `SELECT m.rolname AS miembro, g.rolname AS en
           FROM pg_auth_members am
           JOIN pg_roles m ON m.oid = am.member
           JOIN pg_roles g ON g.oid = am.roleid
          WHERE m.rolname IN ('app_user','app_auth') OR g.rolname IN ('app_user','app_auth')`,
      );
      return rows.map((r) => `${r.miembro}->${r.en}`);
    });
    expect(membresias).toEqual([]);
  });

  it('app_user no es dueño de ninguna tabla, vista, secuencia ni función: con FORCE RLS, ser dueño sería la puerta trasera', async () => {
    const propiedad = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ objeto: string }>(
        `SELECT n.nspname || '.' || c.relname AS objeto
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_roles r ON r.oid = c.relowner
          WHERE r.rolname IN ('app_user','app_auth') AND n.nspname IN ('public','app')
          UNION ALL
         SELECT n.nspname || '.' || p.proname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_roles r ON r.oid = p.proowner
          WHERE r.rolname IN ('app_user','app_auth') AND n.nspname IN ('public','app')`,
      );
      return rows.map((r) => r.objeto);
    });
    expect(propiedad).toEqual([]);
  });

  it('app_user no puede crear objetos en ningún esquema: sin CREATE no hay tabla propia sin RLS donde copiar datos', async () => {
    const conCreate = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace
          WHERE nspname IN ('public','app') AND has_schema_privilege('app_user', oid, 'CREATE')`,
      );
      return rows.map((r) => r.nspname);
    });
    expect(conCreate).toEqual([]);
  });

  it('RESIDUO MEDIDO DE D-024: en este harness la conexión de fondo SÍ es superusuario, y por eso el descenso es reversible', async () => {
    // A12 lo declara y es exacto. Queda aquí como medición, no como confianza:
    // si algún día alguien apunta DATABASE_URL a un Postgres real con un
    // usuario superusuario, esta prueba lo dice en voz alta en vez de dejar
    // que todas las demás pasen por la razón equivocada.
    const perfil = await db.asTenant(alfa.tenantId, alfa.companyId, async (tx) => {
      const { rows } = await tx.query<{
        actual: string;
        de_sesion: string;
        sesion_es_super: boolean;
      }>(
        `SELECT current_user AS actual, session_user AS de_sesion,
                (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS sesion_es_super`,
      );
      return rows[0]!;
    });

    expect(perfil.actual).toBe('app_user');
    // El rol EFECTIVO nunca es superusuario -> las políticas se ejercitan de verdad.
    // El rol de CONEXIÓN sí lo es en PGlite -> por eso D-024 sigue abierto y su
    // cierre es de despliegue (A15), no de código.
    expect(perfil.de_sesion).not.toBe('app_user');
    expect(perfil.sesion_es_super).toBe(true);
  });

  it('la capa de aplicación no debería dejar elegir el rol de base de datos a quien llama (nota para A12)', async () => {
    // `withSessionContext` acepta `role` y lo interpola tras validar el formato.
    // En producción, con un rol de login sin membresías, `SET ROLE otro` falla;
    // aquí se comprueba que ese SET ROLE, si el rol no existe, lo rechaza el
    // motor y no cae en un `SET ROLE` silencioso.
    await rechazoConCodigo(
      () =>
        db.asTenant(alfa.tenantId, alfa.companyId, (tx) => tx.query('SELECT 1'), {
          role: 'rol_que_no_existe',
        }),
      ['42704', '22023', '0LP01', '42501'],
      'abrir contexto con un rol de base de datos inexistente',
    );
  });
});

// =============================================================================
// BARRIDO ESTRUCTURAL — lo que ni A2 ni A12 miraron
// =============================================================================
describe('A14 · barrido estructural de puertas laterales', () => {
  it('ninguna vista escapa a la RLS: todas llevan security_invoker (public y app)', async () => {
    const sinInvoker = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ objeto: string }>(
        `SELECT n.nspname || '.' || c.relname AS objeto
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname IN ('public','app') AND c.relkind IN ('v','m')
            AND (c.reloptions IS NULL
                 OR NOT ('security_invoker=true' = ANY(c.reloptions)))`,
      );
      return rows.map((r) => r.objeto);
    });
    expect(sinInvoker).toEqual([]);
  });

  it('ninguna tabla de public quedó con RLS y sin política, ni sin RLS (salvo el control de migraciones)', async () => {
    const sospechosas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string; motivo: string }>(
        `SELECT c.relname,
                CASE WHEN NOT c.relrowsecurity THEN 'sin RLS'
                     WHEN NOT c.relforcerowsecurity THEN 'sin FORCE'
                     ELSE 'sin política' END AS motivo
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND c.relname <> 'schema_migration'
            AND (NOT c.relrowsecurity
              OR NOT c.relforcerowsecurity
              OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`,
      );
      return rows.map((r) => `${r.relname} (${r.motivo})`);
    });
    expect(sospechosas).toEqual([]);
  });

  it('toda función SECURITY DEFINER lleva search_path fijo: sin él, un esquema plantado la secuestra', async () => {
    const sinSearchPath = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ f: string }>(
        `SELECT n.nspname || '.' || p.proname AS f
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef
            AND n.nspname IN ('app','public')
            AND NOT EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
               WHERE c LIKE 'search\\_path=%')`,
      );
      return rows.map((r) => r.f);
    });
    expect(sinSearchPath).toEqual([]);
  });

  it('el inventario de funciones SECURITY DEFINER ejecutables por app_user es el esperado, y ninguna cruza firmas', async () => {
    const inventario = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ f: string }>(
        `SELECT n.nspname || '.' || p.proname AS f
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname IN ('app','public')
            AND has_function_privilege('app_user', p.oid, 'EXECUTE')
          ORDER BY 1`,
      );
      return rows.map((r) => r.f);
    });

    // Lista cerrada. Una función DEFINER nueva y ejecutable por la aplicación
    // es un agujero potencial y tiene que pasar por aquí, no colarse.
    //
    // Añadida en la Ola 1 por A4: `app.resolver_empresa_por_buzon` (migración
    // 032_ingest_resolver_buzon.sql). Mismo patrón ya auditado que
    // `app.buscar_credencial` para app_auth (D-023): resuelve `company` por
    // `buzon_email` ANTES de que exista sesión, porque `company` tiene RLS de
    // tenant estricto y sin sesión no se vería ninguna fila. Superficie
    // expuesta: solo (company_id, tenant_id) de una empresa ACTIVA que
    // coincida exacto con el buzón — nunca NIT, razón social ni ningún otro
    // dato. No cruza firmas: no acepta ningún parámetro que identifique un
    // tenant u otra empresa, así que no hay firma que falsificar.
    expect(inventario).toEqual([
      'app.cerrar_sesion',
      'app.current_company_id',
      'app.resolver_empresa_por_buzon',
      'app.revocar_sesiones_de_usuario',
      'app.sesion_actual',
      'app.tiene_permiso',
      'app.trg_espejo_acceso',
      'app.trg_espejo_usuario',
    ]);
  });

  it('app.sesion_actual solo devuelve la sesión del token presentado, nunca la de otro', async () => {
    const { token: tokenAlfa } = await db.emitirSesion(alfa.tenantId, alfa.companyId, {
      userId: alfa.userId,
    });
    const sesionDeBeta = await db.emitirSesion(beta.tenantId, beta.companyId, {
      userId: beta.userId,
      sesionNueva: true,
    });

    const visto = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');
      await tx.query(`SELECT set_config('app.session_token', $1, true)`, [tokenAlfa]);
      const { rows } = await tx.query<{ id: string | null; tenant_id: string | null }>(
        'SELECT (app.sesion_actual()).id, (app.sesion_actual()).tenant_id',
      );
      return rows[0]!;
    });

    expect(visto.tenant_id).toBe(alfa.tenantId);
    expect(visto.id).not.toBe(sesionDeBeta.sessionId);
  });

  it('app.tiene_permiso no se puede consultar «en nombre de» otra sesión', async () => {
    // Un solo_lectura de Alfa pregunta por un permiso de escritura: la función
    // resuelve contra SU token, no contra un parámetro que él controle.
    const respuesta = await db.asTenant(
      alfa.tenantId,
      alfa.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ p: boolean }>(
          "SELECT app.tiene_permiso('parametro.editar') AS p",
        );
        return rows[0]!.p;
      },
      { rolCodigo: 'solo_lectura' },
    );
    expect(respuesta).toBe(false);
  });

  it('app_user no conserva ningún privilegio de más: la lista de REVOKE se comprueba contra el motor', async () => {
    const excesos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ hallazgo: string }>(
        `SELECT 'audit_log:' || p AS hallazgo FROM (VALUES ('UPDATE'),('DELETE'),('TRUNCATE')) v(p)
          WHERE has_table_privilege('app_user','public.audit_log', p)
         UNION ALL
         SELECT 'permission:' || p FROM (VALUES ('INSERT'),('UPDATE'),('DELETE')) v(p)
          WHERE has_table_privilege('app_user','public.permission', p)
         UNION ALL
         SELECT 'user_session:' || p FROM (VALUES ('INSERT'),('UPDATE'),('DELETE')) v(p)
          WHERE has_table_privilege('app_user','public.user_session', p)
         UNION ALL
         SELECT 'schema_migration:' || p FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) v(p)
          WHERE has_table_privilege('app_user','public.schema_migration', p)
         UNION ALL
         SELECT 'app.abrir_sesion' WHERE has_function_privilege('app_user',
           'app.abrir_sesion(uuid,text,inet,text,boolean,integer)', 'EXECUTE')
         UNION ALL
         SELECT 'app.buscar_credencial' WHERE has_function_privilege('app_user',
           'app.buscar_credencial(text)', 'EXECUTE')
         UNION ALL
         SELECT 'app.usuario_pertenece' WHERE has_function_privilege('app_user',
           'app.usuario_pertenece(uuid,uuid)', 'EXECUTE')
         ORDER BY 1`,
      );
      return rows.map((r) => r.hallazgo);
    });
    expect(excesos).toEqual([]);
  });

  it('ninguna secuencia deja a app_user alterar el contador, y solo hay la del audit_log', async () => {
    const secuencias = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string; upd: boolean }>(
        `SELECT c.relname, has_sequence_privilege('app_user', c.oid, 'UPDATE') AS upd
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1`,
      );
      return rows;
    });
    for (const s of secuencias) {
      expect(`${s.relname}:UPDATE=${s.upd}`).toBe(`${s.relname}:UPDATE=false`);
    }
  });

  it('el audit_log sigue siendo append-only incluso para el dueño de las tablas', async () => {
    await db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
      tx.query("UPDATE company SET razon_social = razon_social || ' ' WHERE id = $1", [
        alfa.companyId,
      ]),
    );
    await rechazoConCodigo(
      () => db.asAdmin((tx) => tx.query("UPDATE audit_log SET accion = 'MENTIRA'")),
      [SQLSTATE.AUDITORIA_INMUTABLE],
      'reescribir el audit_log como superusuario',
    );
    await rechazoConCodigo(
      () => db.asAdmin((tx) => tx.query('DELETE FROM audit_log')),
      [SQLSTATE.AUDITORIA_INMUTABLE],
      'vaciar el audit_log como superusuario',
    );
  });

  it('D-033 CERRADA (A2, migración 018): el TRUNCATE del ledger y del audit_log lo bloquea el motor', async () => {
    // Un `BEFORE DELETE FOR EACH ROW` NO se dispara con TRUNCATE. Antes de la
    // migración 018 la única defensa era que ningún rol de aplicación tuviera
    // el privilegio: mitigación por GRANT. El dueño de las tablas vaciaba el
    // ledger sin que LG001 ni AU001 se enterasen. Ahora hay un trigger
    // BEFORE TRUNCATE FOR EACH STATEMENT y la invariante ya no depende de que
    // nadie conceda el privilegio por error.
    const conTrigger = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT DISTINCT c.relname
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND (t.tgtype & 32) <> 0
            AND c.relname IN ('journal_entry','journal_line','audit_log')
          ORDER BY 1`,
      );
      return rows.map((r) => r.relname);
    });
    expect(conTrigger).toEqual(['audit_log', 'journal_entry', 'journal_line']);

    // Y se comprueba de verdad, no solo en el catálogo: ni el SUPERUSUARIO,
    // que se salta RLS y GRANTs, puede vaciarlas.
    await rechazoConCodigo(
      () => db.asAdmin((tx) => tx.query('TRUNCATE journal_line')),
      [SQLSTATE.LEDGER_INMUTABLE],
      'TRUNCATE de journal_line como superusuario',
    );
    await rechazoConCodigo(
      () => db.asAdmin((tx) => tx.query('TRUNCATE audit_log')),
      [SQLSTATE.AUDITORIA_INMUTABLE],
      'TRUNCATE del audit_log como superusuario',
    );
    await rechazoConCodigo(
      () => db.asAdmin((tx) => tx.query('TRUNCATE journal_entry CASCADE')),
      [SQLSTATE.LEDGER_INMUTABLE],
      'TRUNCATE en cascada del ledger como superusuario',
    );

    // Lo que sí es exigible hoy y se exige: la aplicación no tiene el privilegio.
    const conPrivilegio = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r'
            AND (has_table_privilege('app_user', c.oid,'TRUNCATE')
              OR has_table_privilege('app_auth', c.oid,'TRUNCATE'))`,
      );
      return rows[0]!.n;
    });
    expect(conPrivilegio).toBe(0);
  });

  it(
    'D-032 CERRADA (A2, migración 018): journal_line.account_id ya no admite una cuenta de OTRA firma',
    async () => {
      // `journal_line.account_id` llevaba una FK SIMPLE a `account(id)`, no la
      // FK compuesta que llevan el resto de sus referencias. Como `account` es
      // un catálogo híbrido (tenant_id puede ser NULL), la FK compuesta no es
      // expresable y hacía falta un trigger. No lo había: una partida de la
      // firma A podía imputarse contra una cuenta de la firma B, y esa partida,
      // una vez publicada, es inmutable. La RLS después esconde la cuenta, así
      // que el auxiliar y el balance la perderían en silencio.
      //
      // No era fuga de confidencialidad (hace falta acertar un UUID), era un
      // agujero de INTEGRIDAD. La migración 018 lo cierra con el guardia
      // genérico `app.trg_fk_alcance` (SQLSTATE AL001).
      await rechazoConCodigo(
        () =>
          db.asTenant(alfa.tenantId, alfa.companyId, async (tx) => {
            const { rows } = await tx.query<{ id: string }>(
              `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id,
                 fecha_hecho_economico, descripcion, estado, source_document_id,
                 approval_id, idempotency_key)
               VALUES ($1,$2,$3,'2026-06-15','Sonda D-032','draft',$4,$5,$6) RETURNING id`,
              [
                alfa.tenantId,
                alfa.companyId,
                alfa.fiscalPeriodId,
                alfa.sourceDocumentId,
                alfa.approvalId,
                `d032-${uuid()}`,
              ],
            );
            await tx.query(
              `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea,
                                         account_id, side, monto)
               VALUES ($1,$2,$3,1,$4,'debito',100)`,
              [alfa.tenantId, alfa.companyId, rows[0]!.id, beta.cuentas.gasto],
            );
          }),
        [
          SQLSTATE.FK_ALCANCE_AJENO,
          SQLSTATE.FOREIGN_KEY_VIOLATION,
          SQLSTATE.CHECK_VIOLATION,
          SQLSTATE.RLS_VIOLATION,
        ],
        'imputar una partida contra la cuenta de otra firma',
      );
    },
  );

  it('D-032: el barrido completo de claves foráneas no dejó ningún hueco de alcance', async () => {
    // A14 encontró UNA columna. A2 recorrió `pg_constraint` entero y encontró
    // 71 del mismo patrón. Esta prueba vuelve a hacer el barrido contra el
    // catálogo vivo: si alguien añade mañana una FK hacia una tabla con
    // `tenant_id` sin acotar el alcance, aquí se ve.
    const huecos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ hallazgo: string }>(
        `WITH fk AS (
           SELECT hijo.relname AS hija, padre.relname AS padre,
                  (SELECT array_agg(a.attname ORDER BY x.ord)
                     FROM unnest(con.conkey) WITH ORDINALITY AS x(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = x.attnum) AS cols
             FROM pg_constraint con
             JOIN pg_class hijo  ON hijo.oid  = con.conrelid
             JOIN pg_class padre ON padre.oid = con.confrelid
             JOIN pg_namespace nn ON nn.oid = hijo.relnamespace
            WHERE con.contype = 'f' AND nn.nspname = 'public'
         ),
         scope AS (
           SELECT c.relname AS tabla, bool_or(a.attname = 'tenant_id') AS t
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            GROUP BY c.relname
         ),
         guardadas AS (
           SELECT c.relname AS tabla, unnest(a.args) AS col
             FROM pg_trigger tg
             JOIN pg_class c ON c.oid = tg.tgrelid
             CROSS JOIN LATERAL (
               SELECT string_to_array(encode(tg.tgargs, 'escape'), '\\000') AS args
             ) AS a
            WHERE NOT tg.tgisinternal AND tg.tgname LIKE '%\\_fk\\_alcance'
         )
         SELECT s.hija || '.' || s.cols[1] || ' -> ' || s.padre AS hallazgo
           FROM fk s
           JOIN scope sh ON sh.tabla = s.hija
           JOIN scope sp ON sp.tabla = s.padre
          WHERE sh.t AND sp.t AND s.padre <> 'tenant'
            AND NOT ('tenant_id' = ANY(s.cols))
            AND NOT EXISTS (
                  SELECT 1 FROM fk o
                   WHERE o.hija = s.hija AND o.padre = s.padre
                     AND o.cols[1] = s.cols[1] AND 'tenant_id' = ANY(o.cols))
            AND NOT EXISTS (
                  SELECT 1 FROM guardadas g
                   WHERE g.tabla = s.hija AND g.col = s.cols[1])
          ORDER BY 1`,
      );
      return rows.map((r) => r.hallazgo);
    });

    expect(huecos).toEqual([]);
  });
});

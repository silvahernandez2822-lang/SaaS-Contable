/**
 * COMPUERTA DE SEGURIDAD DE LA OLA 0 — Agente A12
 *
 * Lo que estas pruebas tienen que demostrar, no afirmar:
 *
 *   1. D-020 está cerrado: el contexto de tenant se DERIVA de un token de
 *      sesión verificado por la base. Fijar `app.tenant_id` a mano es inerte.
 *   2. RLS activa y forzada en TODAS las tablas de datos, recorridas desde
 *      `pg_class` / `pg_policies`, nunca desde una lista escrita a mano.
 *   3. Los permisos por rol los impone el motor: un auxiliar de causación no
 *      edita parámetros tributarios y un rol de solo lectura no escribe nada.
 *   4. El `audit_log` se escribe de verdad, con usuario, marca de tiempo e IP.
 *
 * Toda prueba de aislamiento corre dentro de `asTenant` (rol `app_user`, RLS
 * activa). Dentro de `asAdmin` se es superusuario y el motor ignora RLS: probar
 * aislamiento ahí sería un falso PASS.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import { crearAsientoBorrador, crearEscenario, partidasEquilibradas } from '../helpers/fixtures.js';
import type { Escenario } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import {
  EmpresaNoAutorizadaError,
  SesionInvalidaError,
  withSessionContext,
} from '../../src/db/tenant-context.js';
import { generarTokenSesion, hashTokenSesion } from '../../src/auth/sesion.js';
import { PERMISOS } from '../../src/auth/permisos.js';

let db: TestDb;
let a: Escenario;
let b: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  a = await crearEscenario(db, { razonSocial: 'Firma Alfa' });
  b = await crearEscenario(db, { razonSocial: 'Firma Beta' });
});

afterAll(async () => {
  await db?.close();
});

/** Tablas de infraestructura, no de datos de negocio. */
const SIN_RLS = ['schema_migration'];

// =============================================================================
describe('D-020 — el contexto de tenant se deriva de un claim verificado, no de un parámetro', () => {
  it('la migración 015 está aplicada y el contexto ya no lee app.tenant_id', async () => {
    const definicion = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ cuerpo: string }>(
        `SELECT pg_get_functiondef(p.oid) AS cuerpo
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app' AND p.proname = 'current_tenant_id'`,
      );
      return rows[0]!.cuerpo;
    });
    expect(definicion).toContain('sesion_actual');
    expect(definicion).not.toContain("current_setting('app.tenant_id'");
  });

  it('fijar app.tenant_id a mano no da acceso a nada: la GUC quedó inerte', async () => {
    const resultado = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');
      await tx.query(
        `SELECT set_config('app.tenant_id', $1, true),
                set_config('app.company_id', $2, true),
                set_config('app.user_id', $3, true)`,
        [b.tenantId, b.companyId, b.userId],
      );
      const { rows } = await tx.query<{ tenant: string | null; n: number }>(
        `SELECT app.current_tenant_id() AS tenant,
                (SELECT count(*)::int FROM third_party) AS n`,
      );
      return rows[0]!;
    });

    expect(resultado.tenant).toBeNull();
    expect(resultado.n).toBe(0);
  });

  it('una sesión de Alfa que además fija app.tenant_id al de Beta sigue viendo solo Alfa', async () => {
    const filas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [b.tenantId]);
      const { rows } = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM third_party');
      return rows;
    });
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.tenant_id === a.tenantId)).toBe(true);
  });

  it('un token inventado no resuelve ninguna sesión', async () => {
    await expect(
      withSessionContext(db.client, { sessionToken: generarTokenSesion() }, async (tx) =>
        tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(SesionInvalidaError);
  });

  it('app_user no tiene ningún privilegio sobre las tablas del esquema app', async () => {
    const accesibles = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; rol: string; privilegio: string }>(
        `SELECT c.relname AS tabla, r.rolname AS rol, priv.p AS privilegio
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN (VALUES ('app_user'), ('app_auth')) AS r(rolname)
           CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS priv(p)
          WHERE n.nspname = 'app' AND c.relkind = 'r'
            AND has_table_privilege(r.rolname, c.oid, priv.p)
          ORDER BY 1, 2, 3`,
      );
      return rows;
    });
    // Si esta lista deja de estar vacía, el rol de aplicación puede leer o
    // fabricar sesiones y D-020 vuelve a estar abierto.
    expect(accesibles).toEqual([]);
  });

  it('app_user no puede emitir sesiones: app.abrir_sesion es exclusiva de app_auth', async () => {
    await esperarErrorPg(
      () =>
        db.client.transaction(async (tx) => {
          await tx.exec('SET LOCAL ROLE app_user');
          await tx.query('SELECT app.abrir_sesion($1, $2)', [b.userId, generarTokenSesion()]);
        }),
      '42501',
      'la emisión de sesión desde app_user',
    );
  });

  it('de la sesión solo se guarda el hash del token, y TypeScript y PostgreSQL lo calculan igual', async () => {
    const token = generarTokenSesion();
    const enBase = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ h: string }>('SELECT app.hash_token($1) AS h', [token]);
      return rows[0]!.h;
    });
    expect(enBase).toBe(hashTokenSesion(token));

    const { token: emitido } = await db.emitirSesion(a.tenantId, a.companyId, {
      sesionNueva: true,
    });
    const guardado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number; hash: string }>(
        `SELECT count(*)::int AS n, max(token_hash) AS hash
           FROM app.session_context WHERE token_hash = app.hash_token($1)`,
        [emitido],
      );
      return rows[0]!;
    });
    expect(guardado.n).toBe(1);
    expect(guardado.hash).toBe(hashTokenSesion(emitido));
    // El token en claro no aparece en ninguna parte.
    expect(guardado.hash).not.toBe(emitido);
  });

  it('una sesión vencida deja de resolver contexto', async () => {
    const { token, sessionId } = await db.emitirSesion(a.tenantId, a.companyId, {
      sesionNueva: true,
    });
    await db.asAdmin((tx) =>
      tx.query(
        `UPDATE app.session_context SET expira_en = now() - interval '1 minute' WHERE id = $1`,
        [sessionId],
      ),
    );
    await expect(
      withSessionContext(db.client, { sessionToken: token, companyId: a.companyId }, async (tx) =>
        tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(SesionInvalidaError);
  });

  it('una sesión revocada deja de resolver contexto de inmediato', async () => {
    const { token, sessionId } = await db.emitirSesion(a.tenantId, a.companyId, {
      sesionNueva: true,
    });
    await db.asAdmin((tx) =>
      tx.query('UPDATE app.session_context SET revocada_en = now() WHERE id = $1', [sessionId]),
    );
    await expect(
      withSessionContext(db.client, { sessionToken: token, companyId: a.companyId }, async (tx) =>
        tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(SesionInvalidaError);
  });

  it('suspender al usuario corta sus sesiones vivas sin esperar a que venzan', async () => {
    const { token, userId } = await db.emitirSesion(a.tenantId, a.companyId, {
      sesionNueva: true,
    });
    await db.asAdmin((tx) =>
      tx.query(`UPDATE "user" SET estado = 'suspendido' WHERE id = $1`, [userId]),
    );
    await expect(
      withSessionContext(db.client, { sessionToken: token, companyId: a.companyId }, async (tx) =>
        tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(SesionInvalidaError);

    await db.asAdmin((tx) =>
      tx.query(`UPDATE "user" SET estado = 'activo' WHERE id = $1`, [userId]),
    );
  });

  it('la empresa la pide el cliente pero la autoriza la base: sin acceso, no hay contexto', async () => {
    const { token } = await db.emitirSesion(a.tenantId, a.companyId, { sesionNueva: true });

    await expect(
      withSessionContext(
        db.client,
        { sessionToken: token, companyId: b.companyId, ip: '203.0.113.9' },
        async (tx) => tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(EmpresaNoAutorizadaError);
  });
});

// =============================================================================
describe('Regla de Oro 7 — RLS recorrida desde el catálogo, no desde una lista', () => {
  it('toda tabla de datos tiene RLS habilitada Y forzada', async () => {
    const faltantes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string }>(
        `SELECT c.relname AS tabla
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT (c.relname = ANY($1))
            AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
          ORDER BY 1`,
        [SIN_RLS],
      );
      return rows.map((r) => r.tabla);
    });
    expect(faltantes).toEqual([]);
  });

  it('toda tabla con tenant_id tiene una política permisiva que filtra por tenant', async () => {
    const sospechosas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tablename: string }>(
        `SELECT c.relname AS tablename
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'tenant_id' AND att.attnum > 0
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname
                 AND p.permissive = 'PERMISSIVE'
                 AND p.qual LIKE '%current_tenant_id%')
          ORDER BY 1`,
      );
      return rows.map((r) => r.tablename);
    });
    expect(sospechosas).toEqual([]);
  });

  it('ninguna política de datos se apoya todavía en la GUC app.tenant_id', async () => {
    const heredadas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tablename: string; policyname: string }>(
        `SELECT tablename, policyname FROM pg_policies
          WHERE schemaname = 'public'
            AND (COALESCE(qual, '') LIKE '%app.tenant_id%'
                 OR COALESCE(with_check, '') LIKE '%app.tenant_id%')
          ORDER BY 1, 2`,
      );
      return rows;
    });
    expect(heredadas).toEqual([]);
  });

  it('barrido de comportamiento: en NINGUNA tabla se ve una fila de otro tenant', async () => {
    // Se montan datos en ambos tenants y luego se recorre el catálogo entero.
    for (const e of [a, b]) {
      await db.asTenant(e.tenantId, e.companyId, async (tx) => {
        await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 130_000_00));
      });
    }

    const tablas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string }>(
        `SELECT c.relname AS tabla
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'tenant_id' AND att.attnum > 0
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY 1`,
      );
      return rows.map((r) => r.tabla);
    });

    expect(tablas.length).toBeGreaterThanOrEqual(20);

    const fugas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const encontradas: { tabla: string; filas: number }[] = [];
      for (const tabla of tablas) {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public."${tabla}"
            WHERE tenant_id IS NOT NULL AND tenant_id <> app.current_tenant_id()`,
        );
        const n = rows[0]!.n;
        if (n > 0) encontradas.push({ tabla, filas: n });
      }
      return encontradas;
    });

    expect(fugas).toEqual([]);
  });

  it('barrido de comportamiento: tampoco se ve una fila de otra empresa del mismo tenant', async () => {
    const otraCompany = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, $3, 'Segunda empresa de Alfa')`,
        [otraCompany, a.tenantId, `705${Date.now()}`],
      ),
    );

    const tablas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string }>(
        `SELECT c.relname AS tabla
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'company_id' AND att.attnum > 0
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'audit_log'
          ORDER BY 1`,
      );
      return rows.map((r) => r.tabla);
    });

    const fugas = await db.asTenant(a.tenantId, otraCompany, async (tx) => {
      const encontradas: { tabla: string; filas: number }[] = [];
      for (const tabla of tablas) {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public."${tabla}"
            WHERE company_id IS NOT NULL AND company_id <> app.current_company_id()`,
        );
        const n = rows[0]!.n;
        if (n > 0) encontradas.push({ tabla, filas: n });
      }
      return encontradas;
    });

    expect(fugas).toEqual([]);
  });

  it('toda vista se ejecuta con security_invoker: una vista no puede ser puerta trasera de la RLS', async () => {
    const inseguras = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ vista: string }>(
        `SELECT c.relname AS vista
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'v'
            AND NOT COALESCE(array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false)
          ORDER BY 1`,
      );
      return rows.map((r) => r.vista);
    });
    expect(inseguras).toEqual([]);
  });

  it('ninguna función SECURITY DEFINER del esquema app quedó sin search_path fijo', async () => {
    const sueltas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ funcion: string }>(
        `SELECT p.proname AS funcion
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app' AND p.prosecdef
            AND NOT EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
               WHERE c LIKE 'search_path=%')
          ORDER BY 1`,
      );
      return rows.map((r) => r.funcion);
    });
    // Una SECURITY DEFINER sin search_path fijo se puede secuestrar creando un
    // objeto homónimo en un esquema que esté antes en la ruta de búsqueda.
    expect(sueltas).toEqual([]);
  });
});

// =============================================================================
describe('Sección 14.1 — permisos granulares impuestos por el motor', () => {
  it('el catálogo de permisos del código y el de la base son el mismo', async () => {
    const enBase = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        'SELECT codigo FROM permission ORDER BY codigo',
      );
      return rows.map((r) => r.codigo);
    });
    expect(enBase).toEqual([...Object.values(PERMISOS)].sort());
  });

  it('los cinco roles mínimos existen y son roles de sistema', async () => {
    const roles = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        'SELECT codigo FROM role WHERE tenant_id IS NULL AND es_sistema ORDER BY codigo',
      );
      return rows.map((r) => r.codigo);
    });
    expect(roles).toEqual([
      'admin_firma',
      'admin_tributario',
      'auxiliar_causacion',
      'contador',
      'solo_lectura',
    ]);
  });

  it('un auxiliar de causación NO puede editar parámetros tributarios (SE002 del motor)', async () => {
    const error = await esperarErrorPg(
      () =>
        db.asTenant(
          a.tenantId,
          a.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO tax_rule (tenant_id, tipo, tarifa, vigente_desde, norma_respaldo)
               VALUES ($1, 'retefuente', 0.025000, '2026-01-01', 'intento del auxiliar')`,
              [a.tenantId],
            ),
          { rolCodigo: 'auxiliar_causacion' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'la edición de un parámetro tributario por un auxiliar de causación',
    );
    expect(error.message).toContain('parametro.editar');
  });

  it('control: el mismo auxiliar SÍ puede preparar un borrador de causación', async () => {
    const id = await db.asTenant(
      a.tenantId,
      a.companyId,
      (tx) => crearAsientoBorrador(tx, a, partidasEquilibradas(a, 42_000_00)),
      { rolCodigo: 'auxiliar_causacion' },
    );
    expect(id).toBeTruthy();
  });

  it('un auxiliar de causación no puede aprobar ni publicar', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(
          a.tenantId,
          a.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO approval (tenant_id, company_id, entidad, entidad_id, source_document_id,
                                     decision, user_id, ip)
               VALUES ($1, $2, 'source_document', $3, $3, 'aprobado', $4, '198.51.100.4')`,
              [a.tenantId, a.companyId, a.sourceDocumentId, a.userId],
            ),
          { rolCodigo: 'auxiliar_causacion' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'la aprobación por un auxiliar de causación',
    );

    const borrador = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      crearAsientoBorrador(tx, a, partidasEquilibradas(a, 17_000_00)),
    );

    await esperarErrorPg(
      () =>
        db.asTenant(
          a.tenantId,
          a.companyId,
          (tx) => tx.query('SELECT app.publicar_asiento($1, $2)', [borrador, a.userId]),
          { rolCodigo: 'auxiliar_causacion' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'la publicación por un auxiliar de causación',
    );
  });

  it('un contador no puede crear vigencias de tarifas: eso es del administrador tributario', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(
          a.tenantId,
          a.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO uvt_value (tenant_id, anio, valor, vigente_desde, norma_respaldo)
               VALUES ($1, 2027, 5000000, '2027-01-01', 'intento del contador')`,
              [a.tenantId],
            ),
          { rolCodigo: 'contador' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'la creación de una UVT por un contador',
    );
  });

  it('el administrador tributario sí puede crear la vigencia (control del caso anterior)', async () => {
    const id = await db.asTenant(
      a.tenantId,
      a.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO uvt_value (tenant_id, anio, valor, vigente_desde, norma_respaldo)
           VALUES ($1, 2027, 5000000, '2027-01-01',
                   'Valor ficticio de prueba — A1 puebla los reales')
           RETURNING id`,
          [a.tenantId],
        );
        return rows[0]!.id;
      },
      { rolCodigo: 'admin_tributario' },
    );
    expect(id).toBeTruthy();
  });

  it('el rol de solo lectura no escribe en NINGUNA tabla protegida (barrido por catálogo)', async () => {
    const protegidas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; permiso: string }>(
        `SELECT c.relname AS tabla,
                COALESCE(t.tgargs::text, '') AS permiso
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT t.tgisinternal
            AND t.tgname = c.relname || '_permiso'
          ORDER BY 1`,
      );
      return rows.map((r) => r.tabla);
    });

    // Si esta cifra baja, alguien quitó protecciones de escritura.
    expect(protegidas.length).toBeGreaterThanOrEqual(25);

    const escrituras: string[] = [];
    for (const tabla of protegidas) {
      let rechazada = false;
      try {
        await db.asTenant(
          a.tenantId,
          a.companyId,
          (tx) => tx.query(`INSERT INTO public."${tabla}" DEFAULT VALUES`),
          { rolCodigo: 'solo_lectura' },
        );
      } catch (e) {
        rechazada = (e as { code?: string }).code === SQLSTATE.PERMISO_INSUFICIENTE;
      }
      if (!rechazada) escrituras.push(tabla);
    }

    expect(escrituras).toEqual([]);
  });

  it('journal_entry exige un permiso distinto según la transición, no según la tabla', async () => {
    // El auxiliar crea; solo el contador publica.
    const borrador = await db.asTenant(
      a.tenantId,
      a.companyId,
      (tx) => crearAsientoBorrador(tx, a, partidasEquilibradas(a, 33_000_00)),
      { rolCodigo: 'auxiliar_causacion' },
    );

    const publicado = await db.asTenant(
      a.tenantId,
      a.companyId,
      async (tx) => {
        await tx.query('SELECT app.publicar_asiento($1, $2)', [borrador, a.userId]);
        const { rows } = await tx.query<{ estado: string }>(
          'SELECT estado FROM journal_entry WHERE id = $1',
          [borrador],
        );
        return rows[0]!.estado;
      },
      { rolCodigo: 'contador' },
    );

    expect(publicado).toBe('posted');
  });

  it('app.tiene_permiso responde según el rol real de la sesión', async () => {
    const auxiliar = await db.asTenant(
      a.tenantId,
      a.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ crear: boolean; parametro: boolean }>(
          `SELECT app.tiene_permiso('causacion.crear')  AS crear,
                  app.tiene_permiso('parametro.editar') AS parametro`,
        );
        return rows[0]!;
      },
      { rolCodigo: 'auxiliar_causacion' },
    );
    expect(auxiliar.crear).toBe(true);
    expect(auxiliar.parametro).toBe(false);
  });
});

// =============================================================================
describe('Sección 14.1 — audit_log de toda acción sensible', () => {
  it('una aprobación queda registrada con usuario, marca de tiempo e IP', async () => {
    const e = await crearEscenario(db);
    const approvalId = uuid();

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        tx.query(
          `INSERT INTO approval (id, tenant_id, company_id, entidad, entidad_id,
                                 source_document_id, decision, user_id, ip)
           VALUES ($1, $2, $3, 'source_document', $4, $4, 'aprobado', $5, '198.51.100.21')`,
          [approvalId, e.tenantId, e.companyId, e.sourceDocumentId, e.userId],
        ),
      { userId: e.userId, ip: '198.51.100.21', userAgent: 'vitest', requestId: 'req-aprob' },
    );

    const registro = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        user_id: string | null;
        ip: string | null;
        ocurrido_en: string | Date;
      }>(
        `SELECT accion, user_id, host(ip) AS ip, ocurrido_en
           FROM audit_log WHERE entidad = 'approval' AND entidad_id = $1`,
        [approvalId],
      );
      return rows[0];
    });

    expect(registro).toBeDefined();
    expect(registro!.accion).toBe('INSERT');
    expect(registro!.user_id).toBe(e.userId);
    expect(registro!.ip).toBe('198.51.100.21');
    expect(new Date(registro!.ocurrido_en).getTime()).toBeGreaterThan(0);
  });

  it('un cambio de mapeo PUC queda registrado con valor anterior y valor nuevo', async () => {
    const e = await crearEscenario(db);
    const mapeoId = uuid();

    await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        await tx.query(
          `INSERT INTO niif_mapping (id, tenant_id, company_id, account_id, clasificacion_niif,
                                     rubro_eri, vigente_desde, norma_respaldo)
           VALUES ($1, $2, $3, $4, 'gasto', 'Gastos por servicios', '2026-01-01',
                   'NIIF para PYMES, sección 5 — dato de prueba')`,
          [mapeoId, e.tenantId, e.companyId, e.cuentas.gasto],
        );
        await tx.query('UPDATE niif_mapping SET vigente_hasta = $2 WHERE id = $1', [
          mapeoId,
          '2026-12-31',
        ]);
      },
      { userId: e.userId, ip: '198.51.100.22' },
    );

    const registros = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        valor_anterior: Record<string, unknown> | null;
        valor_nuevo: Record<string, unknown> | null;
        ip: string | null;
      }>(
        `SELECT accion, valor_anterior, valor_nuevo, host(ip) AS ip
           FROM audit_log WHERE entidad = 'niif_mapping' AND entidad_id = $1 ORDER BY id`,
        [mapeoId],
      );
      return rows;
    });

    expect(registros.map((r) => r.accion)).toEqual(['INSERT', 'UPDATE']);
    expect(registros[1]!.valor_anterior?.['vigente_hasta']).toBeNull();
    expect(registros[1]!.valor_nuevo?.['vigente_hasta']).toBe('2026-12-31');
    expect(registros[0]!.ip).toBe('198.51.100.22');
  });

  it('la publicación de un asiento queda registrada en el ledger auditado', async () => {
    const e = await crearEscenario(db);
    const entryId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 88_000_00));
      await tx.query('SELECT app.publicar_asiento($1, $2)', [id, e.userId]);
      return id;
    });

    const acciones = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ accion: string }>(
        `SELECT accion FROM audit_log
          WHERE entidad = 'journal_entry' AND entidad_id = $1 ORDER BY id`,
        [entryId],
      );
      return rows.map((r) => r.accion);
    });

    expect(acciones).toEqual(['INSERT', 'UPDATE']);
  });

  it('el intento de entrar a datos de otra empresa deja rastro ACCESO_DENEGADO', async () => {
    const { token } = await db.emitirSesion(a.tenantId, a.companyId, { sesionNueva: true });

    await expect(
      withSessionContext(
        db.client,
        { sessionToken: token, companyId: b.companyId, ip: '203.0.113.77', userAgent: 'vitest' },
        async (tx) => tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(EmpresaNoAutorizadaError);

    const registro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        entidad: string;
        entidad_id: string;
        user_id: string | null;
        ip: string | null;
        tenant_id: string;
      }>(
        `SELECT accion, entidad, entidad_id, user_id, host(ip) AS ip, tenant_id
           FROM audit_log
          WHERE accion = 'ACCESO_DENEGADO' AND entidad = 'company' AND entidad_id = $1
          ORDER BY id DESC LIMIT 1`,
        [b.companyId],
      );
      return rows[0];
    });

    expect(registro).toBeDefined();
    expect(registro!.ip).toBe('203.0.113.77');
    expect(registro!.tenant_id).toBe(a.tenantId);
    expect(registro!.user_id).not.toBeNull();
  });

  it('el audit_log de una firma no es visible desde otra', async () => {
    const visible = await db.asTenant(b.tenantId, b.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`,
        [a.tenantId],
      );
      return rows[0]!.n;
    });
    expect(visible).toBe(0);
  });

  it('el audit_log nunca guarda credenciales: se redactan antes de escribir', async () => {
    const e = await crearEscenario(db);
    const nuevoId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, nombre_completo, password_hash, mfa_secret_cifrado)
         VALUES ($1, $2, 'Con credencial', 'scrypt$N=16384,r=8,p=1$c2Fs$Y2xhdmU',
                 'gcm1$aXY$dGFn$Y3Q')
         RETURNING id`,
        [e.tenantId, `redactado-${Date.now()}@ejemplo.co`],
      );
      return rows[0]!.id;
    });

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ valor_nuevo: Record<string, unknown> }>(
        `SELECT valor_nuevo FROM audit_log
          WHERE entidad = 'user' AND entidad_id = $1 ORDER BY id DESC LIMIT 1`,
        [nuevoId],
      );
      return rows[0]!.valor_nuevo;
    });

    expect(fila['password_hash']).toBe('[redactado]');
    expect(fila['mfa_secret_cifrado']).toBe('[redactado]');
  });

  it('el audit_log sigue siendo append-only, ni para el superusuario', async () => {
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query("UPDATE audit_log SET accion = 'LOGIN' WHERE id > 0")),
      SQLSTATE.AUDITORIA_INMUTABLE,
      'el UPDATE sobre audit_log',
    );
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM audit_log WHERE id > 0')),
      SQLSTATE.AUDITORIA_INMUTABLE,
      'el DELETE sobre audit_log',
    );
  });
});

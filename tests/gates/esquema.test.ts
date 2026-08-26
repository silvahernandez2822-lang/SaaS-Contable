/**
 * Invariantes del esquema — Agente A2, Ola 0.
 *
 * Esta suite no prueba comportamiento: prueba que el esquema no se degrade.
 * Está pensada para las olas siguientes: si A1, A6 o A9 agregan una tabla sin
 * RLS, con una columna `float` o con vigencias sin proteger, aquí se ve.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import { migrate } from '../../src/db/migrate.js';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

/** Tablas de infraestructura, no de datos de negocio. */
const SIN_RLS = ['schema_migration'];

describe('Regla de Oro 7 — RLS en todas las tablas de datos', () => {
  it('toda tabla tiene ROW LEVEL SECURITY habilitada Y forzada', async () => {
    const faltantes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; habilitada: boolean; forzada: boolean }>(
        `SELECT c.relname AS tabla, c.relrowsecurity AS habilitada, c.relforcerowsecurity AS forzada
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND NOT (c.relname = ANY($1))
            AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
          ORDER BY c.relname`,
        [SIN_RLS],
      );
      return rows;
    });

    // Sin FORCE, el dueño de la tabla queda exento y la política es decorativa.
    expect(faltantes).toEqual([]);
  });

  it('toda tabla con RLS tiene al menos una política', async () => {
    const sinPolitica = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string }>(
        `SELECT c.relname AS tabla
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
            AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
          ORDER BY c.relname`,
      );
      return rows.map((r) => r.tabla);
    });
    expect(sinPolitica).toEqual([]);
  });

  it('toda tabla con tenant_id tiene una política que filtra por tenant', async () => {
    const sospechosas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string }>(
        `SELECT c.relname AS tabla
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM pg_policy p
               WHERE p.polrelid = c.oid
                 AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_tenant_id%')
          ORDER BY c.relname`,
      );
      return rows.map((r) => r.tabla);
    });
    expect(sospechosas).toEqual([]);
  });

  it('toda vista se ejecuta con security_invoker: una vista no puede ser puerta trasera de la RLS', async () => {
    const inseguras = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ vista: string }>(
        `SELECT c.relname AS vista
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'v'
            AND NOT COALESCE(
                  array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false)
          ORDER BY c.relname`,
      );
      return rows.map((r) => r.vista);
    });
    expect(inseguras).toEqual([]);
  });
});

describe('Regla de Oro 5 — el dinero es entero', () => {
  it('no existe ninguna columna float, double precision ni money', async () => {
    const prohibidas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; columna: string; tipo: string }>(
        `SELECT table_name AS tabla, column_name AS columna, data_type AS tipo
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND data_type IN ('real', 'double precision', 'money')
          ORDER BY table_name, column_name`,
      );
      return rows;
    });
    expect(prohibidas).toEqual([]);
  });

  it('las tarifas son numeric con escala fija, no enteros ni texto', async () => {
    const tarifas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; columna: string; tipo: string }>(
        `SELECT table_name AS tabla, column_name AS columna, data_type AS tipo
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (column_name = 'tarifa' OR column_name LIKE 'tarifa\\_%')
          ORDER BY table_name, column_name`,
      );
      return rows;
    });
    expect(tarifas.length).toBeGreaterThan(0);
    expect(tarifas.every((t) => t.tipo === 'numeric')).toBe(true);
  });
});

describe('Regla de Oro 3 — estructura de vigencias', () => {
  it('toda tabla con vigente_desde tiene también vigente_hasta, norma_respaldo y clave_vigencia', async () => {
    const incompletas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; faltan: string }>(
        `WITH parametricas AS (
           SELECT table_name
             FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'vigente_desde'
         )
         SELECT p.table_name AS tabla,
                string_agg(req.col, ', ') AS faltan
           FROM parametricas p
           CROSS JOIN (VALUES ('vigente_hasta'), ('norma_respaldo'), ('clave_vigencia')) AS req(col)
          WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema = 'public'
                     AND c.table_name = p.table_name
                     AND c.column_name = req.col)
          GROUP BY p.table_name
          ORDER BY p.table_name`,
      );
      return rows;
    });
    expect(incompletas).toEqual([]);
  });

  it('toda tabla paramétrica lleva los dos triggers de vigencia', async () => {
    const sinTriggers = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; triggers: number }>(
        `WITH parametricas AS (
           SELECT DISTINCT table_name
             FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'clave_vigencia'
         )
         SELECT p.table_name AS tabla,
                (SELECT count(*)::int FROM pg_trigger t
                  WHERE t.tgrelid = ('public.' || quote_ident(p.table_name))::regclass
                    AND NOT t.tgisinternal
                    AND t.tgname LIKE '%_vigencia_%') AS triggers
           FROM parametricas p
          ORDER BY p.table_name`,
      );
      return rows;
    });

    expect(sinTriggers.length).toBeGreaterThanOrEqual(9);
    for (const t of sinTriggers) {
      expect(`${t.tabla}:${t.triggers}`).toBe(`${t.tabla}:2`);
    }
  });

  it('toda tabla paramétrica queda auditada', async () => {
    const sinAuditoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string }>(
        `WITH parametricas AS (
           SELECT DISTINCT table_name
             FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'clave_vigencia'
         )
         SELECT p.table_name AS tabla
           FROM parametricas p
          WHERE NOT EXISTS (
            SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = ('public.' || quote_ident(p.table_name))::regclass
               AND NOT t.tgisinternal
               AND t.tgname = p.table_name || '_audit')
          ORDER BY p.table_name`,
      );
      return rows.map((r) => r.tabla);
    });
    expect(sinAuditoria).toEqual([]);
  });
});

describe('Sección 15 — relaciones obligatorias del modelo núcleo', () => {
  it('journal_entry.source_document_id y approval_id son NOT NULL', async () => {
    const cols = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='journal_entry'
            AND column_name IN ('source_document_id','approval_id','fiscal_period_id')`,
      );
      return rows;
    });
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.is_nullable === 'NO')).toBe(true);
  });

  it('journal_line.account_id es NOT NULL', async () => {
    const col = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='journal_line' AND column_name='account_id'`,
      );
      return rows[0]!;
    });
    expect(col.is_nullable).toBe('NO');
  });

  it('retention_applied.tax_rule_id y regla_vigente_desde son NOT NULL y van amarrados por FK compuesta', async () => {
    const resultado = await db.asAdmin(async (tx) => {
      const { rows: cols } = await tx.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='retention_applied'
            AND column_name IN ('tax_rule_id','regla_vigente_desde')`,
      );
      const { rows: fk } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'public.retention_applied'::regclass
            AND contype = 'f'
            AND array_length(conkey, 1) = 2
            AND confrelid = 'public.tax_rule'::regclass`,
      );
      return { cols, fks: fk[0]!.n };
    });
    expect(resultado.cols).toHaveLength(2);
    expect(resultado.cols.every((c) => c.is_nullable === 'NO')).toBe(true);
    expect(resultado.fks).toBe(1);
  });

  it('todas las tablas de la sección 15 existen con su nombre literal', async () => {
    const esperadas = [
      'tenant', 'company', 'fiscal_period', 'user', 'role', 'user_company_access',
      'account', 'niif_mapping', 'cost_center',
      'third_party', 'third_party_activity',
      'journal_entry', 'journal_line',
      'tax_rule', 'uvt_value', 'smmlv_value', 'municipality', 'ciiu_activity',
      'tax_calendar', 'rounding_rule',
      'concepto_causacion', 'memoria_clasificacion',
      'source_document', 'extraction', 'retention_applied',
      'approval', 'audit_log',
    ];
    const existentes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'`,
      );
      return new Set(rows.map((r) => r.table_name));
    });
    expect(esperadas.filter((t) => !existentes.has(t))).toEqual([]);
  });

  it('source_document reserva el espacio de RADIAN sin implementarlo', async () => {
    const columnas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='source_document'
            AND column_name LIKE 'radian%'
          ORDER BY column_name`,
      );
      return rows.map((r) => r.column_name);
    });
    expect(columnas).toContain('radian_estado');
    expect(columnas).toContain('radian_aceptacion_en');
    expect(columnas).toContain('radian_fecha_limite_aceptacion');
    expect(columnas.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Sección 14.1 — modelo de roles y permisos', () => {
  it('existen los cinco roles mínimos como roles de sistema', async () => {
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

  it('solo el administrador tributario y el de firma pueden editar parámetros', async () => {
    const conPermiso = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        `SELECT r.codigo FROM role r
           JOIN role_permission rp ON rp.role_id = r.id
          WHERE rp.permission_codigo = 'parametro.editar'
          ORDER BY r.codigo`,
      );
      return rows.map((r) => r.codigo);
    });
    expect(conPermiso).toEqual(['admin_firma', 'admin_tributario']);
  });

  it('el auxiliar de causación no puede aprobar ni publicar', async () => {
    const permisos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permission_codigo: string }>(
        `SELECT rp.permission_codigo FROM role r
           JOIN role_permission rp ON rp.role_id = r.id
          WHERE r.codigo = 'auxiliar_causacion'`,
      );
      return rows.map((r) => r.permission_codigo);
    });
    expect(permisos).not.toContain('causacion.aprobar');
    expect(permisos).not.toContain('asiento.publicar');
    expect(permisos).not.toContain('parametro.editar');
    expect(permisos).toContain('causacion.crear');
  });

  it('el rol solo_lectura no tiene ningún permiso de escritura', async () => {
    const permisos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permission_codigo: string }>(
        `SELECT rp.permission_codigo FROM role r
           JOIN role_permission rp ON rp.role_id = r.id
          WHERE r.codigo = 'solo_lectura'`,
      );
      return rows.map((r) => r.permission_codigo);
    });
    expect(permisos.every((p) => p.endsWith('.leer'))).toBe(true);
  });
});

describe('Runner de migraciones', () => {
  it('aplicar de nuevo no cambia nada (idempotente)', async () => {
    const resultado = await migrate(db.client);
    expect(resultado.aplicadas).toEqual([]);
    expect(resultado.yaAplicadas.length).toBeGreaterThanOrEqual(14);
  });

  it('rechaza una migración ya aplicada cuyo contenido cambió', async () => {
    await db.asAdmin((tx) =>
      tx.query("UPDATE schema_migration SET checksum = 'alterado' WHERE version = 1"),
    );
    await expect(migrate(db.client)).rejects.toThrow(/ya fue aplicada y su contenido cambió/);
    await db.asAdmin((tx) =>
      tx.query("DELETE FROM schema_migration WHERE checksum = 'alterado'"),
    );
  });
});

/**
 * D-086 · Catálogo geográfico DANE + dirección en formato DIAN.
 *
 *   PARTE A — tabla department, FK municipality.department_id resuelta por
 *             trigger, selector dependiente, catálogo completo (spot-check de
 *             conteos contra 3 departamentos).
 *   PARTE B — third_party.direccion_dian: la cadena se recompone en el
 *             servidor, no se admite texto libre; marcas de revisión.
 *   Migración de datos — el backfill de la migración 175 marca (no borra, no
 *             adivina) los terceros heredados.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { seed } from '../../src/db/seed';
import {
  crearTercero,
  editarTercero,
  listarDepartamentosParaSelector,
  listarGeografiaParaSelector,
  obtenerTercero,
  DireccionDianInvalidaError,
} from '../../src/services/terceros';

const GEO_DIR = fileURLToPath(new URL('../../db/seeds/tanda0-geografia', import.meta.url));

/** Espejo del backfill de la migración 175 (PARTE B). En una base ya migrada,
 *  un tercero heredado que se inserta después hay que marcarlo con la misma
 *  regla; esto reproduce esas tres sentencias, textualmente. */
const BACKFILL_175 = `
  UPDATE third_party tp SET department_id = mu.department_id
    FROM municipality mu
   WHERE tp.municipality_id = mu.id AND mu.department_id IS NOT NULL AND tp.department_id IS NULL;
  UPDATE third_party SET municipio_requiere_revision = true
   WHERE es_del_exterior = false AND municipality_id IS NULL;
  UPDATE third_party SET direccion_requiere_revision = true
   WHERE es_del_exterior = false AND direccion_dian IS NULL AND direccion_requiere_revision = false;
`;

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  await db.asAdmin((tx) => seed(tx, { dir: GEO_DIR }));
  e = await crearEscenario(db);
});

afterAll(async () => {
  await db.close();
});

describe('PARTE A — catálogo geográfico', () => {
  it('los 33 departamentos DANE están cargados, incluida Bogotá D.C.', async () => {
    const deps = await db.asTenant(e.tenantId, e.companyId, (tx) => listarDepartamentosParaSelector(tx));
    expect(deps).toHaveLength(33);
    expect(deps.map((d) => d.codigo)).toContain('11');
    expect(deps.find((d) => d.codigo === '11')?.nombre).toMatch(/Bogotá/);
  });

  it('spot-check de conteo de municipios contra 3 departamentos distintos', async () => {
    const conteo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ cod: string; n: number }>(
        `SELECT d.codigo_dane_dpto AS cod, count(*)::int AS n
           FROM municipality m JOIN department d ON d.id = m.department_id
          WHERE m.tenant_id IS NULL
          GROUP BY d.codigo_dane_dpto`,
      );
      return Object.fromEntries(rows.map((r) => [r.cod, r.n]));
    });
    expect(conteo['05']).toBe(125); // Antioquia
    expect(conteo['15']).toBe(123); // Boyacá
    expect(conteo['52']).toBe(64); //  Nariño
    const total = Object.values(conteo).reduce((a, b) => a + b, 0);
    expect(total).toBe(1122);
  });

  it('municipality.department_id lo resuelve el trigger desde el código', async () => {
    const sinDept = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM municipality WHERE tenant_id IS NULL AND department_id IS NULL`,
      );
      return rows[0]!.n;
    });
    expect(sinDept).toBe(0);
  });

  it('el selector dependiente filtra municipios por departamento', async () => {
    const geo = await db.asTenant(e.tenantId, e.companyId, (tx) => listarGeografiaParaSelector(tx));
    const bogota = geo.departamentos.find((d) => d.codigo === '11')!;
    const munBogota = geo.municipios.filter((m) => m.departmentId === bogota.id);
    // El catálogo DANE aporta 11001; el escenario de prueba añade su propio
    // municipio ficticio en el mismo departamento (tenant-scoped) — ambos
    // cuelgan de Bogotá por el trigger de resolución.
    expect(munBogota.map((m) => m.codigoDane)).toContain('11001');

    const antioquia = geo.departamentos.find((d) => d.codigo === '05')!;
    expect(geo.municipios.filter((m) => m.departmentId === antioquia.id)).toHaveLength(125);
  });
});

describe('PARTE B — dirección DIAN', () => {
  async function municipioBogota(): Promise<string> {
    return db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '11001'`,
      );
      return rows[0]!.id;
    });
  }

  it('crear con desglose DIAN guarda la cadena compuesta y el jsonb, sin marca de revisión', async () => {
    const munId = await municipioBogota();
    const id = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      crearTercero(tx, {
        tipoDocumento: 'NIT',
        numeroDocumento: `900${Date.now()}`,
        tipoPersona: 'juridica',
        razonSocial: 'Con dirección DIAN SAS',
        municipalityId: munId,
        direccionDian: {
          tipoVia: 'CL',
          numeroVia: '100',
          numeroGeneradora: '15',
          placa: '20',
          complementos: [{ tipo: 'OF', valor: '501' }],
        },
      }),
    );
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id.id));
    expect(t?.direccion).toBe('CL 100 # 15 - 20 OF 501');
    expect(t?.direccionDian?.tipoVia).toBe('CL');
    expect(t?.direccionRequiereRevision).toBe(false);
    expect(t?.departmentId).toBeTruthy();
    expect(t?.departmentNombre).toMatch(/Bogotá/);
  });

  it('rechaza un desglose inválido en el servidor (no solo en la interfaz)', async () => {
    const munId = await municipioBogota();
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        crearTercero(tx, {
          tipoDocumento: 'NIT',
          numeroDocumento: `901${Date.now()}`,
          tipoPersona: 'juridica',
          razonSocial: 'Dirección inválida SAS',
          municipalityId: munId,
          direccionDian: { tipoVia: 'CL', numeroVia: '100', numeroGeneradora: '', placa: '20' },
        }),
      ),
    ).rejects.toThrow(DireccionDianInvalidaError);
  });

  it('una dirección de texto libre (carga masiva) se guarda sin jsonb', async () => {
    const munId = await municipioBogota();
    const id = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      crearTercero(tx, {
        tipoDocumento: 'NIT',
        numeroDocumento: `902${Date.now()}`,
        tipoPersona: 'juridica',
        razonSocial: 'Texto libre SAS',
        municipalityId: munId,
        direccion: 'Calle 123 # 45-67, oficina 890',
      }),
    );
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id.id));
    expect(t?.direccion).toBe('Calle 123 # 45-67, oficina 890');
    expect(t?.direccionDian).toBeNull();
  });

  it('editar con desglose DIAN apaga la marca de revisión de dirección', async () => {
    const munId = await municipioBogota();
    const id = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      crearTercero(tx, {
        tipoDocumento: 'NIT',
        numeroDocumento: `903${Date.now()}`,
        tipoPersona: 'juridica',
        razonSocial: 'Para revisar SAS',
        municipalityId: munId,
        direccion: 'algo viejo sin estructura',
      }),
    );
    await db.asAdmin((tx) =>
      tx.query('UPDATE third_party SET direccion_requiere_revision = true WHERE id = $1', [id.id]),
    );
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      editarTercero(tx, id.id, {
        tipoDocumento: 'NIT',
        numeroDocumento: `903${Date.now()}`,
        tipoPersona: 'juridica',
        razonSocial: 'Para revisar SAS',
        municipalityId: munId,
        direccionDian: { tipoVia: 'CR', numeroVia: '7', numeroGeneradora: '12', placa: '45' },
      }),
    );
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id.id));
    expect(t?.direccion).toBe('CR 7 # 12 - 45');
    expect(t?.direccionRequiereRevision).toBe(false);
  });
});

describe('Migración de datos — backfill de la migración 175', () => {
  it('marca los terceros heredados sin borrar ni adivinar', async () => {
    // Tercero "heredado": dirección en texto libre, sin desglose, sin marcas.
    const legacyId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social,
                                  municipality_id, direccion)
         SELECT $1, $2, $3, 'juridica', 'Heredado SAS', m.id, 'Diagonal 45 sector norte'
           FROM municipality m WHERE m.tenant_id IS NULL AND m.codigo_dane = '11001'
         RETURNING id`,
        [e.tenantId, e.companyId, `904${Date.now()}`],
      );
      await tx.query(
        `UPDATE third_party SET direccion_requiere_revision = false, municipio_requiere_revision = false,
                                department_id = NULL WHERE id = $1`,
        [rows[0]!.id],
      );
      return rows[0]!.id;
    });

    await db.asAdmin((tx) => tx.exec(BACKFILL_175));

    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, legacyId));
    expect(t?.direccionRequiereRevision).toBe(true); // marcado
    expect(t?.direccion).toBe('Diagonal 45 sector norte'); // texto original intacto
    expect(t?.departmentId).toBeTruthy(); // department_id resuelto desde el municipio
  });

  it('un tercero con desglose DIAN NO se marca al re-aplicar el backfill', async () => {
    const munId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '11001'`,
      );
      return rows[0]!.id;
    });
    const id = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      crearTercero(tx, {
        tipoDocumento: 'NIT',
        numeroDocumento: `905${Date.now()}`,
        tipoPersona: 'juridica',
        razonSocial: 'Ya normalizado SAS',
        municipalityId: munId,
        direccionDian: { tipoVia: 'CL', numeroVia: '9', numeroGeneradora: '9', placa: '9' },
      }),
    );
    await db.asAdmin((tx) => tx.exec(BACKFILL_175));
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id.id));
    expect(t?.direccionRequiereRevision).toBe(false);
  });
});

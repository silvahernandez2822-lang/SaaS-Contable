/**
 * A1 — verificación del catálogo de formatos de exógena (sección 7.7).
 *
 * Depende de la migración 019 (`exogena_format`, nueva tabla, rango
 * reservado de A1, ver esa migración para la justificación) y del seed
 * `db/seeds/tanda2/080_exogena_formatos.sql`.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { seed } from '../../src/db/seed.js';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

describe('A1 · exogena_format — sección 7.7', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: SEEDS_DIR });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('carga los 12 formatos citados en la sección 7.7, todos con norma_respaldo', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ formato_codigo: string; norma_respaldo: string }>(
        `SELECT formato_codigo, norma_respaldo FROM exogena_format
          WHERE tenant_id IS NULL ORDER BY formato_codigo`,
      ),
    );
    expect(rows.map((r) => r.formato_codigo)).toEqual([
      '1001', '1003', '1005', '1006', '1007', '1008', '1009', '1010', '1012', '2276', '2820', '2833',
    ]);
    for (const r of rows) expect(r.norma_respaldo.length).toBeGreaterThan(0);
  });

  it('NO fuerza el tope general de 2.400 UVT dentro de tope_uvt (no es un tope por formato)', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM exogena_format WHERE tenant_id IS NULL AND tope_uvt IS NOT NULL`,
      ),
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('el Formato 1001 documenta la exigencia de dirección/municipio del informado', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ notas: string }>(
        `SELECT notas FROM exogena_format WHERE tenant_id IS NULL AND formato_codigo = '1001'`,
      ),
    );
    expect(rows[0]!.notas).toMatch(/dirección/i);
  });

  it('es idempotente', async () => {
    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: SEEDS_DIR });
    });
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::int AS n FROM exogena_format WHERE tenant_id IS NULL`),
    );
    expect(Number(rows[0]!.n)).toBe(12);
  });
});

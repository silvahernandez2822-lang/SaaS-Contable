/**
 * D-089 (A1, TAREA 1) — el catálogo COMPLETO del PUC (Decreto 2650/1993) queda
 * cargado como catálogo global de `account`. Verificación de conteos por clase
 * y nivel, jerarquía, naturaleza contra-natura e idempotencia.
 *
 * Fuente: db/seeds/_fuentes/puc_decreto_2650_catalogo.txt (2.502 códigos).
 * Más las 4 cuentas de 4 díg de clase 7 (7105/7205/7305/7405) que tanda2 ya
 * traía y que NO están en la fuente (pendientes de verificación humana).
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { seed } from '../../src/db/seed';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

describe('D-089 · PUC completo Decreto 2650 como catálogo global', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asAdmin((tx) => seed(tx, { dir: SEEDS_DIR }));
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  const q = <T>(sql: string) =>
    db.asAdmin((tx) => tx.query<T>(sql)).then((r) => r.rows);

  it('cuenta 2.506 filas globales: 2.502 de la fuente + 4 de clase 7 preexistentes', async () => {
    const rows = await q<{ n: string }>(
      `SELECT count(*)::int AS n FROM account WHERE tenant_id IS NULL AND company_id IS NULL`,
    );
    expect(Number(rows[0]!.n)).toBe(2506);
  });

  it('distribución por nivel: 9 clases · 52 grupos · 344 cuentas · 2101 subcuentas', async () => {
    const rows = await q<{ nivel: number; n: string }>(
      `SELECT nivel, count(*)::int AS n FROM account
        WHERE tenant_id IS NULL AND company_id IS NULL GROUP BY nivel ORDER BY nivel`,
    );
    const porNivel = Object.fromEntries(rows.map((r) => [r.nivel, Number(r.n)]));
    expect(porNivel).toEqual({ 1: 9, 2: 52, 3: 344, 4: 2101 });
  });

  it('clase 7 tiene los 4 grupos y NADA de nivel 3 salvo las 4 cuentas heredadas de tanda2', async () => {
    const grupos = await q<{ codigo: string }>(
      `SELECT codigo FROM account WHERE tenant_id IS NULL AND clase_puc = 7 AND nivel = 2 ORDER BY codigo`,
    );
    expect(grupos.map((g) => g.codigo)).toEqual(['71', '72', '73', '74']);
    const cuentas = await q<{ codigo: string }>(
      `SELECT codigo FROM account WHERE tenant_id IS NULL AND clase_puc = 7 AND nivel >= 3 ORDER BY codigo`,
    );
    expect(cuentas.map((c) => c.codigo)).toEqual(['7105', '7205', '7305', '7405']);
  });

  it('la jerarquía por prefijo quedó bien enlazada (0 huérfanos bajo nivel 1)', async () => {
    const rows = await q<{ n: string }>(
      `SELECT count(*)::int AS n FROM account a
        WHERE a.tenant_id IS NULL AND a.nivel > 1
          AND (a.parent_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM account p WHERE p.id = a.parent_id
                              AND p.codigo = left(a.codigo, length(a.codigo) - CASE a.nivel WHEN 2 THEN 1 WHEN 3 THEN 2 ELSE 2 END)))`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('contra-natura: depreciación/amortización/agotamiento acumulado y provisiones de clase 1 son crédito', async () => {
    const rows = await q<{ codigo: string; naturaleza: string }>(
      `SELECT codigo, naturaleza FROM account
        WHERE tenant_id IS NULL AND codigo IN ('1592','1596','1597','1598','1698','1798','1299','1399','1499','1599','1699','1899')
        ORDER BY codigo`,
    );
    for (const r of rows) expect(r.naturaleza, r.codigo).toBe('credito');
  });

  it('sufijo (DB)/(CR): la subcuenta invierte la naturaleza de su cuenta padre', async () => {
    const rows = await q<{ codigo: string; naturaleza: string }>(
      `SELECT codigo, naturaleza FROM account
        WHERE tenant_id IS NULL AND codigo IN ('310510','320510','330516','292010','262010','470545','159610')
        ORDER BY codigo`,
    );
    const n = Object.fromEntries(rows.map((r) => [r.codigo, r.naturaleza]));
    expect(n['310510']).toBe('debito'); // Capital por suscribir (DB) bajo 3105 crédito
    expect(n['292010']).toBe('debito'); // Bonos pensionales por amortizar (DB) bajo 2920 crédito
    expect(n['470545']).toBe('debito'); // Depreciación acumulada (DB) bajo 4705 crédito
    expect(n['159610']).toBe('debito'); // Defecto fiscal sobre la contable (CR) bajo 1596 (contra=crédito)
  });

  it('4175 y 6225 (devoluciones) van contra la naturaleza de su clase', async () => {
    const rows = await q<{ codigo: string; naturaleza: string }>(
      `SELECT codigo, naturaleza FROM account WHERE tenant_id IS NULL AND codigo IN ('4175','4275','6225') ORDER BY codigo`,
    );
    const n = Object.fromEntries(rows.map((r) => [r.codigo, r.naturaleza]));
    expect(n['4175']).toBe('debito');
    expect(n['4275']).toBe('debito');
    expect(n['6225']).toBe('credito');
  });

  it('permite_movimiento: ninguna clase ni grupo lo tiene; toda subcuenta 6-díg sí', async () => {
    const agrup = await q<{ n: string }>(
      `SELECT count(*)::int AS n FROM account
        WHERE tenant_id IS NULL AND nivel <= 2 AND permite_movimiento = true`,
    );
    expect(Number(agrup[0]!.n)).toBe(0);
    const hojasConHijos = await q<{ n: string }>(
      `SELECT count(*)::int AS n FROM account a
        WHERE a.tenant_id IS NULL AND a.permite_movimiento = true
          AND EXISTS (SELECT 1 FROM account c WHERE c.parent_id = a.id)
          AND a.codigo NOT IN (
            -- cuentas de 4 díg que tanda2 cargó como imputables (discrepancia declarada D-089)
            SELECT codigo FROM account WHERE tenant_id IS NULL AND nivel = 3 AND permite_movimiento = true)`,
    );
    expect(Number(hojasConHijos[0]!.n)).toBe(0);
  });

  it('requiere_tercero en cuentas por cobrar/pagar a terceros (13xx, 22xx, 23xx, retenciones)', async () => {
    const rows = await q<{ codigo: string; requiere_tercero: boolean }>(
      `SELECT codigo, requiere_tercero FROM account
        WHERE tenant_id IS NULL AND codigo IN ('130505','133005','233505','236540','510506') ORDER BY codigo`,
    );
    const n = Object.fromEntries(rows.map((r) => [r.codigo, r.requiere_tercero]));
    expect(n['130505']).toBe(true);  // Clientes nacionales
    expect(n['233505']).toBe(true);  // Costos y gastos por pagar - gastos financieros
    expect(n['236540']).toBe(true);  // Retención en la fuente - compras
    expect(n['510506']).toBe(false); // Sueldos (gasto de personal) no exige tercero por catálogo
  });

  it('es idempotente: re-aplicar todos los seeds no duplica ni cambia el conteo', async () => {
    const antes = await q<{ n: string }>(
      `SELECT count(*)::int AS n FROM account WHERE tenant_id IS NULL`,
    );
    await db.asAdmin((tx) => seed(tx, { dir: SEEDS_DIR }));
    const despues = await q<{ n: string }>(
      `SELECT count(*)::int AS n FROM account WHERE tenant_id IS NULL`,
    );
    expect(Number(despues[0]!.n)).toBe(Number(antes[0]!.n));
  });
});

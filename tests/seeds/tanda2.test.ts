/**
 * A1 — verificación de la TANDA 2 de datos normativos (resto de la sección
 * 6/7): PUC operativo + mapeo NIIF, catálogo CIIU ampliado, municipios
 * restantes de la 7.5, IVA (7.6), autorretención por CIIU (7.3, ejemplos) y
 * el resto de retefuente de la 7.2.
 *
 * Corre tanda1 + tanda2 juntas (tanda2 depende de cuentas creadas en
 * tanda1, como 2365/2367/2368) usando `seed(tx)` sin `dir`, que aplica
 * `db/seeds` completo en orden.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { seed } from '../../src/db/seed.js';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

describe('A1 · seeds tanda 1 + tanda 2 — resto de la sección 6/7', () => {
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

  it('es idempotente: correr todos los seeds una segunda vez no falla ni duplica', async () => {
    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: SEEDS_DIR });
    });
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::int AS n FROM account WHERE tenant_id IS NULL`),
    );
    const primero = Number(rows[0]!.n);
    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: SEEDS_DIR });
    });
    const { rows: segunda } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::int AS n FROM account WHERE tenant_id IS NULL`),
    );
    expect(Number(segunda[0]!.n)).toBe(primero);
  });

  describe('7.8 PUC operativo y NIIF', () => {
    it('las 9 clases del PUC existen', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo: string }>(
          `SELECT codigo FROM account WHERE tenant_id IS NULL AND nivel = 1 ORDER BY codigo`,
        ),
      );
      expect(rows.map((r) => r.codigo)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    });

    it('la jerarquía 2365 (retención en la fuente) cuelga de 23 y de 2', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo: string; nivel: number; parent_codigo: string | null }>(
          `SELECT a.codigo, a.nivel, p.codigo AS parent_codigo
             FROM account a LEFT JOIN account p ON p.id = a.parent_id
            WHERE a.tenant_id IS NULL AND a.codigo = '2365'`,
        ),
      );
      expect(rows[0]!.nivel).toBe(3);
      expect(rows[0]!.parent_codigo).toBe('23');
    });

    it('1592 (depreciación acumulada) es de naturaleza crédito aunque esté bajo el activo', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ naturaleza: string }>(
          `SELECT naturaleza FROM account WHERE tenant_id IS NULL AND codigo = '1592'`,
        ),
      );
      expect(rows[0]!.naturaleza).toBe('credito');
    });

    it('carga mapeo NIIF para las cuentas principales, todas marcadas para verificación', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ n: string }>(
          `SELECT count(*)::int AS n FROM niif_mapping
             WHERE tenant_id IS NULL AND requiere_verificacion_humana = true`,
        ),
      );
      expect(Number(rows[0]!.n)).toBeGreaterThan(20);
    });
  });

  describe('7.3 Autorretención por CIIU — 4 ejemplos, no la tabla completa', () => {
    it('carga exactamente 4 filas, todas requiere_verificacion_humana = true', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo: string; tarifa: string; requiere_verificacion_humana: boolean }>(
          `SELECT ci.codigo, r.tarifa, r.requiere_verificacion_humana
             FROM tax_rule r
             JOIN tax_concept tc ON tc.id = r.tax_concept_id
             JOIN ciiu_activity ci ON ci.id = r.ciiu_activity_id
            WHERE tc.codigo = 'autorretencion_renta_ciiu' AND r.tenant_id IS NULL
            ORDER BY ci.codigo`,
        ),
      );
      expect(rows.map((r) => r.codigo)).toEqual(['0510', '4711', '6411', '7110']);
      for (const r of rows) expect(r.requiere_verificacion_humana).toBe(true);
      const porCodigo = Object.fromEntries(rows.map((r) => [r.codigo, Number(r.tarifa)]));
      expect(porCodigo['4711']).toBe(0.011);
      expect(porCodigo['7110']).toBe(0.022);
      expect(porCodigo['0510']).toBe(0.032);
      expect(porCodigo['6411']).toBe(0.044);
    });

    it('se registra como anticipo de impuestos (1355), no como retención a terceros (2365)', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo: string }>(
          `SELECT a.codigo FROM tax_rule r
             JOIN tax_concept tc ON tc.id = r.tax_concept_id
             JOIN account a ON a.id = r.account_id
            WHERE tc.codigo = 'autorretencion_renta_ciiu' AND r.tenant_id IS NULL
            LIMIT 1`,
        ),
      );
      expect(rows[0]!.codigo).toBe('1355');
    });
  });

  describe('7.5 ReteICA — resto de municipios', () => {
    it('Barranquilla queda completo: 4/27 UVT, tarifa de la actividad', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ base_minima_servicios_uvt: string; base_minima_compras_uvt: string }>(
          `SELECT ir.base_minima_servicios_uvt, ir.base_minima_compras_uvt
             FROM municipality_ica_rule ir JOIN municipality m ON m.id = ir.municipality_id
            WHERE m.codigo_dane = '08001' AND ir.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.base_minima_servicios_uvt)).toBe(4);
      expect(Number(rows[0]!.base_minima_compras_uvt)).toBe(27);
    });

    it('Bucaramanga y Cartagena tienen identidad (DANE) pero NO regla de ICA — marcados (verificar) en la 7.5', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo_dane: string; tiene_regla: boolean }>(
          `SELECT m.codigo_dane, EXISTS (
             SELECT 1 FROM municipality_ica_rule ir WHERE ir.municipality_id = m.id
           ) AS tiene_regla
           FROM municipality m WHERE m.codigo_dane IN ('68001','13001') AND m.tenant_id IS NULL
           ORDER BY m.codigo_dane`,
        ),
      );
      expect(rows.length).toBe(2);
      for (const r of rows) expect(r.tiene_regla).toBe(false);
    });
  });

  describe('7.6 IVA', () => {
    it('19% general, 5% reducida, 0% exenta, todas contra la cuenta 2408', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo: string; tarifa: string; cuenta: string }>(
          `SELECT tc.codigo, r.tarifa, a.codigo AS cuenta
             FROM tax_rule r
             JOIN tax_concept tc ON tc.id = r.tax_concept_id
             JOIN account a ON a.id = r.account_id
            WHERE tc.tipo = 'iva' AND r.tenant_id IS NULL
            ORDER BY tc.codigo`,
        ),
      );
      expect(rows.length).toBe(3);
      for (const r of rows) expect(r.cuenta).toBe('2408');
      const porCodigo = Object.fromEntries(rows.map((r) => [r.codigo, Number(r.tarifa)]));
      expect(porCodigo['iva_general']).toBe(0.19);
      expect(porCodigo['iva_reducida']).toBe(0.05);
      expect(porCodigo['iva_exenta']).toBe(0);
    });
  });

  describe('7.2 resto de retefuente — comparador de base mínima (columna de A3)', () => {
    it('productos agrícolas usa comparador "mayor" (>70 UVT, no >=70 UVT)', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ tarifa: string; base_minima_uvt: string; comparador_base_minima: string }>(
          `SELECT r.tarifa, r.base_minima_uvt, r.comparador_base_minima
             FROM tax_rule r JOIN tax_concept tc ON tc.id = r.tax_concept_id
            WHERE tc.codigo = 'productos_agricolas' AND r.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.tarifa)).toBe(0.015);
      expect(Number(rows[0]!.base_minima_uvt)).toBe(70);
      expect(rows[0]!.comparador_base_minima).toBe('mayor');
    });

    it('el resto de conceptos usa el comparador por defecto "mayor_o_igual"', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ comparador_base_minima: string }>(
          `SELECT r.comparador_base_minima
             FROM tax_rule r JOIN tax_concept tc ON tc.id = r.tax_concept_id
            WHERE tc.codigo = 'servicios_generales' AND r.aplica_a = 'declarante' AND r.tenant_id IS NULL`,
        ),
      );
      expect(rows[0]!.comparador_base_minima).toBe('mayor_o_igual');
    });
  });

  describe('Advertencia 17.5 — toda fila con vigencia lleva su norma_respaldo (tanda 1 + 2)', () => {
    it('ninguna fila global de uvt_value, tax_rule ni municipality_ica_rule tiene norma_respaldo vacía', async () => {
      const tablas = ['uvt_value', 'tax_rule', 'municipality_ica_rule', 'niif_mapping'];
      for (const tabla of tablas) {
        const { rows } = await db.asAdmin((tx) =>
          tx.query<{ n: string }>(
            `SELECT count(*)::int AS n FROM ${tabla}
              WHERE tenant_id IS NULL AND (norma_respaldo IS NULL OR btrim(norma_respaldo) = '')`,
          ),
        );
        expect(Number(rows[0]!.n), `${tabla} tiene filas sin norma_respaldo`).toBe(0);
      }
    });
  });
});

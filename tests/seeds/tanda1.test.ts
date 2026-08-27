/**
 * A1 — verificación de la TANDA 1 de datos normativos (sección 7 del
 * mega-prompt): el conjunto mínimo que desbloquea los 20 casos dorados de la
 * sección 12.
 *
 * Esta prueba NO reemplaza a `tests/adversarial/casos-dorados.test.ts` (esa
 * es de A14, y sigue en `it.todo` hasta que A3 tenga el motor). Lo que prueba
 * aquí es más angosto y es responsabilidad de A1: que los DATOS cargados son
 * los que dice la sección 7, con su norma de respaldo, y que los números
 * bastan aritméticamente para los casos dorados que dependen solo de UVT +
 * tarifa + base (sin necesitar todavía el motor de resolución de A3).
 *
 * Corre con `asAdmin` (D-015: los catálogos globales no se pueden escribir
 * como `app_user`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { seed } from '../../src/db/seed';

const TANDA1_DIR = fileURLToPath(new URL('../../db/seeds/tanda1', import.meta.url));

interface FilaTaxRule {
  tarifa: string;
  base_minima_uvt: string | null;
  aplica_sobre: string;
  aplica_a: string;
  tipo_persona: string;
  norma_respaldo: string;
  vigente_desde: string;
  vigente_hasta: string | null;
}

describe('A1 · seeds tanda 1 — sección 7 del mega-prompt', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: TANDA1_DIR });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('es idempotente: correrla una segunda vez no duplica filas ni falla', async () => {
    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: TANDA1_DIR });
    });
    const conteos = await db.asAdmin(async (tx) => {
      const tablas = ['uvt_value', 'tax_concept', 'tax_rule', 'municipality', 'municipality_ica_rule'];
      const resultado: Record<string, number> = {};
      for (const t of tablas) {
        const { rows } = await tx.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${t}`);
        resultado[t] = Number(rows[0]!.n);
      }
      return resultado;
    });
    expect(conteos.uvt_value).toBe(2);
    expect(conteos.tax_concept).toBe(12); // 10 retefuente + 2 reteiva
    expect(conteos.tax_rule).toBe(14); // 12 retefuente (servicios y compras tienen 2 filas c/u) + 2 reteiva
    expect(conteos.municipality).toBe(3);
    expect(conteos.municipality_ica_rule).toBe(3);
  });

  describe('7.1 UVT', () => {
    it('carga 2025 y 2026 con su norma, y NO carga 2023/2024 (sin norma en la sección 7.1)', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ anio: number; valor: string; vigente_desde: string; vigente_hasta: string | null; norma_respaldo: string }>(
          `SELECT anio, valor, vigente_desde::text, vigente_hasta::text, norma_respaldo
             FROM uvt_value WHERE tenant_id IS NULL ORDER BY anio`,
        ),
      );
      expect(rows.map((r) => r.anio)).toEqual([2025, 2026]);

      const y2025 = rows[0]!;
      expect(Number(y2025.valor)).toBe(4979900);
      expect(y2025.vigente_desde).toBe('2025-01-01');
      expect(y2025.vigente_hasta).toBe('2025-12-31');
      expect(y2025.norma_respaldo).toMatch(/000193 de 2024/);

      const y2026 = rows[1]!;
      expect(Number(y2026.valor)).toBe(5237400);
      expect(y2026.vigente_desde).toBe('2026-01-01');
      expect(y2026.vigente_hasta).toBeNull();
      expect(y2026.norma_respaldo).toMatch(/000238/);
    });
  });

  describe('7.2 Retefuente — tarifas y bases de los casos dorados', () => {
    async function regla(codigo: string, aplicaA?: string, tipoPersona?: string): Promise<FilaTaxRule> {
      const condiciones = [`tc.codigo = $1`, `tc.tipo = 'retefuente'`, `tc.tenant_id IS NULL`];
      const params: unknown[] = [codigo];
      if (aplicaA) {
        params.push(aplicaA);
        condiciones.push(`r.aplica_a = $${params.length}`);
      }
      if (tipoPersona) {
        params.push(tipoPersona);
        condiciones.push(`r.tipo_persona = $${params.length}`);
      }
      const { rows } = await db.asAdmin((tx) =>
        tx.query<FilaTaxRule>(
          `SELECT r.tarifa, r.base_minima_uvt, r.aplica_sobre, r.aplica_a, r.tipo_persona,
                  r.norma_respaldo, r.vigente_desde::text, r.vigente_hasta::text
             FROM tax_rule r JOIN tax_concept tc ON tc.id = r.tax_concept_id
            WHERE ${condiciones.join(' AND ')}`,
          params,
        ),
      );
      expect(rows.length, `esperaba exactamente una fila para ${codigo}/${aplicaA}/${tipoPersona}`).toBe(1);
      return rows[0]!;
    }

    it('servicios generales: 4% declarante, 6% PN no declarante — casos 1 y 2', async () => {
      const declarante = await regla('servicios_generales', 'declarante');
      expect(Number(declarante.tarifa)).toBe(0.04);
      expect(Number(declarante.base_minima_uvt)).toBe(2);

      const noDeclarante = await regla('servicios_generales', 'no_declarante', 'natural');
      expect(Number(noDeclarante.tarifa)).toBe(0.06);
      expect(Number(noDeclarante.base_minima_uvt)).toBe(2);
    });

    it('caso 1: servicio $1.000.000 a declarante retiene $40.000', async () => {
      const r = await regla('servicios_generales', 'declarante');
      expect(1_000_000 * Number(r.tarifa)).toBe(40_000);
    });

    it('caso 2: mismo servicio a PN no declarante retiene $60.000', async () => {
      const r = await regla('servicios_generales', 'no_declarante', 'natural');
      expect(1_000_000 * Number(r.tarifa)).toBe(60_000);
    });

    it('caso 3: base mínima de servicios es 2 UVT = $104.748 con UVT 2026', async () => {
      const r = await regla('servicios_generales', 'declarante');
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ valor: string }>(`SELECT valor FROM uvt_value WHERE anio = 2026 AND tenant_id IS NULL`),
      );
      const baseEnPesos = Number(r.base_minima_uvt) * (Number(rows[0]!.valor) / 100);
      expect(baseEnPesos).toBe(104_748);
      expect(80_000).toBeLessThan(baseEnPesos); // el caso 3 no debe retener
    });

    it('compras generales: 2,5% declarante, 3,5% no declarante, base 10 UVT — casos 4 y 5', async () => {
      const declarante = await regla('compras_generales', 'declarante');
      expect(Number(declarante.tarifa)).toBe(0.025);
      expect(Number(declarante.base_minima_uvt)).toBe(10);
      expect(600_000 * Number(declarante.tarifa)).toBe(15_000); // caso 5

      const noDeclarante = await regla('compras_generales', 'no_declarante');
      expect(Number(noDeclarante.tarifa)).toBe(0.035);
    });

    it('honorarios PJ 11% y PN 10%, desde el primer peso — caso 6', async () => {
      const pj = await regla('honorarios_pj', undefined, 'juridica');
      expect(Number(pj.tarifa)).toBe(0.11);
      expect(Number(pj.base_minima_uvt)).toBe(0);
      expect(200_000 * Number(pj.tarifa)).toBe(22_000);

      const pn = await regla('honorarios_pn', undefined, 'natural');
      expect(Number(pn.tarifa)).toBe(0.1);
    });

    it('arrendamiento de muebles (4%, sin base) vs. inmuebles (3,5%, base 10 UVT) — caso 7', async () => {
      const muebles = await regla('arrendamiento_muebles');
      expect(Number(muebles.tarifa)).toBe(0.04);
      expect(Number(muebles.base_minima_uvt)).toBe(0);
      expect(400_000 * Number(muebles.tarifa)).toBe(16_000);

      const inmuebles = await regla('arrendamiento_inmuebles');
      expect(Number(inmuebles.tarifa)).toBe(0.035);
      expect(Number(inmuebles.base_minima_uvt)).toBe(10);
    });

    it('transporte de carga 1% (base 2 UVT) y de pasajeros 3,5% (base 10 UVT)', async () => {
      const carga = await regla('transporte_carga');
      expect(Number(carga.tarifa)).toBe(0.01);
      expect(Number(carga.base_minima_uvt)).toBe(2);

      const pasajeros = await regla('transporte_pasajeros');
      expect(Number(pasajeros.tarifa)).toBe(0.035);
      expect(Number(pasajeros.base_minima_uvt)).toBe(10);
    });

    it('servicios temporales (1%) y vigilancia/aseo (2%) aplican sobre el AIU — caso 11', async () => {
      const temporales = await regla('servicios_temporales');
      expect(Number(temporales.tarifa)).toBe(0.01);
      expect(temporales.aplica_sobre).toBe('aiu');

      const vigilancia = await regla('vigilancia_aseo');
      expect(Number(vigilancia.tarifa)).toBe(0.02);
      expect(vigilancia.aplica_sobre).toBe('aiu');
      // Caso 11: AIU de $500.000, no el total de $5.000.000.
      expect(500_000 * Number(vigilancia.tarifa)).toBe(10_000);
      expect(5_000_000 * Number(vigilancia.tarifa)).not.toBe(10_000);
    });
  });

  describe('7.4 ReteIVA — caso 1 y caso 12', () => {
    it('15% general sobre el valor del IVA, no sobre la base', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ tarifa: string; aplica_sobre: string }>(
          `SELECT r.tarifa, r.aplica_sobre FROM tax_rule r JOIN tax_concept tc ON tc.id = r.tax_concept_id
            WHERE tc.codigo = 'reteiva_general' AND tc.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.tarifa)).toBe(0.15);
      expect(rows[0]!.aplica_sobre).toBe('valor_iva');
      // Caso 1: IVA de $190.000 (19% de $1.000.000) → ReteIVA $28.500.
      expect(190_000 * Number(rows[0]!.tarifa)).toBe(28_500);
    });

    it('100% para proveedor del exterior — caso 12', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ tarifa: string }>(
          `SELECT r.tarifa FROM tax_rule r JOIN tax_concept tc ON tc.id = r.tax_concept_id
            WHERE tc.codigo = 'reteiva_exterior' AND tc.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.tarifa)).toBe(1);
    });
  });

  describe('7.5 ReteICA — Bogotá, Medellín, Cali (casos 8, 9, 10)', () => {
    it('Bogotá: 4 UVT servicios, 27 UVT compras, tarifa de la actividad', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{
          base_minima_servicios_uvt: string;
          base_minima_compras_uvt: string;
          usa_tarifa_de_actividad: boolean;
          tarifa_general: string | null;
        }>(
          `SELECT ir.base_minima_servicios_uvt, ir.base_minima_compras_uvt, ir.usa_tarifa_de_actividad, ir.tarifa_general
             FROM municipality_ica_rule ir JOIN municipality m ON m.id = ir.municipality_id
            WHERE m.codigo_dane = '11001' AND ir.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.base_minima_servicios_uvt)).toBe(4);
      expect(Number(rows[0]!.base_minima_compras_uvt)).toBe(27);
      expect(rows[0]!.usa_tarifa_de_actividad).toBe(true);
      expect(rows[0]!.tarifa_general).toBeNull();
    });

    it('Medellín: 15 UVT servicios y compras, tarifa GENERAL 2‰ — caso 8', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{
          base_minima_servicios_uvt: string;
          base_minima_compras_uvt: string;
          usa_tarifa_de_actividad: boolean;
          tarifa_general: string | null;
        }>(
          `SELECT ir.base_minima_servicios_uvt, ir.base_minima_compras_uvt, ir.usa_tarifa_de_actividad, ir.tarifa_general
             FROM municipality_ica_rule ir JOIN municipality m ON m.id = ir.municipality_id
            WHERE m.codigo_dane = '05001' AND ir.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.base_minima_servicios_uvt)).toBe(15);
      expect(Number(rows[0]!.base_minima_compras_uvt)).toBe(15);
      expect(rows[0]!.usa_tarifa_de_actividad).toBe(false);
      expect(Number(rows[0]!.tarifa_general)).toBe(0.002);
    });

    it('Cali: 3 UVT servicios, 15 UVT compras, tarifa de la actividad — caso 9', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{
          base_minima_servicios_uvt: string;
          base_minima_compras_uvt: string;
          usa_tarifa_de_actividad: boolean;
        }>(
          `SELECT ir.base_minima_servicios_uvt, ir.base_minima_compras_uvt, ir.usa_tarifa_de_actividad
             FROM municipality_ica_rule ir JOIN municipality m ON m.id = ir.municipality_id
            WHERE m.codigo_dane = '76001' AND ir.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0]!.base_minima_servicios_uvt)).toBe(3);
      expect(Number(rows[0]!.base_minima_compras_uvt)).toBe(15);
      expect(rows[0]!.usa_tarifa_de_actividad).toBe(true);
    });
  });

  describe('PUC mínimo', () => {
    it('carga 2365 (retefuente), 2367 (reteIVA) y 2368 (reteICA) bajo 23 · Cuentas por pagar', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ codigo: string; naturaleza: string; permite_movimiento: boolean }>(
          `SELECT codigo, naturaleza, permite_movimiento FROM account
            WHERE tenant_id IS NULL AND codigo IN ('2365','2367','2368') ORDER BY codigo`,
        ),
      );
      expect(rows.map((r) => r.codigo)).toEqual(['2365', '2367', '2368']);
      for (const r of rows) {
        expect(r.naturaleza).toBe('credito');
        expect(r.permite_movimiento).toBe(true);
      }
    });

    it('los tax_rule de retefuente/reteIVA apuntan a la cuenta PUC correcta', async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ tipo: string; codigo: string }>(
          `SELECT r.tipo, a.codigo FROM tax_rule r JOIN account a ON a.id = r.account_id
            WHERE r.tenant_id IS NULL`,
        ),
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        if (r.tipo === 'retefuente') expect(r.codigo).toBe('2365');
        if (r.tipo === 'reteiva') expect(r.codigo).toBe('2367');
      }
    });
  });

  describe('Advertencia 17.5 — toda fila con vigencia lleva su norma_respaldo', () => {
    it('ninguna fila de uvt_value, tax_rule ni municipality_ica_rule tiene norma_respaldo vacía', async () => {
      const tablas = ['uvt_value', 'tax_rule', 'municipality_ica_rule'];
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

/**
 * D-089 · TAREA 5 (A9) — Exportación a Excel del PUC efectivo de la empresa.
 *
 * Aquí no hay ningún valor tributario: el plan de cuentas es catálogo
 * contable. Se verifica la estructura del libro (secciones 11.2), que las
 * filas de "Datos" coincidan con `v_account_efectivo`, el aislamiento entre
 * empresas (Regla de Oro 7) y que el permiso `parametro.puc.leer` se exija.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { PermisoInsuficienteError, exigirPermiso, PERMISOS } from '../../src/auth/permisos';
import { generarLibroPucEfectivo } from '../../src/reports/puc-efectivo';

let db: TestDb;
let a: Escenario;
let b: Escenario;

const HOJAS = ['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros'];
const CODIGO_PROPIO_A = '519590';

beforeAll(async () => {
  db = await createTestDb();
  a = await crearEscenario(db);
  b = await crearEscenario(db);

  // Cuenta PROPIA de la empresa A (company_id = A): la empresa B no debe verla.
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, $4, 'Cuenta propia de la empresa A', 4, 'debito', true)`,
      [uuid(), a.tenantId, a.companyId, CODIGO_PROPIO_A],
    ),
  );
}, 180_000);

afterAll(async () => {
  await db?.close();
});

function valoresColumna(hoja: import('exceljs').Worksheet, col: number): string[] {
  const out: string[] = [];
  hoja.eachRow((fila, n) => {
    if (n === 1) return;
    out.push(String(fila.getCell(col).value ?? ''));
  });
  return out;
}

describe('estructura del libro', () => {
  it('trae las cuatro hojas obligatorias de la sección 11.2', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => generarLibroPucEfectivo(tx));
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS);
  });

  it('el papel de trabajo lleva el encabezado de empresa / NIT / responsable', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => generarLibroPucEfectivo(tx));
    const texto = valoresColumna(wb.getWorksheet('Papel de trabajo')!, 1).join('\n');
    expect(texto).toContain('NIT:');
    expect(texto).toContain('Responsable:');
    expect(texto).toContain('Modo del PUC');
  });
});

describe('las filas de "Datos" coinciden con v_account_efectivo', () => {
  it('mismo número de cuentas y mismos códigos que la vista', async () => {
    const { wb, codigos } = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const wb = await generarLibroPucEfectivo(tx);
      const { rows } = await tx.query<{ codigo: string }>(
        'SELECT codigo FROM v_account_efectivo ORDER BY codigo',
      );
      return { wb, codigos: rows.map((r) => r.codigo) };
    });
    const datos = wb.getWorksheet('Datos')!;
    expect(datos.rowCount - 1).toBe(codigos.length);
    expect(valoresColumna(datos, 1)).toEqual(codigos);
    expect(valoresColumna(datos, 1)).toContain(CODIGO_PROPIO_A);
  });
});

describe('aislamiento entre empresas (Regla de Oro 7)', () => {
  it('la empresa B no ve la cuenta propia de la empresa A', async () => {
    const wb = await db.asTenant(b.tenantId, b.companyId, (tx) => generarLibroPucEfectivo(tx));
    expect(valoresColumna(wb.getWorksheet('Datos')!, 1)).not.toContain(CODIGO_PROPIO_A);
  });
});

describe('permiso parametro.puc.leer', () => {
  it('un rol sin el permiso no puede exportar el PUC', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO role (tenant_id, codigo, nombre, descripcion, es_sistema)
         VALUES ($1, 'sin_permiso_puc', 'Sin permiso', 'Rol de prueba sin permisos', false)
         RETURNING id`,
        [a.tenantId],
      ),
    );

    await expect(
      db.asTenant(
        a.tenantId,
        a.companyId,
        async (tx) => {
          await exigirPermiso(tx, PERMISOS.PARAMETRO_PUC_LEER);
          return generarLibroPucEfectivo(tx);
        },
        { rolId: rows[0]!.id },
      ),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);
  });
});

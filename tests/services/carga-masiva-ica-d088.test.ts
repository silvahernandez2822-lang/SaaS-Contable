/**
 * D-088 · TAREA 4 — carga masiva de la parametrización de ICA de un municipio
 * completo (layout propio del cliente: encabezado + tabla de actividades).
 *
 * Se comprueba:
 *  - el encabezado crea/reemplaza `municipality_ica_rule` con su tipo de
 *    medición y, cuando aplica, la ventana en meses;
 *  - las actividades de 4 dígitos entran zero-padeadas contra `ciiu_activity`;
 *  - "Gravada = N" ⇒ `tax_rule.gravada = false` y `tarifa = 0`, aunque la celda
 *    de tarifa venga vacía;
 *  - las subclases de 5 dígitos del Distrito y los códigos corruptos NO se
 *    insertan, NO se inventan y NO se callan: salen como fila con error en el
 *    informe, y las buenas se cargan igual.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { importarIcaMunicipio } from '../../src/services/carga-masiva/ica-municipio';

let db: TestDb;
let e: Escenario;
const DANE = '05266';

async function construirArchivo(opciones: {
  tipoMedicion: 'Por factura' | 'Por periodo';
  periodoMeses?: number;
  filas: Array<[string, string, string]>; // [codigo, tarifaPorMil, gravada]
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Hoja1');
  h.getCell('C5').value = 'Municipio';
  h.getCell('D5').value = DANE;
  h.getCell('G5').value = 'Base mínima UVT compra';
  h.getCell('H5').value = 10;
  h.getCell('G6').value = 'Base mínima UVT servicio';
  h.getCell('H6').value = 2;
  h.getCell('J5').value = 'Tipo de medición base mínima';
  h.getCell('K5').value = opciones.tipoMedicion;
  if (opciones.periodoMeses != null) {
    h.getCell('J6').value = 'Periodo en meses';
    h.getCell('K6').value = opciones.periodoMeses;
  }
  h.getCell('C8').value = 'Código';
  h.getCell('D8').value = 'Descripción';
  h.getCell('I8').value = 'Tarifa por mil';
  h.getCell('J8').value = 'Gravada';
  opciones.filas.forEach(([codigo, tarifa, gravada], i) => {
    const r = 9 + i;
    h.getCell(`C${r}`).value = codigo;
    h.getCell(`D${r}`).value = `Actividad ${codigo}`;
    if (tarifa !== '') h.getCell(`I${r}`).value = Number(tarifa);
    h.getCell(`J${r}`).value = gravada;
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO municipality (id, tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1, NULL, $2, 'Municipio D-088', 'Antioquia', '05')`,
      [uuid(), DANE],
    );
    for (const codigo of ['0161', '9900', '4711']) {
      await tx.query(
        `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
         VALUES ($1, NULL, $2, $3) ON CONFLICT DO NOTHING`,
        [uuid(), codigo, `CIIU ${codigo}`],
      );
    }
    await tx.query(
      `INSERT INTO tax_concept (id, tenant_id, company_id, tipo, codigo, nombre)
       VALUES ($1, NULL, NULL, 'reteica', 'reteica_tarifa_general_municipio', 'ReteICA municipio')
       ON CONFLICT DO NOTHING`,
      [uuid()],
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('carga masiva ICA por municipio', () => {
  it('carga las actividades buenas, informa las de 5 dígitos y aplica el guard gravada/tarifa', async () => {
    const buffer = await construirArchivo({
      tipoMedicion: 'Por factura',
      filas: [
        ['161', '9.66', 'S'], // 0161 tras zero-pad, gravada
        ['9900', '', 'N'], // no gravada: tarifa vacía → 0
        ['85232', '5', 'S'], // subclase de 5 dígitos → error, no se inserta
        ['74901', '3', 'S'], // otra de 5 dígitos → error
      ],
    });

    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        importarIcaMunicipio(tx, 'municipio.xlsx', buffer, {
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'Acuerdo Municipal 001 de 2026',
          periodicidad: 'mensual',
          alcance: 'empresa',
        }),
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );

    expect(r.aplicado).toBe(true);
    expect(r.filasInsertadas).toBe(2);
    expect(r.filasConError).toBe(2);
    expect(r.errores.map((x) => x.numeroFila).sort()).toEqual([11, 12]);

    const filas = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ codigo: string; tarifa: string; gravada: boolean | null }>(
          `SELECT ci.codigo, tr.tarifa::text AS tarifa, tr.gravada
             FROM tax_rule tr
             JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
             JOIN municipality m ON m.id = tr.municipality_id
            WHERE tr.tipo = 'reteica' AND m.codigo_dane = $1
            ORDER BY ci.codigo`,
          [DANE],
        );
        return rows;
      },
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );
    expect(filas).toEqual([
      { codigo: '0161', tarifa: '0.009660', gravada: true },
      { codigo: '9900', tarifa: '0.000000', gravada: false },
    ]);

    const regla = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{
          tipo_medicion_base_minima: string;
          periodo_meses: number | null;
          base_minima_compras_uvt: string | null;
        }>(
          `SELECT r.tipo_medicion_base_minima, r.periodo_meses, r.base_minima_compras_uvt::text
             FROM municipality_ica_rule r JOIN municipality m ON m.id = r.municipality_id
            WHERE m.codigo_dane = $1 AND r.vigente_hasta IS NULL`,
          [DANE],
        );
        return rows[0];
      },
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );
    expect(regla?.tipo_medicion_base_minima).toBe('por_factura');
    expect(regla?.periodo_meses).toBeNull();
    expect(Number(regla?.base_minima_compras_uvt)).toBe(10);
  });

  it('«Por periodo» exige y guarda la ventana en meses', async () => {
    const buffer = await construirArchivo({
      tipoMedicion: 'Por periodo',
      periodoMeses: 2,
      filas: [['4711', '7', 'S']],
    });
    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        importarIcaMunicipio(tx, 'municipio2.xlsx', buffer, {
          vigenteDesde: '2026-02-01',
          normaRespaldo: 'Acuerdo Municipal 002 de 2026',
          periodicidad: 'bimestral',
          alcance: 'empresa',
        }),
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );
    expect(r.aplicado).toBe(true);

    const regla = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ tipo_medicion_base_minima: string; periodo_meses: number | null }>(
          `SELECT r.tipo_medicion_base_minima, r.periodo_meses
             FROM municipality_ica_rule r JOIN municipality m ON m.id = r.municipality_id
            WHERE m.codigo_dane = $1 AND r.vigente_hasta IS NULL`,
          [DANE],
        );
        return rows[0];
      },
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );
    expect(regla).toEqual({ tipo_medicion_base_minima: 'por_periodo', periodo_meses: 2 });
  });
});

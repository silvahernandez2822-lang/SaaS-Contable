/**
 * D-088 — guard de consistencia gravada / tarifa en la capa de servicio.
 *
 * El CHECK `tax_rule_gravada_ck` (migración 177) es la garantía real; la capa
 * de servicio la adelanta con un mensaje accionable para no gastar un viaje a
 * la base. Se comprueban las dos: el servicio rechaza antes, y una escritura
 * directa que se saltara el servicio sigue muriendo en la base.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { isPostgresError, SQLSTATE } from '../../src/db/types';
import { crearOReemplazarTaxRule } from '../../src/services/catalogos';
import { editarTarifaTaxRule, VigenciaInvalidaError } from '../../src/services/parametrizacion';

let db: TestDb;
let e: Escenario;
const DANE = '05267';

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO municipality (id, tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1, NULL, $2, 'Municipio guard D-088', 'Antioquia', '05')`,
      [uuid(), DANE],
    );
    await tx.query(
      `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre) VALUES ($1, NULL, '0161', 'CIIU 0161')
       ON CONFLICT DO NOTHING`,
      [uuid()],
    );
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

describe('guard gravada / tarifa', () => {
  it('crearOReemplazarTaxRule rechaza gravada=false con tarifa distinta de cero', async () => {
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          crearOReemplazarTaxRule(tx, {
            tipo: 'reteica',
            conceptoCodigo: 'reteica_tarifa_general_municipio',
            tarifa: '0.005000',
            gravada: false,
            municipioDane: DANE,
            ciiuCodigo: '0161',
            vigenteDesde: '2026-01-01',
            normaRespaldo: 'Acuerdo 1',
            alcance: 'empresa',
          }),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);
  });

  it('gravada=false con tarifa 0 entra, y luego editar a gravada=true con tarifa positiva abre vigencia nueva', async () => {
    const reglaId = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const r = await crearOReemplazarTaxRule(tx, {
          tipo: 'reteica',
          conceptoCodigo: 'reteica_tarifa_general_municipio',
          tarifa: '0',
          gravada: false,
          municipioDane: DANE,
          ciiuCodigo: '0161',
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'Acuerdo 1',
          alcance: 'empresa',
        });
        return r.reglaNuevaId;
      },
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );

    const nueva = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: reglaId,
          tarifa: '0.008000',
          gravada: true,
          vigenteDesde: '2026-06-01',
          normaRespaldo: 'Acuerdo 2',
          alcanceNuevo: 'empresa',
        }),
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );
    expect(nueva.reglaAnteriorCerrada).toBe(true);

    const filas = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ tarifa: string; gravada: boolean | null; vigente_hasta: string | null }>(
          `SELECT tarifa::text AS tarifa, gravada, vigente_hasta::text
             FROM tax_rule tr JOIN municipality m ON m.id = tr.municipality_id
            WHERE m.codigo_dane = $1 AND tr.tipo = 'reteica'
            ORDER BY vigente_desde`,
          [DANE],
        );
        return rows;
      },
      { rolCodigo: 'admin_tributario', sesionNueva: true },
    );
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ gravada: false, vigente_hasta: '2026-05-31' });
    expect(filas[1]).toMatchObject({ gravada: true, vigente_hasta: null });
  });

  it('el CHECK de la base mata la escritura directa que se salte el servicio (23514)', async () => {
    let codigo = 'sin-error';
    try {
      await db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(
            `INSERT INTO tax_rule (id, tenant_id, company_id, tax_concept_id, tipo, tarifa,
                                   aplica_sobre, aplica_a, vigente_desde, norma_respaldo, gravada)
             SELECT $1, $2, $3, tc.id, 'reteica', '0.004000', 'base_gravable', 'ambos',
                    DATE '2027-01-01', 'x', false
               FROM tax_concept tc
              WHERE tc.codigo = 'reteica_tarifa_general_municipio' AND tc.tenant_id IS NULL`,
            [uuid(), e.tenantId, e.companyId],
          ),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      );
    } catch (err) {
      codigo = isPostgresError(err) ? (err.code ?? 'sin-codigo') : `no-motor:${String(err)}`;
    }
    expect(codigo).toBe(SQLSTATE.CHECK_VIOLATION);
  });
});

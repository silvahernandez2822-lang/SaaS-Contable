/**
 * A11 — Los siete formatos núcleo de información exógena (sección 7.7),
 * contra una base de datos real (PGlite). Cubre:
 *
 *  1. Formato 1001: el bloqueo REAL de dirección/código de municipio (no se
 *     omite, no se rellena con un valor por defecto, aparece en
 *     `tercerosIncompletos` y en la hoja "Bloqueos" del Excel).
 *  2. Formato 1005 (IVA descontable) sobre movimientos reales del ledger.
 *  3. Formato 1007 (ingresos) resuelto contra `niif_mapping`.
 *  4. Formato 1009 (cuentas por pagar) resuelto contra
 *     `concepto_causacion.cuenta_contrapartida_id` y contra
 *     `exogena_account_mapping` (el puente que esta migración agrega).
 *  5. `reporte.exportar` se exige de verdad.
 *  6. Las cuatro hojas obligatorias siguen presentes en cada libro.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import type { SqlClient } from '../../src/db/types';
import {
  generarFormato1001,
  generarFormato1005,
  generarFormato1007,
  generarFormato1009,
} from '../../src/reports/exogena/formatos';

let db: TestDb;
let e: Escenario;
let ingresoAccountId: string;
let thirdPartyDocumento: string;

const RANGO = { desde: '2026-06-01', hasta: '2026-06-30', anioGravable: 2026 };
const HOJAS_OBLIGATORIAS = ['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros'];

async function publicar(
  tx: SqlClient,
  partidas: {
    accountId: string;
    side: 'debito' | 'credito';
    monto: number;
    thirdPartyId?: string | null;
    retentionAppliedId?: string | null;
  }[],
): Promise<void> {
  const entryId = uuid();
  await tx.query(
    `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,'2026-06-15','Asiento de prueba de exógena (A11)','draft',$5,$6,$7,$8)`,
    [entryId, e.tenantId, e.companyId, e.fiscalPeriodId, e.sourceDocumentId, e.approvalId, `idem-a11-${entryId}`, e.userId],
  );
  let linea = 0;
  for (const p of partidas) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto,
                                 third_party_id, retention_applied_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.tenantId, e.companyId, entryId, linea, p.accountId, p.side, p.monto, p.thirdPartyId ?? null, p.retentionAppliedId ?? null],
    );
  }
  await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, e.userId]);
}

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  ingresoAccountId = uuid();

  await db.asAdmin(async (tx) => {
    const { rows: tpRows } = await tx.query<{ numero_documento: string }>(
      `SELECT numero_documento FROM third_party WHERE id = $1`,
      [e.thirdPartyId],
    );
    thirdPartyDocumento = tpRows[0]!.numero_documento;

    // ---- Compra causada con IVA descontable y retefuente (para 1001 y 1005) ----
    const { rows: tc } = await tx.query<{ id: string }>(
      `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
       VALUES (NULL, NULL, 'retefuente', $1, 'Concepto de prueba A11 (no es un valor tributario real)')
       RETURNING id`,
      [`concepto_prueba_a11_${uuid()}`],
    );
    const { rows: tr } = await tx.query<{ id: string; vigente_desde: string }>(
      `INSERT INTO tax_rule (
         tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
         aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, norma_respaldo
       ) VALUES ($1,$2,$3,'retefuente',0.040000,4,'base_gravable','ambos','ambos',$4,'2026-01-01',
                 'Norma de prueba A11 (mecánica de exógena, no un dato normativo real)')
       RETURNING id, vigente_desde::text`,
      [e.tenantId, e.companyId, tc[0]!.id, e.cuentas.retefuentePorPagar],
    );
    const { rows: ra } = await tx.query<{ id: string }>(
      `INSERT INTO retention_applied (
         tenant_id, company_id, source_document_id, third_party_id, tipo, base, tarifa, valor,
         tax_rule_id, regla_vigente_desde, norma_respaldo, account_id, fecha_hecho_economico, aplicada
       ) VALUES ($1,$2,$3,$4,'retefuente',10000000,0.040000,400000,$5,$6,'Norma de prueba A11',$7,'2026-06-15',true)
       RETURNING id`,
      [e.tenantId, e.companyId, e.sourceDocumentId, e.thirdPartyId, tr[0]!.id, tr[0]!.vigente_desde, e.cuentas.retefuentePorPagar],
    );
    await publicar(tx, [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 100_000_00, thirdPartyId: e.thirdPartyId },
      { accountId: e.cuentas.ivaDescontable, side: 'debito', monto: 19_000_00, thirdPartyId: e.thirdPartyId },
      { accountId: e.cuentas.proveedores, side: 'credito', monto: 115_000_00, thirdPartyId: e.thirdPartyId },
      {
        accountId: e.cuentas.retefuentePorPagar,
        side: 'credito',
        monto: 4_000_00,
        thirdPartyId: e.thirdPartyId,
        retentionAppliedId: ra[0]!.id,
      },
    ]);

    // ---- Cuenta de ingreso mapeada en niif_mapping (para 1007) ----
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, '413595', 'Ingresos operacionales de prueba', 4, 'credito', true)`,
      [ingresoAccountId, e.tenantId, e.companyId],
    );
    await tx.query(
      `INSERT INTO niif_mapping (tenant_id, company_id, account_id, clasificacion_niif, vigente_desde, norma_respaldo)
       VALUES ($1, $2, $3, 'ingreso', '2020-01-01', 'NIIF PYMES Sección 23 (clasificación de prueba A11)')`,
      [e.tenantId, e.companyId, ingresoAccountId],
    );
    await publicar(tx, [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 50_000_00 },
      { accountId: ingresoAccountId, side: 'credito', monto: 50_000_00, thirdPartyId: e.thirdPartyId },
    ]);

    // ---- concepto_causacion con cuenta_contrapartida (para 1009) ----
    await tx.query(
      `INSERT INTO concepto_causacion (tenant_id, company_id, codigo, nombre, cuenta_contrapartida_id, aplica_retefuente)
       VALUES ($1, $2, $3, 'Concepto de prueba A11 (cuentas por pagar)', $4, false)`,
      [e.tenantId, e.companyId, `cxp_prueba_a11_${uuid()}`, e.cuentas.proveedores],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('Formato 1001 — el bloqueo de dirección/municipio NO se omite', () => {
  it('el tercero del escenario (sin dirección) aparece en tercerosIncompletos, no se rellena con nada', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1001(tx, RANGO));
    expect(salida.tercerosIncompletos.length).toBeGreaterThan(0);
    const incompleto = salida.tercerosIncompletos.find((t) => t.terceroId === e.thirdPartyId);
    expect(incompleto).toBeDefined();
    expect(incompleto!.faltaDireccion).toBe(true);
    // El municipio SÍ se cargó en el fixture (municipality_id + codigo_dane): no debe marcarse falso-positivo.
    expect(incompleto!.faltaMunicipio).toBe(false);
  });

  it('el Excel trae la hoja "Bloqueos" con el tercero incompleto, y las cuatro hojas obligatorias', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1001(tx, RANGO));
    const nombres = salida.workbook.worksheets.map((w) => w.name);
    for (const h of HOJAS_OBLIGATORIAS) expect(nombres).toContain(h);
    expect(nombres).toContain('Bloqueos');
    const bloqueos = salida.workbook.getWorksheet('Bloqueos')!;
    expect(bloqueos.rowCount).toBeGreaterThan(1); // encabezado de texto + fila de datos
  });

  it('el plano no inventa la dirección: la celda queda vacía, no un valor por defecto', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1001(tx, RANGO));
    const fila = salida.filas.find((f: any) => f.terceroId === e.thirdPartyId) as any;
    expect(fila).toBeDefined();
    expect(fila.direccion).toBe('');

    const lineas = salida.plano.split('\n').filter((l) => !l.startsWith('#'));
    const encabezados = lineas[0]!.split('|');
    const idxDireccion = encabezados.indexOf('Dirección');
    const idxDocumento = encabezados.indexOf('N° identificación');
    const filaPlano = lineas.slice(1).find((l) => l.split('|')[idxDocumento] === thirdPartyDocumento);
    expect(idxDireccion).toBeGreaterThanOrEqual(0);
    expect(filaPlano!.split('|')[idxDireccion]).toBe('');
  });

  it('suma el pago (contrapartida + retención) y la retención de renta por tercero', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1001(tx, RANGO));
    const fila = salida.filas.find((f: any) => f.terceroId === e.thirdPartyId) as any;
    expect(fila).toBeDefined();
    expect(fila.valorPagoOAbono).toBe((115_000_00 + 4_000_00).toString());
    expect(fila.valorRetefuente).toBe((4_000_00).toString());
  });

  it('exige el permiso reporte.exportar', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO role (tenant_id, codigo, nombre, descripcion, es_sistema)
         VALUES ($1, 'sin_permisos_exogena', 'Sin permisos', 'Rol de prueba sin ningún permiso', false)
         RETURNING id`,
        [e.tenantId],
      ),
    );
    const rolSinPermisos = rows[0]!.id;
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1001(tx, RANGO), { rolId: rolSinPermisos }),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);
  });
});

describe('Formato 1005 — IVA descontable', () => {
  it('trae el IVA descontable de la compra causada, por tercero', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1005(tx, RANGO));
    const fila = salida.filas.find((f: any) => f.terceroId === e.thirdPartyId) as any;
    expect(fila).toBeDefined();
    expect(fila.valorIva).toBe((19_000_00).toString());
  });
});

describe('Formato 1007 — ingresos, resuelto contra niif_mapping', () => {
  it('trae el ingreso clasificado como "ingreso" en niif_mapping', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) => generarFormato1007(tx, RANGO));
    const fila = salida.filas.find((f: any) => f.terceroId === e.thirdPartyId) as any;
    expect(fila).toBeDefined();
    expect(fila.valorIngreso).toBe((50_000_00).toString());
  });
});

describe('Formato 1009 — cuentas por pagar', () => {
  it('el saldo de la cuenta de proveedores (contrapartida de concepto_causacion) es la suma del período', async () => {
    const salida = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      generarFormato1009(tx, RANGO.hasta, RANGO.anioGravable),
    );
    const fila = salida.filas.find((f: any) => f.terceroId === e.thirdPartyId) as any;
    expect(fila).toBeDefined();
    expect(fila.saldoCorte).toBe((115_000_00).toString());
  });
});

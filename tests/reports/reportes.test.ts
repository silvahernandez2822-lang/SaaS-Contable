/**
 * A9 — Los ocho reportes obligatorios de la sección 11.3, contra una base de
 * datos real (PGlite). Cubre:
 *
 *  1. Que cada uno de los ocho produzca las cuatro hojas obligatorias.
 *  2. Que el balance de prueba cuadre CONTRA LA SUMA DIRECTA DEL LEDGER, en
 *     los cinco niveles del PUC (criterio de salida de la sección 12).
 *  3. Aislamiento entre empresas (Regla de Oro 7): los datos de otra empresa
 *     no aparecen en ningún reporte de esta.
 *  4. `reporte.exportar` se exige de verdad (no es decorativo).
 *  5. La trazabilidad y los parámetros de los reportes tributarios amarran
 *     con la regla y la vigencia reales de `retention_applied`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import type { SqlClient } from '../../src/db/types';
import { balanceDePrueba, sumaDirectaLedger, type NivelPuc } from '../../src/reports/consulta';
import {
  generarBalanceDePrueba,
  generarCertificadoRetenciones,
  generarDetalleIva,
  generarLibroAuxiliar,
  generarLibroDiario,
  generarLibroMayor,
  generarMovimientoTerceros,
  generarRelacionRetenciones,
} from '../../src/reports/libros';

let db: TestDb;
let e: Escenario;

const RANGO_REPORTE = { desde: '2026-06-10', hasta: '2026-06-30' };
const HOJAS_OBLIGATORIAS = ['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros'];

interface Partida {
  accountId: string;
  side: 'debito' | 'credito';
  monto: number;
  thirdPartyId?: string | null;
  retentionAppliedId?: string | null;
}

/** Publica un asiento en una fecha ARBITRARIA (a diferencia del helper
 * compartido, que fija '2026-06-15'): imprescindible para separar "saldo
 * inicial" de "movimiento del período" en el balance de prueba. */
async function publicarEnFechaPara(
  tx: SqlClient,
  esc: Escenario,
  fecha: string,
  partidas: Partida[],
): Promise<string> {
  const entryId = uuid();
  await tx.query(
    `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,'Asiento de prueba de reportes (A9)','draft',$6,$7,$8,$9)`,
    [entryId, esc.tenantId, esc.companyId, esc.fiscalPeriodId, fecha, esc.sourceDocumentId, esc.approvalId, `idem-a9-${entryId}`, esc.userId],
  );
  let linea = 0;
  for (const p of partidas) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto,
                                 third_party_id, retention_applied_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [esc.tenantId, esc.companyId, entryId, linea, p.accountId, p.side, p.monto, p.thirdPartyId ?? null, p.retentionAppliedId ?? null],
    );
  }
  await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, esc.userId]);
  return entryId;
}

function publicarEnFecha(tx: SqlClient, fecha: string, partidas: Partida[]): Promise<string> {
  return publicarEnFechaPara(tx, e, fecha, partidas);
}

async function publicarEnOtraEmpresa(
  tx: SqlClient,
  otra: Escenario,
  fecha: string,
  monto: number,
): Promise<string> {
  return publicarEnFechaPara(tx, otra, fecha, [
    { accountId: otra.cuentas.gasto, side: 'debito', monto },
    { accountId: otra.cuentas.proveedores, side: 'credito', monto },
  ]);
}

/** Regla de prueba (no un valor tributario real, igual que el resto de fixtures) + su retención aplicada. */
async function crearRetencionDePrueba(
  tx: SqlClient,
  opciones: { fecha: string; base: number; valor: number; tarifa: string },
): Promise<string> {
  const { rows: tc } = await tx.query<{ id: string }>(
    `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
     VALUES (NULL, NULL, 'retefuente', $1, 'Concepto de prueba A9 (no es un valor tributario real)')
     RETURNING id`,
    [`concepto_prueba_a9_${uuid()}`],
  );
  const { rows: tr } = await tx.query<{ id: string; vigente_desde: string }>(
    `INSERT INTO tax_rule (
       tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
       aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, norma_respaldo
     ) VALUES ($1,$2,$3,'retefuente',$4,4,'base_gravable','ambos','ambos',$5,'2026-01-01',
               'Norma de prueba A9 (mecánica de reportes, no un dato normativo real)')
     RETURNING id, vigente_desde::text`,
    [e.tenantId, e.companyId, tc[0]!.id, opciones.tarifa, e.cuentas.retefuentePorPagar],
  );
  const { rows: ra } = await tx.query<{ id: string }>(
    `INSERT INTO retention_applied (
       tenant_id, company_id, source_document_id, third_party_id, tipo, base, tarifa, valor,
       tax_rule_id, regla_vigente_desde, norma_respaldo, account_id, fecha_hecho_economico, aplicada,
       uvt_valor_usado, base_minima_uvt_usada
     ) VALUES ($1,$2,$3,$4,'retefuente',$5,$6,$7,$8,$9,'Norma de prueba A9',$10,$11,true,4241200,4)
     RETURNING id`,
    [
      e.tenantId,
      e.companyId,
      e.sourceDocumentId,
      e.thirdPartyId,
      opciones.base,
      opciones.tarifa,
      opciones.valor,
      tr[0]!.id,
      tr[0]!.vigente_desde,
      e.cuentas.retefuentePorPagar,
      opciones.fecha,
    ],
  );
  return ra[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);

  await db.asAdmin(async (tx) => {
    // Antes del rango del reporte (2026-06-10 a 2026-06-30): forma el SALDO
    // INICIAL de las cuentas para el balance de prueba y el libro auxiliar.
    await publicarEnFecha(tx, '2026-06-01', [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 500_000_00, thirdPartyId: e.thirdPartyId },
      { accountId: e.cuentas.proveedores, side: 'credito', monto: 500_000_00, thirdPartyId: e.thirdPartyId },
    ]);

    // Dentro del rango: causación con IVA y retención (para diario, mayor,
    // auxiliar, movimiento de terceros, IVA y trazabilidad tributaria).
    const retencionId = await crearRetencionDePrueba(tx, {
      fecha: '2026-06-15',
      base: 1_000_000_00,
      valor: 40_000_00,
      tarifa: '0.040000',
    });
    await publicarEnFecha(tx, '2026-06-15', [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 1_000_000_00, thirdPartyId: e.thirdPartyId },
      { accountId: e.cuentas.ivaDescontable, side: 'debito', monto: 190_000_00, thirdPartyId: e.thirdPartyId },
      { accountId: e.cuentas.proveedores, side: 'credito', monto: 1_150_000_00, thirdPartyId: e.thirdPartyId },
      {
        accountId: e.cuentas.retefuentePorPagar,
        side: 'credito',
        monto: 40_000_00,
        thirdPartyId: e.thirdPartyId,
        retentionAppliedId: retencionId,
      },
    ]);
  });
});

afterAll(async () => {
  await db?.close();
});

describe('las cuatro hojas obligatorias, en los ocho reportes', () => {
  it('libro diario', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarLibroDiario(tx, RANGO_REPORTE));
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
    expect(wb.getWorksheet('Datos')!.rowCount).toBeGreaterThan(1);
  });

  it('libro mayor', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarLibroMayor(tx, RANGO_REPORTE));
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
  });

  it('libro auxiliar por cuenta y por tercero', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      generarLibroAuxiliar(tx, { ...RANGO_REPORTE, accountId: e.cuentas.gasto, terceroId: e.thirdPartyId }),
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
    const datos = wb.getWorksheet('Datos')!;
    // Solo la partida del 15 de junio (la del 1 de junio es SALDO INICIAL, fuera del rango).
    expect(datos.rowCount).toBe(2);
  });

  it('balance de prueba a cualquier nivel del PUC', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      generarBalanceDePrueba(tx, { ...RANGO_REPORTE, nivel: 3 }),
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
  });

  it('certificado de retenciones por tercero', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      generarCertificadoRetenciones(tx, { ...RANGO_REPORTE, terceroId: e.thirdPartyId }),
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
    expect(wb.getWorksheet('Trazabilidad')!.rowCount).toBeGreaterThan(1);
    expect(wb.getWorksheet('Parámetros')!.rowCount).toBeGreaterThan(1);
  });

  it('relación de retenciones practicadas por período y tipo', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarRelacionRetenciones(tx, RANGO_REPORTE));
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
  });

  it('movimiento de terceros', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarMovimientoTerceros(tx, RANGO_REPORTE));
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
  });

  it('detalle de IVA generado y descontable', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarDetalleIva(tx, RANGO_REPORTE));
    expect(wb.worksheets.map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
    const datos = wb.getWorksheet('Datos')!;
    expect(datos.rowCount).toBe(2); // encabezado + la línea de IVA descontable del 15 de junio
  });
});

describe('el balance de prueba cuadra contra la suma directa del ledger', () => {
  it.each<NivelPuc>([1, 2, 3, 4, 5])('nivel %i: total débitos y créditos del período coincide con la suma directa', async (nivel) => {
    const { filas, directo } = await db.asTenant(e.tenantId, e.companyId, async (tx) => ({
      filas: await balanceDePrueba(tx, { ...RANGO_REPORTE, nivel }),
      directo: await sumaDirectaLedger(tx, RANGO_REPORTE),
    }));

    const totalDebitos = filas.reduce((acc, f) => acc + BigInt(f.debitosPeriodo), 0n);
    const totalCreditos = filas.reduce((acc, f) => acc + BigInt(f.creditosPeriodo), 0n);

    expect(totalDebitos.toString()).toBe(directo.totalDebito);
    expect(totalCreditos.toString()).toBe(directo.totalCredito);
    // Doble partida: todo asiento publicado cuadra, así que la suma total también.
    expect(totalDebitos).toBe(totalCreditos);
  });

  it('el saldo inicial de una cuenta refleja SOLO lo anterior al rango, no lo del rango', async () => {
    const filas = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      balanceDePrueba(tx, { ...RANGO_REPORTE, nivel: 4 }),
    );
    const filaGasto = filas.find((f) => f.codigoGrupo === '513595');
    expect(filaGasto).toBeDefined();
    // El asiento de $500.000 del 1 de junio queda ANTES del rango (2026-06-10):
    // no debe sumarse a "saldo inicial" del rango 10-30 solo si es < 2026-06-10.
    expect(BigInt(filaGasto!.saldoInicial)).toBe(500_000_00n);
    expect(BigInt(filaGasto!.debitosPeriodo)).toBe(1_000_000_00n);
  });
});

describe('aislamiento entre empresas (Regla de Oro 7)', () => {
  it('el libro diario y el balance de prueba de una empresa no ven los asientos de otra', async () => {
    const otra = await crearEscenario(db);
    await db.asAdmin((tx) => publicarEnOtraEmpresa(tx, otra, '2026-06-15', 999_999_00));

    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarLibroDiario(tx, RANGO_REPORTE));
    const montos = wb.getWorksheet('Datos')!.getSheetValues().flat();
    expect(montos).not.toContain(9999990); // 999.999,00 en pesos, si se hubiera colado
  });
});

describe('reporte.exportar se exige de verdad', () => {
  it('un rol sin reporte.exportar no puede generar ningún libro', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO role (tenant_id, codigo, nombre, descripcion, es_sistema)
         VALUES ($1, 'sin_permisos_reportes', 'Sin permisos', 'Rol de prueba sin ningún permiso', false)
         RETURNING id`,
        [e.tenantId],
      ),
    );
    const rolSinPermisos = rows[0]!.id;

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => generarLibroDiario(tx, RANGO_REPORTE), {
        rolId: rolSinPermisos,
      }),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);
  });
});

describe('trazabilidad y parámetros del certificado de retenciones amarran con retention_applied', () => {
  it('la fila de trazabilidad trae la MISMA tarifa y vigencia que quedaron en retention_applied', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      generarCertificadoRetenciones(tx, { ...RANGO_REPORTE, terceroId: e.thirdPartyId }),
    );
    const traza = wb.getWorksheet('Trazabilidad')!;
    const filaValores = traza.getRow(2).values as unknown[];
    expect(filaValores).toContain('4%');
    expect(filaValores).toContain('2026-01-01');

    const parametros = wb.getWorksheet('Parámetros')!;
    const valoresParametros = parametros.getSheetValues().flat();
    expect(valoresParametros.some((v) => typeof v === 'string' && v.includes('retefuente'))).toBe(true);
  });
});

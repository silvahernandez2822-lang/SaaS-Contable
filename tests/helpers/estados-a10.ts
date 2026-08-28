/**
 * A10 — Fixture compartido por las pruebas de estados financieros y de cierre.
 *
 * No vive en `fixtures.ts` (de A2) porque es específico de A10: monta el PUC
 * jerárquico y su mapeo NIIF, que el escenario base no necesita. El mapeo se
 * declara SOLO sobre las cuentas de nivel 2 (los grupos), nunca sobre las
 * subcuentas donde se imputa: así las pruebas ejercitan la herencia por
 * prefijo del código, que es la situación real (A1 cargó el catálogo operativo
 * hasta el nivel de cuenta y cada empresa crea sus propias subcuentas).
 */
import { uuid } from './db';
import type { Escenario } from './fixtures';
import type { SqlClient } from '../../src/db/types';

export const UN_MILLON = 1_000_000_00;
export const MEDIO_MILLON = 500_000_00;
export const TRESCIENTOS_MIL = 300_000_00;
export const CIEN_MIL = 100_000_00;

export interface CuentasEstados {
  caja: string;
  ingreso: string;
  resultadoDelEjercicio: string;
  sinClasificar: string;
}

export async function montarPucYMapeo(
  tx: SqlClient,
  esc: Escenario,
  opciones: { marcarEfectivo: boolean },
): Promise<CuentasEstados> {
  const propias: CuentasEstados = {
    caja: uuid(),
    ingreso: uuid(),
    resultadoDelEjercicio: uuid(),
    sinClasificar: uuid(),
  };

  const clases: [string, string][] = [
    ['1', 'Activo'],
    ['2', 'Pasivo'],
    ['3', 'Patrimonio'],
    ['4', 'Ingresos'],
  ];
  for (const [codigo, nombre] of clases) {
    await tx.query(
      `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, $4, 1, $5, false)`,
      [esc.tenantId, esc.companyId, codigo, nombre, codigo === '1' ? 'debito' : 'credito'],
    );
  }

  const grupos: [string, string, 'debito' | 'credito'][] = [
    ['11', 'Disponible', 'debito'],
    ['22', 'Proveedores', 'credito'],
    ['23', 'Cuentas por pagar', 'credito'],
    ['24', 'Impuestos, gravámenes y tasas', 'credito'],
    ['36', 'Resultados del ejercicio', 'credito'],
    ['41', 'Operacionales', 'credito'],
    ['51', 'Operacionales de administración', 'debito'],
  ];
  for (const [codigo, nombre, naturaleza] of grupos) {
    await tx.query(
      `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, $4, 2, $5, false)`,
      [esc.tenantId, esc.companyId, codigo, nombre, naturaleza],
    );
  }

  // La cuenta de nivel 3 que rotula el desglose POR NATURALEZA.
  await tx.query(
    `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
     VALUES ($1, $2, '5135', 'Servicios', 3, 'debito', false)`,
    [esc.tenantId, esc.companyId],
  );

  const imputables: [string, string, string, 'debito' | 'credito'][] = [
    [propias.caja, '110505', 'Caja general', 'debito'],
    [propias.ingreso, '413595', 'Otros ingresos operacionales', 'credito'],
    [propias.resultadoDelEjercicio, '360505', 'Utilidad o pérdida del ejercicio', 'credito'],
    // Sin ancestro mapeado a propósito: es la cuenta huérfana de las pruebas.
    [propias.sinClasificar, '199905', 'Cuenta que nadie ha clasificado', 'debito'],
  ];
  for (const [id, codigo, nombre, naturaleza] of imputables) {
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, $4, $5, 4, $6, true)`,
      [id, esc.tenantId, esc.companyId, codigo, nombre, naturaleza],
    );
  }

  const mapeos: [string, string, string | null][] = [
    ['11', 'activo_corriente', opciones.marcarEfectivo ? 'efectivo_y_equivalentes' : null],
    ['22', 'pasivo_corriente', null],
    ['23', 'pasivo_corriente', null],
    ['24', 'pasivo_corriente', null],
    ['36', 'patrimonio', null],
    ['41', 'ingreso', null],
    ['51', 'gasto', null],
  ];
  for (const [codigo, clasificacion, rubroEfe] of mapeos) {
    await tx.query(
      `INSERT INTO niif_mapping (tenant_id, company_id, account_id, clasificacion_niif,
                                 seccion_niif, rubro_efe, vigente_desde, norma_respaldo)
       SELECT $1, $2, a.id, $4, $5, $6, '2020-01-01',
              'Mapeo de prueba A10 (mecánica de estados financieros, no un dato normativo real)'
         FROM account a
        WHERE a.company_id = $2 AND a.codigo = $3`,
      [
        esc.tenantId,
        esc.companyId,
        codigo,
        clasificacion,
        `Sección de prueba — ${clasificacion}`,
        rubroEfe,
      ],
    );
  }

  return propias;
}

export interface PartidaA10 {
  accountId: string;
  side: 'debito' | 'credito';
  monto: number;
}

/** Publica un asiento en una fecha arbitraria, pasando por `draft` (D-009). */
export async function publicarEnFecha(
  tx: SqlClient,
  esc: Escenario,
  fecha: string,
  partidas: PartidaA10[],
): Promise<string> {
  const entryId = uuid();
  await tx.query(
    `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,'Asiento de prueba de estados financieros (A10)','draft',$6,$7,$8,$9)`,
    [
      entryId,
      esc.tenantId,
      esc.companyId,
      esc.fiscalPeriodId,
      fecha,
      esc.sourceDocumentId,
      esc.approvalId,
      `idem-a10-${entryId}`,
      esc.userId,
    ],
  );
  let linea = 0;
  for (const p of partidas) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [esc.tenantId, esc.companyId, entryId, linea, p.accountId, p.side, p.monto],
    );
  }
  await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, esc.userId]);
  return entryId;
}

/** El mismo juego de movimientos en cualquier empresa, para poder compararlas. */
export async function montarMovimientos(
  tx: SqlClient,
  esc: Escenario,
  c: CuentasEstados,
): Promise<void> {
  await publicarEnFecha(tx, esc, '2026-06-10', [
    { accountId: esc.cuentas.gasto, side: 'debito', monto: UN_MILLON },
    { accountId: esc.cuentas.proveedores, side: 'credito', monto: UN_MILLON },
  ]);
  await publicarEnFecha(tx, esc, '2026-06-15', [
    { accountId: c.caja, side: 'debito', monto: MEDIO_MILLON },
    { accountId: c.ingreso, side: 'credito', monto: MEDIO_MILLON },
  ]);
  await publicarEnFecha(tx, esc, '2026-06-20', [
    { accountId: esc.cuentas.proveedores, side: 'debito', monto: TRESCIENTOS_MIL },
    { accountId: c.caja, side: 'credito', monto: TRESCIENTOS_MIL },
  ]);
  await publicarEnFecha(tx, esc, '2026-06-25', [
    { accountId: c.sinClasificar, side: 'debito', monto: CIEN_MIL },
    { accountId: c.caja, side: 'credito', monto: CIEN_MIL },
  ]);
}

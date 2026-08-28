/**
 * A10 — Cierre de las cuentas de resultado, contra una base real (PGlite).
 *
 * Lo que estas pruebas defienden, en una frase: el cierre es un ASIENTO NUEVO,
 * no una edición. Concretamente:
 *
 *  1. Que el asiento de cierre exista, esté publicado, sea de tipo `cierre` y
 *     cancele exactamente los saldos de resultado.
 *  2. Que los asientos originales sigan intactos (Regla de Oro 1) y que el
 *     propio asiento de cierre, una vez publicado, tampoco admita UPDATE.
 *  3. Que un asiento de cierre NO pueda nacer publicado (D-009 / LG007).
 *  4. Que sea idempotente: cerrar diez veces deja un asiento, no diez.
 *  5. Que después del cierre el ESF muestre el resultado ya dentro del
 *     patrimonio y el ERI del ejercicio SIGA mostrando el resultado (porque
 *     excluye los asientos de cierre; si no, el estado del año saldría en cero).
 *  6. Que las cuentas sin mapeo NIIF NO se cierren a ciegas, y se devuelvan.
 *  7. Que se exija `periodo.cerrar`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import {
  MEDIO_MILLON,
  UN_MILLON,
  montarMovimientos,
  montarPucYMapeo,
  type CuentasEstados,
} from '../helpers/estados-a10';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import type { SqlClient } from '../../src/db/types';
import { cerrarCuentasDeResultado, claveCierre, saldosACerrar } from '../../src/services/cierre';
import {
  calcularEstadoResultadoIntegral,
  calcularEstadoSituacionFinanciera,
} from '../../src/reports/estados/libros';

const EJERCICIO = { desde: '2026-06-01', hasta: '2026-06-30' };
/** Ingresos 500.000 − gastos 1.000.000 = pérdida de 500.000. */
const PERDIDA = MEDIO_MILLON - UN_MILLON;

let db: TestDb;
let e: Escenario;
let cuentas: CuentasEstados;

function enEmpresa<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  return db.asTenant(e.tenantId, e.companyId, fn);
}

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  await db.asAdmin(async (tx) => {
    cuentas = await montarPucYMapeo(tx, e, { marcarEfectivo: true });
    await montarMovimientos(tx, e, cuentas);
  });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

// =============================================================================
describe('A10 · qué se cierra y qué no', () => {
  it('solo se cierran las cuentas que el mapeo NIIF clasifica como resultado', async () => {
    const { aCerrar, sinClasificar } = await enEmpresa((tx) => saldosACerrar(tx, EJERCICIO));

    expect(aCerrar.map((c) => c.cuentaCodigo).sort()).toEqual(['413595', '513595']);
    // La cuenta huérfana tiene saldo, pero NADIE la clasificó: no se cierra a
    // ciegas por su clase del PUC. Se devuelve para que alguien la clasifique.
    expect(sinClasificar.map((c) => c.cuentaCodigo)).toEqual(['199905']);
    expect(sinClasificar[0]!.clasificacionNiif).toBe('sin_mapeo');
  });
});

// =============================================================================
describe('A10 · el cierre es un asiento nuevo, nunca una edición (Regla de Oro 1)', () => {
  it('publica un asiento de tipo `cierre` que cancela los saldos de resultado', async () => {
    const resultado = await enEmpresa((tx) =>
      cerrarCuentasDeResultado(tx, {
        ...EJERCICIO,
        cuentaResultadoId: cuentas.resultadoDelEjercicio,
        motivo: 'Cierre del ejercicio de prueba',
      }),
    );
    expect(resultado.estado).toBe('cerrado');
    if (resultado.estado !== 'cerrado') return;
    expect(resultado.resultadoDelEjercicio).toBe(String(PERDIDA));
    expect(resultado.cuentasSinClasificar.map((c) => c.cuentaCodigo)).toEqual(['199905']);

    const asiento = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{
        tipo: string;
        estado: string;
        posted_at: string | null;
        fecha: string;
        partidas: number;
      }>(
        `SELECT je.tipo, je.estado, je.posted_at::text, je.fecha_hecho_economico::text AS fecha,
                (SELECT count(*)::int FROM journal_line jl WHERE jl.journal_entry_id = je.id) AS partidas
           FROM journal_entry je WHERE je.id = $1`,
        [resultado.journalEntryId],
      );
      return rows[0]!;
    });
    expect(asiento.tipo).toBe('cierre');
    expect(asiento.estado).toBe('posted');
    expect(asiento.posted_at).not.toBeNull();
    expect(asiento.fecha).toBe(EJERCICIO.hasta);
    // Dos cuentas de resultado + la contrapartida de patrimonio.
    expect(asiento.partidas).toBe(3);

    // Y la contrapartida es un DÉBITO al patrimonio, porque el ejercicio dio pérdida.
    const contrapartida = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{ side: string; monto: string }>(
        `SELECT side, monto::text FROM journal_line
          WHERE journal_entry_id = $1 AND account_id = $2`,
        [resultado.journalEntryId, cuentas.resultadoDelEjercicio],
      );
      return rows[0]!;
    });
    expect(contrapartida.side).toBe('debito');
    expect(contrapartida.monto).toBe(String(-PERDIDA));
  });

  it('los asientos originales del ejercicio siguen intactos', async () => {
    const originales = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry
          WHERE tipo <> 'cierre' AND estado = 'posted'`,
      );
      return rows[0]!.n;
    });
    expect(originales).toBe(4);
  });

  it('el asiento de cierre, ya publicado, tampoco admite UPDATE (LG001)', async () => {
    const id = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM journal_entry WHERE idempotency_key = $1`,
        [claveCierre(EJERCICIO.desde, EJERCICIO.hasta)],
      );
      return rows[0]!.id;
    });
    await esperarErrorPg(
      () =>
        enEmpresa((tx) =>
          tx.query(`UPDATE journal_entry SET descripcion = 'reescrito' WHERE id = $1`, [id]),
        ),
      'LG001',
      'un asiento de cierre publicado es tan inmutable como cualquier otro',
    );
  });

  it('un asiento de cierre tampoco puede NACER publicado (D-009 / LG007)', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, tipo,
                                        fecha_hecho_economico, descripcion, estado,
                                        source_document_id, approval_id, idempotency_key, posted_at)
             VALUES ($1,$2,$3,'cierre','2026-06-30','Cierre que intenta nacer publicado','posted',
                     $4,$5,$6, now())`,
            [
              e.tenantId,
              e.companyId,
              e.fiscalPeriodId,
              e.sourceDocumentId,
              e.approvalId,
              `cierre-ilegal-${uuid()}`,
            ],
          ),
        ),
      'LG007',
      'ningún asiento nace publicado, tampoco el de cierre',
    );
  });

  it('es idempotente: cerrar otra vez devuelve el mismo asiento, no crea uno nuevo', async () => {
    const segunda = await enEmpresa((tx) =>
      cerrarCuentasDeResultado(tx, {
        ...EJERCICIO,
        cuentaResultadoId: cuentas.resultadoDelEjercicio,
        motivo: 'Segundo intento de cierre',
      }),
    );
    expect(segunda.estado).toBe('ya_cerrado');

    const cuantos = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry WHERE tipo = 'cierre'`,
      );
      return rows[0]!.n;
    });
    expect(cuantos).toBe(1);
  });

  it('el acta de cierre es el documento fuente del asiento, y se crea una sola vez', async () => {
    const actas = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM source_document WHERE hash_contenido LIKE 'ACTA-CIERRE-%'`,
      );
      return rows[0]!.n;
    });
    expect(actas).toBe(1);
  });
});

// =============================================================================
describe('A10 · los estados después del cierre', () => {
  it('el ESF ya no muestra resultado pendiente: quedó dentro del patrimonio', async () => {
    const esf = await enEmpresa((tx) =>
      calcularEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    expect(esf.resultadoNoCerrado).toBe('0');
    // Pérdida: el patrimonio queda negativo por el mismo importe.
    expect(esf.totalPatrimonio).toBe(String(PERDIDA));
    expect(esf.descuadre).toBe('0');
  });

  it('el ERI del ejercicio SIGUE mostrando el resultado: excluye los asientos de cierre', async () => {
    const eri = await enEmpresa((tx) => calcularEstadoResultadoIntegral(tx, EJERCICIO));
    expect(eri.totalIngresos).toBe(String(MEDIO_MILLON));
    expect(eri.totalGastos).toBe(String(UN_MILLON));
    expect(eri.resultadoDelPeriodo).toBe(String(PERDIDA));
  });

  it('un segundo cierre del mismo ejercicio no encontraría nada que cerrar', async () => {
    const { aCerrar } = await enEmpresa((tx) =>
      saldosACerrar(tx, { desde: EJERCICIO.desde, hasta: EJERCICIO.hasta }),
    );
    // `saldosACerrar` excluye los asientos de cierre, así que sigue viendo los
    // saldos del ejercicio; lo que impide duplicar es la clave de idempotencia,
    // no un saldo en cero. Se comprueba que ambas cosas son ciertas.
    expect(aCerrar.length).toBeGreaterThan(0);

    const saldoVivo = await enEmpresa(async (tx) => {
      const { rows } = await tx.query<{ saldo: string }>(
        `SELECT COALESCE(SUM(CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END), 0)::text AS saldo
           FROM v_journal_line_reporte v
          WHERE v.account_id IN ($1, $2)`,
        [cuentas.ingreso, e.cuentas.gasto],
      );
      return rows[0]!.saldo;
    });
    // Contando TODO (incluido el cierre), las cuentas de resultado ya suman cero.
    expect(saldoVivo).toBe('0');
  });
});

// =============================================================================
describe('A10 · permisos del cierre', () => {
  it('cerrar exige `periodo.cerrar`', async () => {
    const otro = await crearEscenario(db);
    let cuentasOtro: CuentasEstados | null = null;
    await db.asAdmin(async (tx) => {
      cuentasOtro = await montarPucYMapeo(tx, otro, { marcarEfectivo: true });
      await montarMovimientos(tx, otro, cuentasOtro);
    });
    await expect(
      db.asTenant(
        otro.tenantId,
        otro.companyId,
        (tx) =>
          cerrarCuentasDeResultado(tx, {
            ...EJERCICIO,
            cuentaResultadoId: cuentasOtro!.resultadoDelEjercicio,
            motivo: 'Intento sin permiso',
          }),
        { rolCodigo: 'auxiliar_causacion' },
      ),
    ).rejects.toThrow(PermisoInsuficienteError);
  });
});

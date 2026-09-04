/**
 * D-089 — Módulo PUC, capa de modelo de datos (A2, migración 179).
 *
 * Lo que estas pruebas demuestran, y lo demuestran POR SQLSTATE (un throw de
 * TypeScript no probaría nada, D-003):
 *
 *   1. Una partida contra una cuenta agrupadora muere en el INSERT del
 *      BORRADOR, no al publicar. Es la diferencia entre que el contador vea el
 *      error antes de aprobar o después.
 *   2. Una partida contra una cuenta inactiva muere igual, con código propio.
 *   3. La reversa SÍ puede reproducir una cuenta que se retiró después: un
 *      error del pasado no puede quedar incorregible (Regla de Oro 1).
 *   4. Una cuenta con movimientos no cambia de naturaleza, no se vuelve
 *      agrupadora, no se renumera y no se borra.
 *   5. Inactivarla sí se permite: es el camino previsto para retirarla.
 *   6. Una cuenta a la que apunta un concepto de causación activo no se retira
 *      ni se desimputa sin reasignar el concepto primero.
 *   7. Reguardar una cuenta con los mismos valores no dispara ningún guardia.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db';
import type { TestDb } from '../helpers/db';
import {
  crearAsientoBorrador,
  crearEscenario,
  partidasEquilibradas,
  publicarAsiento,
} from '../helpers/fixtures';
import type { Escenario } from '../helpers/fixtures';
import { SQLSTATE } from '../../src/db/types';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

let secuenciaCuenta = 0;

/** Cuenta imputable recién creada, sin uso, para poder destrozarla sin tocar
 *  el resto del escenario. */
async function cuentaNueva(
  campos: Partial<{
    codigo: string;
    naturaleza: 'debito' | 'credito';
    permiteMovimiento: boolean;
    activo: boolean;
  }> = {},
): Promise<{ id: string; codigo: string }> {
  const id = uuid();
  // A14 (compuerta de D-089): el código NO se sortea. Con `Math.random()` sobre
  // un espacio de 90 valores y la quincena de cuentas que crea este archivo, la
  // colisión contra `account_codigo_uq` es probable, no excepcional. Una prueba
  // de integridad intermitente se acaba silenciando.
  secuenciaCuenta += 1;
  const codigo = campos.codigo ?? `5195${String(secuenciaCuenta + 10).padStart(2, '0')}`;
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza,
                            permite_movimiento, activo)
       VALUES ($1, $2, $3, $4, $5, 4, $6, $7, $8)`,
      [
        id,
        e.tenantId,
        e.companyId,
        codigo,
        `Cuenta de prueba ${codigo}`,
        campos.naturaleza ?? 'debito',
        campos.permiteMovimiento ?? true,
        campos.activo ?? true,
      ],
    ),
  );
  return { id, codigo };
}

// =============================================================================
describe('D-089 · 1 — la cuenta se valida al INSERTAR la partida, no al publicar', () => {
  it('imputar sobre una cuenta agrupadora falla con LG004 EN EL BORRADOR', async () => {
    const err = await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.claseGasto, side: 'debito', monto: 1000_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 1000_00 },
          ]),
        ),
      SQLSTATE.CUENTA_NO_IMPUTABLE,
      'el INSERT de una partida borrador contra la clase 5',
    );
    // No se llegó a publicar: el rechazo es del INSERT.
    expect(err.message).toContain('no permite movimiento');
  });

  it('el asiento borrador rechazado no dejó rastro en la base', async () => {
    const n = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_line WHERE account_id = $1`,
        [e.cuentas.claseGasto],
      );
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it('imputar sobre una cuenta INACTIVA falla con LG009, que no es LG004', async () => {
    const retirada = await cuentaNueva({ activo: false });
    const err = await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          crearAsientoBorrador(tx, e, [
            { accountId: retirada.id, side: 'debito', monto: 1000_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 1000_00 },
          ]),
        ),
      SQLSTATE.CUENTA_INACTIVA,
      'el INSERT de una partida contra una cuenta inactiva',
    );
    expect(err.message).toContain('inactiva');
  });

  it('cambiar la cuenta de una partida de un borrador a una agrupadora también falla', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const entryId = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 500_00));
          await tx.query(
            'UPDATE journal_line SET account_id = $1 WHERE journal_entry_id = $2 AND linea = 1',
            [e.cuentas.claseGasto, entryId],
          );
        }),
      SQLSTATE.CUENTA_NO_IMPUTABLE,
      'reapuntar una partida de un borrador a una cuenta de agrupación',
    );
  });

  it('el camino normal sigue funcionando: cuenta hoja, borrador y publicación', async () => {
    const estado = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 250_00));
      await publicarAsiento(tx, entryId, e.userId);
      const { rows } = await tx.query<{ estado: string }>(
        'SELECT estado FROM journal_entry WHERE id = $1',
        [entryId],
      );
      return rows[0]!.estado;
    });
    expect(estado).toBe('posted');
  });
});

// =============================================================================
describe('D-089 · 2 — la reversa puede reproducir una cuenta ya retirada', () => {
  it('la cuenta se inactiva después de usarla y la reversa del asiento sigue siendo posible', async () => {
    const puente = await cuentaNueva({ naturaleza: 'debito' });

    // 1. Asiento publicado que usa la cuenta.
    const original = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, [
        { accountId: puente.id, side: 'debito', monto: 700_00 },
        { accountId: e.cuentas.proveedores, side: 'credito', monto: 700_00 },
      ]);
      await publicarAsiento(tx, id, e.userId);
      return id;
    });

    // 2. La cuenta se retira del plan.
    await db.asAdmin((tx) => tx.query('UPDATE account SET activo = false WHERE id = $1', [puente.id]));

    // 3. Una partida NUEVA contra ella ya no entra...
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          crearAsientoBorrador(tx, e, [
            { accountId: puente.id, side: 'debito', monto: 100_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 100_00 },
          ]),
        ),
      SQLSTATE.CUENTA_INACTIVA,
      'una causación nueva contra la cuenta retirada',
    );

    // 4. ...pero la REVERSA del asiento que ya la usaba, sí.
    const estadoReversa = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const reversaId = uuid();
      await tx.query(
        `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, tipo,
                                    fecha_hecho_economico, descripcion, estado, source_document_id,
                                    approval_id, reverses_entry_id, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'reversa','2026-06-20','Reversa de prueba D-089','draft',$5,$6,$7,$8,$9)`,
        [
          reversaId,
          e.tenantId,
          e.companyId,
          e.fiscalPeriodId,
          e.sourceDocumentId,
          e.approvalId,
          original,
          `idem-rev-${reversaId}`,
          e.userId,
        ],
      );
      await tx.query(
        `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
         VALUES ($1,$2,$3,1,$4,'credito',70000), ($1,$2,$3,2,$5,'debito',70000)`,
        [e.tenantId, e.companyId, reversaId, puente.id, e.cuentas.proveedores],
      );
      await publicarAsiento(tx, reversaId, e.userId);
      const { rows } = await tx.query<{ estado: string }>(
        'SELECT estado FROM journal_entry WHERE id = $1',
        [reversaId],
      );
      return rows[0]!.estado;
    });

    expect(estadoReversa).toBe('posted');
  });

  it('la puerta de la reversa no sirve para colar una cuenta que el original no usaba', async () => {
    const original = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 900_00));
      await publicarAsiento(tx, id, e.userId);
      return id;
    });

    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const reversaId = uuid();
          await tx.query(
            `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, tipo,
                                        fecha_hecho_economico, descripcion, estado, source_document_id,
                                        approval_id, reverses_entry_id, idempotency_key, created_by)
             VALUES ($1,$2,$3,$4,'reversa','2026-06-20','Reversa tramposa','draft',$5,$6,$7,$8,$9)`,
            [
              reversaId,
              e.tenantId,
              e.companyId,
              e.fiscalPeriodId,
              e.sourceDocumentId,
              e.approvalId,
              original,
              `idem-rev2-${reversaId}`,
              e.userId,
            ],
          );
          await tx.query(
            `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
             VALUES ($1,$2,$3,1,$4,'credito',90000)`,
            [e.tenantId, e.companyId, reversaId, e.cuentas.claseGasto],
          );
        }),
      SQLSTATE.CUENTA_NO_IMPUTABLE,
      'una reversa que mete una cuenta agrupadora que el asiento original no tenía',
    );
  });
});

// =============================================================================
describe('D-089 · 3 — una cuenta con movimientos no se degrada', () => {
  let conMovimiento: { id: string; codigo: string };

  beforeAll(async () => {
    conMovimiento = await cuentaNueva({ naturaleza: 'debito' });
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, [
        { accountId: conMovimiento.id, side: 'debito', monto: 300_00 },
        { accountId: e.cuentas.proveedores, side: 'credito', monto: 300_00 },
      ]);
      await publicarAsiento(tx, id, e.userId);
    });
  });

  it('control: la base confirma que la cuenta tiene movimientos', async () => {
    const tiene = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ r: boolean }>(
        'SELECT app.cuenta_tiene_movimientos($1) AS r',
        [conMovimiento.id],
      );
      return rows[0]!.r;
    });
    expect(tiene).toBe(true);
  });

  it('cambiarle la naturaleza falla con PU002 — invertiría todos los reportes del pasado', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query("UPDATE account SET naturaleza = 'credito' WHERE id = $1", [conMovimiento.id]),
        ),
      SQLSTATE.CUENTA_NATURALEZA_INMUTABLE,
      'cambiar la naturaleza de una cuenta con movimientos',
    );
  });

  it('convertirla en agrupadora falla con PU003', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query('UPDATE account SET permite_movimiento = false WHERE id = $1', [conMovimiento.id]),
        ),
      SQLSTATE.CUENTA_CON_MOVIMIENTOS,
      'quitarle permite_movimiento a una cuenta con partidas',
    );
  });

  it('renumerarla falla con PU004', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query("UPDATE account SET codigo = '519999' WHERE id = $1", [conMovimiento.id]),
        ),
      SQLSTATE.CUENTA_CODIGO_INMUTABLE,
      'renumerar una cuenta con movimientos',
    );
  });

  it('borrarla falla con PU001, no con un 23503 ilegible', async () => {
    const err = await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM account WHERE id = $1', [conMovimiento.id])),
      SQLSTATE.CUENTA_EN_USO,
      'borrar una cuenta con partidas en el ledger',
    );
    expect(err.message).toContain('Inactívela');
  });

  it('INACTIVARLA sí se permite: es el camino previsto para retirarla', async () => {
    await db.asAdmin((tx) =>
      tx.query('UPDATE account SET activo = false WHERE id = $1', [conMovimiento.id]),
    );
    const activo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ activo: boolean }>('SELECT activo FROM account WHERE id = $1', [
        conMovimiento.id,
      ]);
      return rows[0]!.activo;
    });
    expect(activo).toBe(false);
  });

  it('cambiarle el nombre sigue siendo libre: no reinterpreta el histórico', async () => {
    await db.asAdmin((tx) =>
      tx.query("UPDATE account SET nombre = 'Nombre corregido' WHERE id = $1", [conMovimiento.id]),
    );
    const nombre = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nombre: string }>('SELECT nombre FROM account WHERE id = $1', [
        conMovimiento.id,
      ]);
      return rows[0]!.nombre;
    });
    expect(nombre).toBe('Nombre corregido');
  });
});

// =============================================================================
describe('D-089 · 4 — una cuenta que usa un concepto de causación activo', () => {
  let cuenta: { id: string; codigo: string };
  let conceptoId: string;

  beforeAll(async () => {
    cuenta = await cuentaNueva();
    conceptoId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO concepto_causacion (id, tenant_id, company_id, codigo, nombre,
                                         cuenta_gasto_id, aplica_retefuente, activo)
         VALUES ($1, $2, $3, $4, 'Concepto de prueba D-089', $5, false, true)`,
        [conceptoId, e.tenantId, e.companyId, `D089-${Date.now().toString(36)}`, cuenta.id],
      ),
    );
  });

  it('control: la base cuenta un concepto activo apuntando a esa cuenta', async () => {
    const n = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT app.cuenta_conceptos_activos($1) AS n',
        [cuenta.id],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBe(1);
  });

  it('inactivarla falla con PU005 mientras el concepto la use', async () => {
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('UPDATE account SET activo = false WHERE id = $1', [cuenta.id])),
      SQLSTATE.CUENTA_REFERENCIADA_POR_CONCEPTO,
      'retirar una cuenta que un concepto de causación activo usa',
    );
  });

  it('desimputarla falla igual', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query('UPDATE account SET permite_movimiento = false WHERE id = $1', [cuenta.id]),
        ),
      SQLSTATE.CUENTA_REFERENCIADA_POR_CONCEPTO,
      'desimputar una cuenta que un concepto de causación activo usa',
    );
  });

  it('retirado el concepto, la cuenta se puede inactivar', async () => {
    await db.asAdmin((tx) =>
      tx.query('UPDATE concepto_causacion SET activo = false WHERE id = $1', [conceptoId]),
    );
    await db.asAdmin((tx) => tx.query('UPDATE account SET activo = false WHERE id = $1', [cuenta.id]));
    const activo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ activo: boolean }>('SELECT activo FROM account WHERE id = $1', [
        cuenta.id,
      ]);
      return rows[0]!.activo;
    });
    expect(activo).toBe(false);
  });
});

// =============================================================================
describe('D-089 · 5 — el uso de una cuenta se consulta con el mismo criterio del motor', () => {
  it('app.cuenta_uso devuelve los conteos que la interfaz necesita', async () => {
    const cuenta = await cuentaNueva();
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, [
        { accountId: cuenta.id, side: 'debito', monto: 111_00 },
        { accountId: e.cuentas.proveedores, side: 'credito', monto: 111_00 },
      ]);
      await publicarAsiento(tx, id, e.userId);
    });

    const uso = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{
        partidas_ledger: string;
        conceptos_activos: string;
        cuentas_hijas: string;
        niif_mappings: string;
        exogena_mappings: string;
      }>('SELECT * FROM app.cuenta_uso($1)', [cuenta.id]);
      return rows[0]!;
    });

    expect(Number(uso.partidas_ledger)).toBe(1);
    expect(Number(uso.conceptos_activos)).toBe(0);
    expect(Number(uso.cuentas_hijas)).toBe(0);
  });

  it('una cuenta sin uso ninguno sí se borra: el guardia no es un candado universal', async () => {
    const suelta = await cuentaNueva();
    await db.asAdmin((tx) => tx.query('DELETE FROM account WHERE id = $1', [suelta.id]));
    const quedan = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM account WHERE id = $1',
        [suelta.id],
      );
      return rows[0]!.n;
    });
    expect(quedan).toBe(0);
  });

  it('reguardar una cuenta con los mismos valores no dispara ningún guardia', async () => {
    const cuenta = await cuentaNueva();
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, [
        { accountId: cuenta.id, side: 'debito', monto: 222_00 },
        { accountId: e.cuentas.proveedores, side: 'credito', monto: 222_00 },
      ]);
      await publicarAsiento(tx, id, e.userId);
    });

    // Exactamente el UPDATE que hace `guardarCuenta` al reimportar el PUC.
    await db.asAdmin((tx) =>
      tx.query(
        `UPDATE account SET nombre = nombre, naturaleza = naturaleza,
                            permite_movimiento = permite_movimiento, activo = activo,
                            codigo = codigo
          WHERE id = $1`,
        [cuenta.id],
      ),
    );
    expect(true).toBe(true);
  });
});

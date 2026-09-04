/**
 * A14 — COMPUERTA AMPLIADA DE D-089 (Módulo PUC / Plan de cuentas).
 *
 * Nada de lo que sigue se cree por reporte de otro agente. Cada garantía que
 * D-089 declara se ataca aquí con arsenal propio, SALTÁNDOSE la interfaz y los
 * servicios: inserción directa contra las tablas, bajo `asTenant` (RLS activa,
 * rol `app_user`, sesión real), que es el único sitio donde un PASS significa
 * algo (D-004).
 *
 * Focos, en el orden en que el encargo los pide:
 *   1. Ninguna partida entra contra una cuenta agrupadora o inactiva — bloqueo
 *      en el MOTOR, y la puerta de la reversa no se puede abusar.
 *   2. La personalización por empresa NO puede editar el catálogo base global.
 *   3. Aislamiento RLS entre empresas para las cuentas personalizadas, y
 *      `app.cuenta_uso` (SECURITY DEFINER) no es canal de fuga.
 *   4. PU001..PU005 por inserción directa (patrón TP001 de D-084).
 *   5/6. Integridad del catálogo del PUC cargado por A1 y coherencia de 2365.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db';
import type { TestDb } from '../helpers/db';
import { crearEscenario, crearAsientoBorrador, publicarAsiento } from '../helpers/fixtures';
import type { Escenario } from '../helpers/fixtures';
import { isPostgresError } from '../../src/db/types';

let db: TestDb;
let A: Escenario;
let B: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  A = await crearEscenario(db, { razonSocial: 'Firma A' });
  B = await crearEscenario(db, { razonSocial: 'Firma B' });
}, 240_000);

afterAll(async () => {
  await db?.close();
});

/** Contadores, no sorteos: un código de cuenta sorteado choca contra
 *  `account_codigo_uq` con una probabilidad que no es despreciable, y una
 *  prueba de integridad intermitente se acaba silenciando. */
let seqCuenta = 0;
let seqGlobal = 0;

/** Cuenta recién creada en el alcance de la empresa `e`, sin uso. */
async function cuentaDe(
  e: Escenario,
  campos: Partial<{
    codigo: string;
    naturaleza: 'debito' | 'credito';
    permiteMovimiento: boolean;
    activo: boolean;
  }> = {},
): Promise<{ id: string; codigo: string }> {
  const id = uuid();
  seqCuenta += 1;
  const codigo = campos.codigo ?? `5295${String(seqCuenta + 10).padStart(2, '0')}`;
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
        `Cuenta A14 ${codigo}`,
        campos.naturaleza ?? 'debito',
        campos.permiteMovimiento ?? true,
        campos.activo ?? true,
      ],
    ),
  );
  return { id, codigo };
}

/** INSERT crudo de una partida, sin pasar por ningún servicio. */
function insertarPartida(
  tx: Parameters<Parameters<TestDb['asTenant']>[2]>[0],
  e: Escenario,
  entryId: string,
  linea: number,
  accountId: string,
  side: 'debito' | 'credito',
  monto: number,
) {
  return tx.query(
    `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id,
                               side, monto, third_party_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.tenantId, e.companyId, entryId, linea, accountId, side, monto, e.thirdPartyId],
  );
}

// =============================================================================
describe('A14/D-089 · FOCO 1 — ninguna partida entra contra una agrupadora ni contra una inactiva', () => {
  it('INSERT DIRECTO de una partida en BORRADOR contra una agrupadora → LG004 del motor', async () => {
    const agrup = await cuentaDe(A, { permiteMovimiento: false });
    const err = await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, async (tx) => {
          const entryId = await crearAsientoBorrador(tx, A, []);
          await insertarPartida(tx, A, entryId, 1, agrup.id, 'debito', 100_00);
        }),
      'LG004',
      'imputar un BORRADOR sobre una cuenta agrupadora',
    );
    expect(err.message).toMatch(/CUENTA_NO_IMPUTABLE/);
  });

  it('INSERT DIRECTO contra una cuenta INACTIVA → LG009', async () => {
    const inact = await cuentaDe(A, { activo: false });
    const err = await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, async (tx) => {
          const entryId = await crearAsientoBorrador(tx, A, []);
          await insertarPartida(tx, A, entryId, 1, inact.id, 'debito', 100_00);
        }),
      'LG009',
      'imputar sobre una cuenta inactiva',
    );
    expect(err.message).toMatch(/CUENTA_INACTIVA/);
  });

  it('UPDATE de una partida de borrador para APUNTARLA a una agrupadora → LG004', async () => {
    const agrup = await cuentaDe(A, { permiteMovimiento: false });
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, async (tx) => {
          const entryId = await crearAsientoBorrador(tx, A, [
            { accountId: A.cuentas.gasto, side: 'debito', monto: 100_00 },
            { accountId: A.cuentas.proveedores, side: 'credito', monto: 100_00 },
          ]);
          await tx.query('UPDATE journal_line SET account_id = $1 WHERE journal_entry_id = $2 AND linea = 1', [
            agrup.id,
            entryId,
          ]);
        }),
      'LG004',
      'reapuntar una partida de borrador a una agrupadora',
    );
  });

  it('NO existe camino para publicar un asiento con una partida contra una agrupadora: el ledger queda cerrado por los dos extremos', async () => {
    // El único camino que quedaba era: imputar cuando la cuenta era hoja y
    // degradarla después. PU003 lo impide, y aquí se comprueba de verdad.
    const c = await cuentaDe(A);
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 50_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 50_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET permite_movimiento = false WHERE id = $1', [c.id]),
        ),
      'PU003',
      'degradar a agrupadora una cuenta ya publicada en el ledger',
    );
  });

  // ---------------------------------------------------------------------------
  // LA PUERTA DE LA REVERSA
  // ---------------------------------------------------------------------------
  it('la reversa SÍ reproduce una cuenta que se INACTIVÓ después (un error del pasado no queda incorregible)', async () => {
    const c = await cuentaDe(A);
    const original = await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 70_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 70_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
      return entryId;
    });
    // Se retira la cuenta del plan. Es el camino previsto: activo = false.
    await db.asTenant(A.tenantId, A.companyId, (tx) =>
      tx.query('UPDATE account SET activo = false WHERE id = $1', [c.id]),
    );

    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const rev = uuid();
      await tx.query(
        `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                    descripcion, estado, tipo, reverses_entry_id, source_document_id,
                                    approval_id, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'2026-06-15','Reversa legítima','draft','reversa',$5,$6,$7,$8,$9)`,
        [rev, A.tenantId, A.companyId, A.fiscalPeriodId, original, A.sourceDocumentId, A.approvalId,
         `rev-ok-${rev}`, A.userId],
      );
      await insertarPartida(tx, A, rev, 1, c.id, 'credito', 70_00);
      await insertarPartida(tx, A, rev, 2, A.cuentas.proveedores, 'debito', 70_00);
      await publicarAsiento(tx, rev, A.userId);
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM journal_line WHERE journal_entry_id = $1',
        [rev],
      );
      expect(Number(rows[0]!.n)).toBe(2);
    });
  });

  it('ABUSO: la reversa NO puede colar una cuenta agrupadora que el asiento original no tenía → LG004', async () => {
    const agrup = await cuentaDe(A, { permiteMovimiento: false });
    const original = await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: A.cuentas.gasto, side: 'debito', monto: 90_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 90_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
      return entryId;
    });
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, async (tx) => {
          const rev = uuid();
          await tx.query(
            `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                        descripcion, estado, tipo, reverses_entry_id, source_document_id,
                                        approval_id, idempotency_key, created_by)
             VALUES ($1,$2,$3,$4,'2026-06-15','Reversa maliciosa','draft','reversa',$5,$6,$7,$8,$9)`,
            [rev, A.tenantId, A.companyId, A.fiscalPeriodId, original, A.sourceDocumentId, A.approvalId,
             `rev-mal-${rev}`, A.userId],
          );
          await insertarPartida(tx, A, rev, 1, agrup.id, 'credito', 90_00);
        }),
      'LG004',
      'colar una agrupadora nueva por la puerta de la reversa',
    );
  });

  it('ABUSO: una reversa NO puede apuntar a un asiento de OTRA empresa (la puerta ni se abre)', async () => {
    // La cuenta agrupadora es GLOBAL para que ambas empresas la vean: si el
    // portillo existiera, este es el camino por el que se cruzaría.
    const agrupGlobalId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1, NULL, NULL, $2, 'Agrupadora global de prueba A14', 3, 'debito', false)`,
        [agrupGlobalId, `52${(seqGlobal += 1) + 10}`],
      ),
    );
    // En la empresa B se publica un asiento que SÍ contiene esa cuenta... no se
    // puede (LG004). Así que se fabrica el histórico por la vía administrativa,
    // que es el peor caso concebible: una partida legítima anterior a D-089.
    const entryB = uuid();
    await db.asAdmin((tx) =>
      tx.query('ALTER TABLE journal_line DISABLE TRIGGER journal_line_valida_cuenta'),
    );
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                    descripcion, estado, source_document_id, approval_id,
                                    idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'2026-06-15','Histórico de B','draft',$5,$6,$7,$8)`,
        [entryB, B.tenantId, B.companyId, B.fiscalPeriodId, B.sourceDocumentId, B.approvalId,
         `hist-b-${entryB}`, B.userId],
      );
      await tx.query(
        `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
         VALUES ($1,$2,$3,1,$4,'debito',10000), ($1,$2,$3,2,$5,'credito',10000)`,
        [B.tenantId, B.companyId, entryB, agrupGlobalId, B.cuentas.proveedores],
      );
    });
    await db.asAdmin((tx) =>
      tx.query('ALTER TABLE journal_line ENABLE TRIGGER journal_line_valida_cuenta'),
    );

    // Empresa A intenta "reversar" el asiento de B para colar la agrupadora.
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, async (tx) => {
          const rev = uuid();
          await tx.query(
            `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                        descripcion, estado, tipo, reverses_entry_id, source_document_id,
                                        approval_id, idempotency_key, created_by)
             VALUES ($1,$2,$3,$4,'2026-06-15','Reversa cruzada','draft','reversa',$5,$6,$7,$8,$9)`,
            [rev, A.tenantId, A.companyId, A.fiscalPeriodId, entryB, A.sourceDocumentId, A.approvalId,
             `rev-x-${rev}`, A.userId],
          );
          await insertarPartida(tx, A, rev, 1, agrupGlobalId, 'debito', 10000);
        }),
      // Ni siquiera llega a la puerta: `journal_entry_reversa_fk` es una clave
      // foránea COMPUESTA por (tenant, empresa, id) — D-032/018 —, así que un
      // asiento de A no puede declararse reversa de un asiento de B. El
      // portillo se cierra un paso antes de donde se buscaba.
      '23503',
      'usar el histórico de otra empresa como llave de la puerta de la reversa',
    );
  });
});

// =============================================================================
describe('A14/D-089 · FOCO 2 — el catálogo base (global) no se edita desde una firma', () => {
  let globalId: string;
  let globalCodigo: string;

  beforeAll(async () => {
    globalCodigo = `53${(seqGlobal += 1) + 10}`;
    globalId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1, NULL, NULL, $2, 'CUENTA GLOBAL DEL CATÁLOGO BASE', 3, 'debito', true)`,
        [globalId, globalCodigo],
      ),
    );
  });

  it('la firma VE la cuenta global (catálogo compartido)', async () => {
    const n = await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM account WHERE id = $1',
        [globalId],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBe(1);
  });

  it('UPDATE directo del NOMBRE de la fila global → lo rechaza el MOTOR (CT001), no la aplicación', async () => {
    // Antes de la migración 181 este camino ya moría, pero por WITH CHECK de la
    // RLS (42501) y con un mensaje que no decía nada. Ahora muere con motivo.
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET nombre = $2 WHERE id = $1', [globalId, 'SECUESTRADA']),
        ),
      'CT001',
      'renombrar una cuenta del catálogo global',
    );
    const nombre = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nombre: string }>('SELECT nombre FROM account WHERE id = $1', [
        globalId,
      ]);
      return rows[0]!.nombre;
    });
    expect(nombre).toBe('CUENTA GLOBAL DEL CATÁLOGO BASE');
  });

  it('V-47 · APROPIACIÓN: UPDATE que se lleva la fila global al tenant propio (tenant_id = mío) → CT001', async () => {
    // Este es el camino que la política híbrida dejaba abierto: la fila vieja
    // satisface USING por ser global, la nueva satisface WITH CHECK por ser
    // mía, y la firma se queda con una fila del catálogo compartido.
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET tenant_id = $2 WHERE id = $1', [globalId, A.tenantId]),
        ),
      'CT001',
      'apropiarse de una fila del catálogo base',
    );
    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tenant_id: string | null }>(
        'SELECT tenant_id FROM account WHERE id = $1',
        [globalId],
      );
      return rows[0];
    });
    expect(
      fila?.tenant_id,
      'la cuenta del catálogo base cambió de dueño: una firma se apropió de una fila global y se la quitó a todas las demás',
    ).toBeNull();
  });

  it('V-47 · APROPIACIÓN por empresa: UPDATE que le pone company_id propio a la fila global → CT001', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET company_id = $2 WHERE id = $1', [globalId, A.companyId]),
        ),
      'CT001',
      'atar una fila global a una empresa concreta',
    );
    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ company_id: string | null }>(
        'SELECT company_id FROM account WHERE id = $1',
        [globalId],
      );
      return rows[0];
    });
    expect(fila?.company_id, 'la fila global quedó atada a una empresa concreta').toBeNull();
  });

  it('V-47 · DELETE directo de la fila global desde una sesión de firma → CT001', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('DELETE FROM account WHERE id = $1', [globalId]),
        ),
      'CT001',
      'borrar una cuenta del catálogo base',
    );
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM account WHERE id = $1', [
        globalId,
      ]);
      return Number(rows[0]!.n);
    });
    expect(
      n,
      'una firma borró una cuenta del catálogo base: se la quitó a las otras 59 empresas de todas las firmas',
    ).toBe(1);
  });

  it('V-47 · DELETE masivo del catálogo base (WHERE tenant_id IS NULL) NO puede prosperar', async () => {
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM account WHERE tenant_id IS NULL',
      );
      return Number(rows[0]!.n);
    });
    let error: unknown;
    try {
      await db.asTenant(A.tenantId, A.companyId, (tx) =>
        tx.query('DELETE FROM account WHERE tenant_id IS NULL'),
      );
    } catch (e) {
      error = e;
    }
    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM account WHERE tenant_id IS NULL',
      );
      return Number(rows[0]!.n);
    });
    expect(despues, `el catálogo base pasó de ${antes} a ${despues} cuentas desde una sesión de firma`).toBe(
      antes,
    );
    expect(error).toBeDefined();
  });

  it('crear una cuenta con el tenant_id de OTRA firma → 42501 (WITH CHECK)', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query(
            `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
             VALUES ($1, $2, '549999', 'Cuenta plantada en otra firma', 4, 'debito', true)`,
            [B.tenantId, B.companyId],
          ),
        ),
      '42501',
      'plantar una cuenta en otra firma',
    );
  });

  it('crear una cuenta GLOBAL (tenant_id NULL) desde una firma → 42501', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query(
            `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
             VALUES (NULL, NULL, '548888', 'Cuenta global plantada', 4, 'debito', true)`,
          ),
        ),
      '42501',
      'plantar una cuenta en el catálogo base',
    );
  });

  it('guardarCuenta con el código de una cuenta global crea la PROPIA y deja intacta la global', async () => {
    const { guardarCuenta } = await import('../../src/services/puc');
    const r = await db.asTenant(A.tenantId, A.companyId, (tx) =>
      guardarCuenta(tx, {
        codigo: globalCodigo,
        nombre: 'Mi versión de la cuenta',
        naturaleza: 'credito',
        permiteMovimiento: true,
      }),
    );
    expect(r.creada).toBe(true);
    expect(r.id).not.toBe(globalId);
    const global = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nombre: string; naturaleza: string; tenant_id: string | null }>(
        'SELECT nombre, naturaleza, tenant_id FROM account WHERE id = $1',
        [globalId],
      );
      return rows[0]!;
    });
    expect(global.nombre).toBe('CUENTA GLOBAL DEL CATÁLOGO BASE');
    expect(global.naturaleza).toBe('debito');
    expect(global.tenant_id).toBeNull();
  });

  it('ocultarCuentaGenerica no toca la global: crea la propia inactiva', async () => {
    const codigo = `53${(seqGlobal += 1) + 10}`;
    const idGlobal = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1, NULL, NULL, $2, 'OTRA GLOBAL', 3, 'debito', true)`,
        [idGlobal, codigo],
      ),
    );
    const { ocultarCuentaGenerica } = await import('../../src/services/puc');
    await db.asTenant(A.tenantId, A.companyId, (tx) => ocultarCuentaGenerica(tx, codigo));
    const { activo, n } = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ activo: boolean }>('SELECT activo FROM account WHERE id = $1', [
        idGlobal,
      ]);
      const { rows: propias } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM account WHERE codigo = $1 AND company_id = $2 AND NOT activo',
        [codigo, A.companyId],
      );
      return { activo: rows[0]!.activo, n: Number(propias[0]!.n) };
    });
    expect(activo).toBe(true);
    expect(n).toBe(1);
  });
});

// =============================================================================
describe('A14/D-089 · FOCO 3 — aislamiento de las cuentas personalizadas', () => {
  it('la empresa B no ve ni puede tocar la cuenta propia de la empresa A', async () => {
    const propiaA = await cuentaDe(A);
    const visto = await db.asTenant(B.tenantId, B.companyId, async (tx) => {
      const { rows } = await tx.query('SELECT id FROM account WHERE id = $1', [propiaA.id]);
      return rows.length;
    });
    expect(visto, 'la RLS dejó ver una cuenta propia de otra firma').toBe(0);

    // Un UPDATE sin filas afectadas no lanza; lo que importa es que no cambie.
    await db.asTenant(B.tenantId, B.companyId, (tx) =>
      tx.query('UPDATE account SET nombre = $2 WHERE id = $1', [propiaA.id, 'ROBADA']),
    );
    await db.asTenant(B.tenantId, B.companyId, (tx) =>
      tx.query('DELETE FROM account WHERE id = $1', [propiaA.id]),
    );
    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nombre: string }>('SELECT nombre FROM account WHERE id = $1', [
        propiaA.id,
      ]);
      return rows[0];
    });
    expect(fila?.nombre).toBe(`Cuenta A14 ${propiaA.codigo}`);
  });

  it('conceptosQueUsanCuenta / conceptosQueUsanCuentas no devuelven conceptos de otra firma', async () => {
    const cuentaA = await cuentaDe(A);
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO concepto_causacion (tenant_id, company_id, codigo, nombre, cuenta_gasto_id,
                                         aplica_retefuente, activo)
         VALUES ($1, $2, $3, 'Concepto secreto de la firma A', $4, false, true)`,
        [A.tenantId, A.companyId, `secreto-${uuid().slice(0, 8)}`, cuentaA.id],
      ),
    );
    const { conceptosQueUsanCuenta, conceptosQueUsanCuentas } = await import('../../src/services/puc');

    const desdeA = await db.asTenant(A.tenantId, A.companyId, (tx) =>
      conceptosQueUsanCuenta(tx, cuentaA.id),
    );
    expect(desdeA.length).toBe(1);
    expect(desdeA[0]!.roles).toContain('gasto');

    const desdeB = await db.asTenant(B.tenantId, B.companyId, (tx) =>
      conceptosQueUsanCuenta(tx, cuentaA.id),
    );
    expect(desdeB, 'el nombre de un concepto de otra firma salió por el reverse-lookup').toEqual([]);

    const loteB = await db.asTenant(B.tenantId, B.companyId, (tx) =>
      conceptosQueUsanCuentas(tx, [cuentaA.id]),
    );
    expect(loteB.size).toBe(0);
  });

  it('app.cuenta_uso es SECURITY DEFINER a propósito: devuelve CONTEOS y ni un nombre, monto o código', async () => {
    const cuentaA = await cuentaDe(A);
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: cuentaA.id, side: 'debito', monto: 12_345_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 12_345_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });

    const filas = await db.asTenant(B.tenantId, B.companyId, async (tx) => {
      const { rows } = await tx.query<Record<string, unknown>>('SELECT * FROM app.cuenta_uso($1)', [
        cuentaA.id,
      ]);
      return rows;
    });
    // El contrato declarado: solo conteos. Se comprueba la FORMA, no la
    // intención: cinco columnas, todas numéricas, ninguna textual.
    const columnas = Object.keys(filas[0]!);
    expect(columnas.sort()).toEqual(
      ['conceptos_activos', 'cuentas_hijas', 'exogena_mappings', 'niif_mappings', 'partidas_ledger'].sort(),
    );
    for (const [k, v] of Object.entries(filas[0]!)) {
      expect(
        typeof v === 'number' || typeof v === 'string' ? !Number.isNaN(Number(v)) : false,
        `app.cuenta_uso devolvió algo que no es un número en la columna ${k}: ${String(v)}`,
      ).toBe(true);
    }
    // Y no revela el MONTO: solo cuántas partidas. Ninguna columna vale 1234500.
    const valores = Object.values(filas[0]!).map((v) => Number(v));
    expect(valores).not.toContain(12_345_00);
    expect(Number(filas[0]!.partidas_ledger)).toBe(1);
  });

  it('app.cuenta_uso con un uuid inventado no lanza ni delata nada: todo a cero', async () => {
    const filas = await db.asTenant(B.tenantId, B.companyId, async (tx) => {
      const { rows } = await tx.query<Record<string, unknown>>('SELECT * FROM app.cuenta_uso($1)', [uuid()]);
      return rows;
    });
    expect(Object.values(filas[0]!).map(Number)).toEqual([0, 0, 0, 0, 0]);
  });
});

// =============================================================================
describe('A14/D-089 · FOCO 4 — PU001..PU005 por inserción directa (patrón TP001 de D-084)', () => {
  it('PU001 · no se borra una cuenta con partidas en el ledger', async () => {
    const c = await cuentaDe(A);
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 33_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 33_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });
    await esperarErrorPg(
      () => db.asTenant(A.tenantId, A.companyId, (tx) => tx.query('DELETE FROM account WHERE id = $1', [c.id])),
      'PU001',
      'borrar una cuenta con partidas',
    );
    // Y tampoco desde el superusuario: el guardia está en la BASE.
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM account WHERE id = $1', [c.id])),
      'PU001',
      'borrar una cuenta con partidas como superusuario',
    );
  });

  it('PU001 · no se borra una cuenta con hijas, ni con mapeo NIIF', async () => {
    const padreId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,$3,'5299','Padre con hijas',3,'debito',false)`,
        [padreId, A.tenantId, A.companyId],
      ),
    );
    const padre = { id: padreId };
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
         VALUES ($1,$2,'529905','Hija',4,$3,'debito',true)`,
        [A.tenantId, A.companyId, padre.id],
      ),
    );
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM account WHERE id = $1', [padre.id])),
      'PU001',
      'borrar una cuenta con hijas',
    );
  });

  it('PU002 · una cuenta con movimientos NO cambia de naturaleza (ni por SQL directo)', async () => {
    const c = await cuentaDe(A, { naturaleza: 'debito' });
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 44_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 44_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });
    const err = await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET naturaleza = $2 WHERE id = $1', [c.id, 'credito']),
        ),
      'PU002',
      'invertir la naturaleza de una cuenta con histórico',
    );
    expect(err.message).toMatch(/NATURALEZA_INMUTABLE/);
  });

  it('PU004 · una cuenta con movimientos NO se renumera', async () => {
    const c = await cuentaDe(A);
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 55_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 55_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET codigo = $2 WHERE id = $1', [c.id, '529777']),
        ),
      'PU004',
      'renumerar una cuenta con histórico',
    );
  });

  it('PU005 · una cuenta que usa un concepto de causación ACTIVO no se inactiva ni se desimputa', async () => {
    const c = await cuentaDe(A);
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO concepto_causacion (tenant_id, company_id, codigo, nombre, cuenta_gasto_id,
                                         aplica_retefuente, activo)
         VALUES ($1,$2,$3,'Concepto vivo',$4,false,true)`,
        [A.tenantId, A.companyId, `pu005-${uuid().slice(0, 8)}`, c.id],
      ),
    );
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET activo = false WHERE id = $1', [c.id]),
        ),
      'PU005',
      'retirar una cuenta que un concepto activo usa',
    );
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('UPDATE account SET permite_movimiento = false WHERE id = $1', [c.id]),
        ),
      'PU005',
      'desimputar una cuenta que un concepto activo usa',
    );
  });

  it('inactivar SÍ se permite con movimientos y sin conceptos: es el camino previsto para retirar', async () => {
    const c = await cuentaDe(A);
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 66_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 66_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });
    await db.asTenant(A.tenantId, A.companyId, (tx) =>
      tx.query('UPDATE account SET activo = false WHERE id = $1', [c.id]),
    );
    const activo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ activo: boolean }>('SELECT activo FROM account WHERE id = $1', [c.id]);
      return rows[0]!.activo;
    });
    expect(activo).toBe(false);
  });

  it('reguardar una cuenta con los MISMOS valores no dispara ningún guardia', async () => {
    const c = await cuentaDe(A);
    await db.asTenant(A.tenantId, A.companyId, async (tx) => {
      const entryId = await crearAsientoBorrador(tx, A, [
        { accountId: c.id, side: 'debito', monto: 77_00 },
        { accountId: A.cuentas.proveedores, side: 'credito', monto: 77_00 },
      ]);
      await publicarAsiento(tx, entryId, A.userId);
    });
    await db.asTenant(A.tenantId, A.companyId, (tx) =>
      tx.query(
        `UPDATE account SET nombre = nombre, naturaleza = naturaleza,
                            permite_movimiento = permite_movimiento, activo = activo,
                            codigo = codigo
          WHERE id = $1`,
        [c.id],
      ),
    );
  });
});

// =============================================================================
describe('A14/D-089 · V-47 — el agujero NO era solo de `account`: barrido de las 18 tablas de catálogo híbrido', () => {
  it('toda tabla con política RLS híbrida lleva el guardia del catálogo global (inventario que se mantiene solo)', async () => {
    const { hibridas, conGuardia } = await db.asAdmin(async (tx) => {
      // Las tablas híbridas se reconocen por la FORMA de su política, no por
      // una lista escrita a mano: `tenant_id IS NULL OR tenant_id = ...` en el
      // USING es exactamente lo que instala `app.instalar_rls_hibrida`.
      const { rows: pol } = await tx.query<{ tablename: string }>(
        `SELECT DISTINCT tablename FROM pg_policies
          WHERE schemaname = 'public'
            AND qual LIKE '%tenant_id IS NULL%'
          ORDER BY tablename`,
      );
      const { rows: trg } = await tx.query<{ tabla: string }>(
        `SELECT c.relname AS tabla
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND t.tgname LIKE '%\_zz\_global\_solo\_lectura'`,
      );
      return { hibridas: pol.map((p) => p.tablename), conGuardia: new Set(trg.map((t) => t.tabla)) };
    });
    expect(hibridas.length).toBeGreaterThan(10);
    const sinGuardia = hibridas.filter((t) => !conGuardia.has(t));
    expect(
      sinGuardia,
      'estas tablas exponen su catálogo global a UPDATE/DELETE desde cualquier sesión de firma',
    ).toEqual([]);
  });

  it('V-47 · una firma NO puede vaciar los permisos de un ROL DEL SISTEMA (los comparten todas las firmas)', async () => {
    const rolSistema = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT id FROM role WHERE tenant_id IS NULL AND codigo = 'contador'",
      );
      return rows[0]!.id;
    });
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM role_permission WHERE role_id = $1',
        [rolSistema],
      );
      return Number(rows[0]!.n);
    });
    expect(antes).toBeGreaterThan(0);
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('DELETE FROM role_permission WHERE role_id = $1', [rolSistema]),
        ),
      'CT001',
      'vaciar los permisos de un rol del sistema',
    );
    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM role_permission WHERE role_id = $1',
        [rolSistema],
      );
      return Number(rows[0]!.n);
    });
    expect(despues, 'el rol del sistema perdió permisos para TODAS las firmas').toBe(antes);
  });

  it('V-47 · una firma NO puede borrar el valor global de la UVT (borrarlo deja sin calcular a TODA la plataforma)', async () => {
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, norma_respaldo)
         VALUES (NULL, NULL, 2099, 100000, '2099-01-01', 'Fila de prueba de A14, no normativa')`,
      ),
    );
    await esperarErrorPg(
      () =>
        db.asTenant(A.tenantId, A.companyId, (tx) =>
          tx.query('DELETE FROM uvt_value WHERE anio = 2099'),
        ),
      'CT001',
      'borrar el valor global de la UVT',
    );
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM uvt_value WHERE anio = 2099',
      );
      return Number(rows[0]!.n);
    });
    expect(n, 'la UVT global desapareció desde la sesión de una firma').toBe(1);
  });

  it('V-47 · una firma NO puede borrar un municipio ni una actividad CIIU del catálogo nacional', async () => {
    const { municipioId, ciiuId } = await db.asAdmin(async (tx) => {
      const { rows: m } = await tx.query<{ id: string }>(
        `INSERT INTO municipality (tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
         VALUES (NULL, '99999', 'Municipio global de prueba', 'Departamento', '99') RETURNING id`,
      );
      const { rows: c } = await tx.query<{ id: string }>(
        `INSERT INTO ciiu_activity (tenant_id, codigo, nombre)
         VALUES (NULL, '9999', 'Actividad global de prueba') RETURNING id`,
      );
      return { municipioId: m[0]!.id, ciiuId: c[0]!.id };
    });
    await esperarErrorPg(
      () => db.asTenant(A.tenantId, A.companyId, (tx) => tx.query('DELETE FROM municipality WHERE id = $1', [municipioId])),
      'CT001',
      'borrar un municipio del catálogo nacional',
    );
    await esperarErrorPg(
      () => db.asTenant(A.tenantId, A.companyId, (tx) => tx.query('DELETE FROM ciiu_activity WHERE id = $1', [ciiuId])),
      'CT001',
      'borrar una actividad CIIU del catálogo nacional',
    );
  });

  it('V-47 · una firma NO puede borrar una vigencia global de tax_rule TODAVÍA NO VIGENTE (PR003 solo cubre las que ya rigen)', async () => {
    const reglaId = await db.asAdmin(async (tx) => {
      const { rows: c } = await tx.query<{ id: string }>(
        `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
         VALUES (NULL, NULL, 'retefuente', 'a14_v47_probe', 'Concepto de prueba de A14') RETURNING id`,
      );
      const { rows: r } = await tx.query<{ id: string }>(
        `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre,
                               aplica_a, vigente_desde, norma_respaldo)
         VALUES (NULL, NULL, $1, 'retefuente', 0.010000, 'base_gravable', 'ambos', '2099-01-01',
                 'Fila de prueba de A14, no normativa') RETURNING id`,
        [c[0]!.id],
      );
      return r[0]!.id;
    });
    await esperarErrorPg(
      () => db.asTenant(A.tenantId, A.companyId, (tx) => tx.query('DELETE FROM tax_rule WHERE id = $1', [reglaId])),
      'CT001',
      'borrar una vigencia global futura',
    );
  });

  it('el guardia NO estorba al camino administrativo: sin sesión (migraciones y seeds) la fila global sí se corrige', async () => {
    const id = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1, NULL, NULL, '5399', 'Global administrable', 3, 'debito', true)`,
        [id],
      ),
    );
    await db.asAdmin((tx) => tx.query("UPDATE account SET nombre = 'Corregida por migración' WHERE id = $1", [id]));
    await db.asAdmin((tx) => tx.query('DELETE FROM account WHERE id = $1', [id]));
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM account WHERE id = $1', [id]);
      return Number(rows[0]!.n);
    });
    expect(n).toBe(0);
  });
});

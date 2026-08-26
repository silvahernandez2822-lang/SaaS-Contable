/**
 * A14 — QA ADVERSARIAL. LAS CUATRO PRUEBAS DE LA COMPUERTA DE LA OLA 0.
 *
 * Estas pruebas están escritas desde cero. No revisan las de A2 ni las de A12:
 * las tratan como una afirmación a refutar. Una prueba escrita por el mismo
 * agente que escribió el código puede estar midiendo justo lo que ese agente
 * creía, así que aquí se vuelve a atacar cada garantía por caminos que ellos no
 * recorrieron: mutaciones que no cambian nada, UPDATE y DELETE masivos sin
 * WHERE, TRUNCATE (que NO dispara los triggers de fila), descuadres de un solo
 * centavo, descuadres introducidos después de publicar dentro de la misma
 * transacción, contexto forjado sin pasar por `withSessionContext`, y barridos
 * por catálogo en lugar de muestras.
 *
 * Criterio único: si el rechazo no trae SQLSTATE de PostgreSQL, no cuenta.
 * Un `throw` de TypeScript demuestra que la aplicación se porta bien hoy, no
 * que la base impida lo contrario mañana.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import {
  crearAsientoBorrador,
  crearEscenario,
  partidasEquilibradas,
  publicarAsiento,
} from '../helpers/fixtures.js';
import type { Escenario } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import { comillas, fotoDeFila, rechazoConCodigo, rechazoDelMotor, tablasCon } from './_arsenal.js';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

// =============================================================================
// AUDITORÍA DEL HARNESS — antes de creerle nada al harness, se le revisa a él.
// =============================================================================
describe('A14 · precondición — el banco de pruebas no está mintiendo', () => {
  it('dentro de asTenant el rol efectivo no es superusuario, no tiene BYPASSRLS y no es dueño de las tablas', async () => {
    const e = await crearEscenario(db);

    const perfil = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{
        usuario: string;
        superusuario: boolean;
        bypassrls: boolean;
        tablas_propias: number;
      }>(
        `SELECT current_user AS usuario,
                r.rolsuper     AS superusuario,
                r.rolbypassrls AS bypassrls,
                (SELECT count(*)::int FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r'
                    AND c.relowner = r.oid) AS tablas_propias
           FROM pg_roles r WHERE r.rolname = current_user`,
      );
      return rows[0]!;
    });

    expect(perfil.usuario).toBe('app_user');
    // Cualquiera de estas tres en true convierte TODA prueba de aislamiento
    // de este repositorio en un falso PASS.
    expect(perfil.superusuario).toBe(false);
    expect(perfil.bypassrls).toBe(false);
    expect(perfil.tablas_propias).toBe(0);
  });

  it('la RLS está realmente activa en la sesión de prueba, no solo declarada en el catálogo', async () => {
    const e = await crearEscenario(db);
    const activa = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ tabla: string; activa: boolean }>(
        `SELECT t AS tabla, row_security_active(t) AS activa
           FROM unnest(ARRAY['journal_entry','journal_line','third_party','audit_log',
                             'company','tax_rule','"user"']) AS t`,
      );
      return rows;
    });
    expect(activa.length).toBeGreaterThan(0);
    for (const fila of activa) {
      expect(`${fila.tabla}: ${fila.activa}`).toBe(`${fila.tabla}: true`);
    }
  });

  it('toda tabla de datos lleva ENABLE y además FORCE: sin FORCE la política es decorativa para el dueño', async () => {
    const flojas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string; en: boolean; forced: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS en, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND c.relname <> 'schema_migration'
            AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
          ORDER BY 1`,
      );
      return rows.map((r) => r.relname);
    });
    expect(flojas).toEqual([]);
  });
});

// =============================================================================
// COMPUERTA 1 — «Un intento de UPDATE sobre un journal_entry publicado
//                falla a nivel de base de datos.»
// =============================================================================
describe('A14 · COMPUERTA 1 — el asiento publicado no se muta ni se borra', () => {
  let e: Escenario;
  let publicado: string;
  let borrador: string;
  let foto: Record<string, unknown> | null;

  beforeAll(async () => {
    e = await crearEscenario(db);
    publicado = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 4_500_000_00));
      await publicarAsiento(tx, id, e.userId);
      return id;
    });
    borrador = await db.asTenant(e.tenantId, e.companyId, async (tx) =>
      crearAsientoBorrador(tx, e, partidasEquilibradas(e, 9_900_00), {
        descripcion: 'Borrador que convive con el publicado',
      }),
    );
    foto = await db.asAdmin((tx) => fotoDeFila(tx, 'journal_entry', publicado));
    expect(foto).not.toBeNull();
  });

  it('el UPDATE que NO cambia nada también falla: el candado es el estado, no el diff', async () => {
    const r = await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('UPDATE journal_entry SET descripcion = descripcion WHERE id = $1', [publicado]),
        ),
      [SQLSTATE.LEDGER_INMUTABLE],
      'el UPDATE idempotente sobre un asiento publicado',
    );
    expect(r.code).toBe('LG001');
  });

  it('devolver el asiento a borrador (des-publicarlo) falla', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query("UPDATE journal_entry SET estado = 'draft' WHERE id = $1", [publicado]),
        ),
      [SQLSTATE.LEDGER_INMUTABLE],
      'revertir el estado de posted a draft',
    );
  });

  it('anularlo tampoco: «anulado» no es una puerta trasera para borrar', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query("UPDATE journal_entry SET estado = 'anulado' WHERE id = $1", [publicado]),
        ),
      [SQLSTATE.LEDGER_INMUTABLE],
      'anular un asiento publicado',
    );
  });

  it('un UPDATE MASIVO sin WHERE se estrella contra la fila publicada y no deja pasar el resto', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query("UPDATE journal_entry SET descripcion = 'reescritura masiva'"),
        ),
      [SQLSTATE.LEDGER_INMUTABLE],
      'el UPDATE sin WHERE sobre todo el ledger',
    );

    // Y el borrador que iba en el mismo lote tampoco quedó reescrito.
    const desc = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ descripcion: string }>(
        'SELECT descripcion FROM journal_entry WHERE id = $1',
        [borrador],
      );
      return rows[0]?.descripcion;
    });
    expect(desc).toBe('Borrador que convive con el publicado');
  });

  it('un DELETE MASIVO sin WHERE falla: el ledger no se vacía ni de golpe', async () => {
    await rechazoConCodigo(
      () => db.asTenant(e.tenantId, e.companyId, (tx) => tx.query('DELETE FROM journal_entry')),
      [SQLSTATE.LEDGER_INMUTABLE],
      'el DELETE sin WHERE sobre todo el ledger',
    );
  });

  it('DELETE incluso sobre un BORRADOR falla: journal_entry es append-only, sin matices', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('DELETE FROM journal_entry WHERE id = $1', [borrador]),
        ),
      [SQLSTATE.LEDGER_INMUTABLE],
      'el DELETE de un asiento en borrador',
    );
  });

  it('las partidas del publicado no admiten UPDATE, ni DELETE, ni una partida NUEVA', async () => {
    for (const [descripcion, sql, params] of [
      [
        'subir el monto de una partida publicada',
        'UPDATE journal_line SET monto = monto + 1 WHERE journal_entry_id = $1',
        [publicado],
      ],
      [
        'borrar una partida publicada',
        'DELETE FROM journal_line WHERE journal_entry_id = $1',
        [publicado],
      ],
      [
        'colar una partida nueva en un asiento publicado',
        `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
         VALUES ($1, $2, $3, 99, $4, 'debito', 1)`,
        [e.tenantId, e.companyId, publicado, e.cuentas.gasto],
      ],
    ] as [string, string, readonly unknown[]][]) {
      await rechazoConCodigo(
        () => db.asTenant(e.tenantId, e.companyId, (tx) => tx.query(sql, params)),
        [SQLSTATE.LEDGER_INMUTABLE],
        descripcion,
      );
    }
  });

  it('TRUNCATE no es una vía de escape: los triggers de fila no se disparan con TRUNCATE, así que el privilegio tiene que faltar', async () => {
    // Un BEFORE DELETE FOR EACH ROW no ve un TRUNCATE. Si `app_user` tuviera el
    // privilegio, LG001 no se enteraría y el ledger entero se iría en una línea.
    const conTruncate = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND has_table_privilege('app_user', c.oid, 'TRUNCATE')
          ORDER BY 1`,
      );
      return rows.map((r) => r.relname);
    });
    expect(conTruncate).toEqual([]);

    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) => tx.query('TRUNCATE journal_entry CASCADE')),
      ['42501'],
      'TRUNCATE del ledger como app_user',
    );
  });

  it('ni el SUPERUSUARIO puede tocarlo: la garantía es del trigger, no del GRANT ni de la RLS', async () => {
    await rechazoConCodigo(
      () =>
        db.asAdmin((tx) =>
          tx.query("UPDATE journal_entry SET descripcion = 'mano del dueño' WHERE id = $1", [
            publicado,
          ]),
        ),
      [SQLSTATE.LEDGER_INMUTABLE],
      'el UPDATE del superusuario sobre un asiento publicado',
    );
    await rechazoConCodigo(
      () => db.asAdmin((tx) => tx.query('DELETE FROM journal_entry WHERE id = $1', [publicado])),
      [SQLSTATE.LEDGER_INMUTABLE],
      'el DELETE del superusuario sobre un asiento publicado',
    );
  });

  it('VEREDICTO: después de nueve intentos, la fila es idéntica byte a byte a la fotografía inicial', async () => {
    const ahora = await db.asAdmin((tx) => fotoDeFila(tx, 'journal_entry', publicado));
    expect(ahora).toEqual(foto);
  });
});

// =============================================================================
// COMPUERTA 2 — «Un asiento desbalanceado es rechazado por la BD,
//                no por la aplicación.»
// =============================================================================
describe('A14 · COMPUERTA 2 — el descuadre lo rechaza el motor, en el COMMIT', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario(db);
  });

  it('un descuadre de UN CENTAVO basta: no hay tolerancia, ni redondeo piadoso', async () => {
    const r = await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 1_000_000_01 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 1_000_000_00 },
          ]);
          await publicarAsiento(tx, id, e.userId);
        }),
      [SQLSTATE.ASIENTO_DESBALANCEADO],
      'publicar un asiento que descuadra en un centavo',
    );
    expect(r.message).toContain('descuadra');
  });

  it('el descuadre introducido DESPUÉS de publicar, dentro de la misma transacción, también se caza en el COMMIT', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 500_000_00));
          await publicarAsiento(tx, id, e.userId);
          // El asiento ya está "posted" en esta transacción; se le añade una
          // partida que lo descuadra antes del COMMIT.
          await tx.query(
            `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
             VALUES ($1, $2, $3, 50, $4, 'debito', 7_777)`,
            [e.tenantId, e.companyId, id, e.cuentas.gasto],
          );
        }),
      [SQLSTATE.ASIENTO_DESBALANCEADO, SQLSTATE.LEDGER_INMUTABLE],
      'descuadrar un asiento recién publicado dentro de la misma transacción',
    );
  });

  it('pedir SET CONSTRAINTS ALL IMMEDIATE no desactiva la validación, la adelanta', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 300_000_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 100_000_00 },
          ]);
          await publicarAsiento(tx, id, e.userId);
          await tx.exec('SET CONSTRAINTS ALL IMMEDIATE');
        }),
      [SQLSTATE.ASIENTO_DESBALANCEADO],
      'publicar descuadrado forzando la validación inmediata',
    );
  });

  it('publicar con UPDATE directo, sin pasar por app.publicar_asiento, no evita la validación', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 88_000_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 87_000_00 },
          ]);
          await tx.query(
            "UPDATE journal_entry SET estado='posted', posted_at=now() WHERE id=$1",
            [id],
          );
        }),
      [SQLSTATE.ASIENTO_DESBALANCEADO],
      'publicar por UPDATE crudo un asiento descuadrado',
    );
  });

  it('un asiento de una sola partida no pasa por «suma cero» trivial: exige doble partida', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 10_00 },
          ]);
          await publicarAsiento(tx, id, e.userId);
        }),
      [SQLSTATE.ASIENTO_SIN_PARTIDAS],
      'publicar un asiento con una sola partida',
    );
  });

  it('un asiento SIN NINGUNA partida tampoco se publica (suma cero de la nada)', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, []);
          await publicarAsiento(tx, id, e.userId);
        }),
      [SQLSTATE.ASIENTO_SIN_PARTIDAS],
      'publicar un asiento sin partidas',
    );
  });

  it('montos absurdos no desbordan hacia un cuadre falso: el motor falla cerrado', async () => {
    const maximo = '9223372036854775807'; // bigint máximo
    const r = await rechazoDelMotor(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const id = await crearAsientoBorrador(tx, e, []);
          for (const [linea, side] of [
            [1, 'debito'],
            [2, 'debito'],
            [3, 'credito'],
          ] as const) {
            await tx.query(
              `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
               VALUES ($1,$2,$3,$4,$5,$6,$7::bigint)`,
              [e.tenantId, e.companyId, id, linea, e.cuentas.gasto, side, maximo],
            );
          }
          await publicarAsiento(tx, id, e.userId);
        }),
      'publicar un asiento cuyas sumas desbordan el rango de bigint',
    );
    // Lo importante no es QUÉ código sale, sino que salga uno: el desbordamiento
    // no puede terminar en un asiento publicado. 22003 (fuera de rango) y LG002
    // son ambos aceptables; un éxito, no.
    expect(['22003', SQLSTATE.ASIENTO_DESBALANCEADO]).toContain(r.code);
  });

  it('CONTROL: el asiento equilibrado sí se publica, y el descuadrado no dejó rastro', async () => {
    const bueno = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 777_777_00), {
        descripcion: 'Asiento de control, equilibrado',
      });
      await publicarAsiento(tx, id, e.userId);
      return id;
    });

    const estado = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ estado: string; descuadrados: number }>(
        `SELECT (SELECT estado FROM journal_entry WHERE id = $1) AS estado,
                (SELECT count(*)::int FROM (
                   SELECT je.id
                     FROM journal_entry je JOIN journal_line jl ON jl.journal_entry_id = je.id
                    WHERE je.estado = 'posted'
                    GROUP BY je.id
                   HAVING SUM(CASE WHEN jl.side='debito' THEN jl.monto ELSE -jl.monto END) <> 0
                 ) q) AS descuadrados`,
        [bueno],
      );
      return rows[0]!;
    });

    expect(estado.estado).toBe('posted');
    // Barrido: NINGÚN asiento publicado de esta firma descuadra.
    expect(estado.descuadrados).toBe(0);
  });
});

// =============================================================================
// COMPUERTA 3 — «Una consulta sin filtro de tenant devuelve cero filas
//                de otros tenants.» Y el segundo nivel: company.
// =============================================================================
describe('A14 · COMPUERTA 3 — aislamiento de tenant Y de empresa, impuesto por el motor', () => {
  let alfa: Escenario;
  let beta: Escenario;
  /** Segunda empresa DE LA MISMA FIRMA que alfa, con datos propios. */
  let alfaEmpresa2: { companyId: string; thirdPartyId: string };

  beforeAll(async () => {
    alfa = await crearEscenario(db, { razonSocial: 'Firma Alfa' });
    beta = await crearEscenario(db, { razonSocial: 'Firma Beta' });

    const companyId = uuid();
    const thirdPartyId = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, buzon_email)
         VALUES ($1, $2, $3, 'Segunda empresa de Alfa', $4)`,
        [companyId, alfa.tenantId, `600${Date.now()}`, `alfa2-${Date.now()}@inbox.local`],
      );
      await tx.query(
        `INSERT INTO third_party (id, tenant_id, company_id, numero_documento, tipo_persona,
                                  razon_social, codigo_dane)
         VALUES ($1, $2, $3, $4, 'juridica', 'Proveedor exclusivo de la empresa 2', '11001')`,
        [thirdPartyId, alfa.tenantId, companyId, `902${Date.now()}`],
      );
    });
    alfaEmpresa2 = { companyId, thirdPartyId };
  });

  it('CONTROL: como superusuario los datos de las dos firmas existen de verdad', async () => {
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM third_party WHERE tenant_id = ANY($1)',
        [[alfa.tenantId, beta.tenantId]],
      );
      return rows[0]!.n;
    });
    // Si esto fuera 0, los "cero filas" de abajo no probarían nada.
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('BARRIDO POR CATÁLOGO: en NINGUNA tabla con tenant_id se ve una fila de la otra firma', async () => {
    const tablas = await db.asAdmin((tx) => tablasCon(tx, 'tenant_id'));
    expect(tablas.length).toBeGreaterThan(15);

    const fugas = await db.asTenant(alfa.tenantId, alfa.companyId, async (tx) => {
      const encontradas: string[] = [];
      for (const tabla of tablas) {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${comillas(tabla)} WHERE tenant_id = $1`,
          [beta.tenantId],
        );
        if (rows[0]!.n > 0) encontradas.push(`${tabla}=${rows[0]!.n}`);
      }
      return encontradas;
    });

    expect(fugas).toEqual([]);
  });

  it('BARRIDO POR CATÁLOGO: tampoco se ve una fila de otra EMPRESA de la propia firma', async () => {
    const tablas = await db.asAdmin((tx) => tablasCon(tx, 'company_id'));
    expect(tablas.length).toBeGreaterThan(10);

    const fugas = await db.asTenant(alfa.tenantId, alfa.companyId, async (tx) => {
      const encontradas: string[] = [];
      for (const tabla of tablas) {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${comillas(tabla)} WHERE company_id = $1`,
          [alfaEmpresa2.companyId],
        );
        if (rows[0]!.n > 0) encontradas.push(`${tabla}=${rows[0]!.n}`);
      }
      return encontradas;
    });

    expect(fugas).toEqual([]);
  });

  it('y al revés: desde la empresa 2 no se ven los terceros de la empresa 1 (la fuga no es unidireccional)', async () => {
    const visto = await db.asTenant(alfa.tenantId, alfaEmpresa2.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM third_party WHERE id = $1',
        [alfa.thirdPartyId],
      );
      return rows[0]!.n;
    });
    expect(visto).toBe(0);
  });

  it('LAS VISTAS tampoco filtran: se consultan todas, no una muestra', async () => {
    const vistas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.views
          WHERE table_schema = 'public' ORDER BY 1`,
      );
      return rows.map((r) => r.table_name);
    });
    expect(vistas.length).toBeGreaterThan(0);

    const fugas = await db.asTenant(alfa.tenantId, alfa.companyId, async (tx) => {
      const encontradas: string[] = [];
      for (const vista of vistas) {
        const { rows: cols } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
          [vista],
        );
        if (cols[0]!.n === 0) continue;
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${comillas(vista)} WHERE tenant_id = $1`,
          [beta.tenantId],
        );
        if (rows[0]!.n > 0) encontradas.push(`${vista}=${rows[0]!.n}`);
      }
      return encontradas;
    });

    expect(fugas).toEqual([]);
  });

  it('escribir sobre la otra firma es rechazado por el motor, no ignorado en silencio', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
          tx.query(
            `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona,
                                      razon_social, codigo_dane)
             VALUES ($1, $2, '999999999', 'juridica', 'Tercero implantado en la otra firma', '11001')`,
            [beta.tenantId, beta.companyId],
          ),
        ),
      [SQLSTATE.RLS_VIOLATION],
      'insertar una fila con el tenant_id de otra firma',
    );
  });

  it('UPDATE y DELETE sin WHERE no rozan una sola fila de la otra firma', async () => {
    const tocadas = await db.asTenant(alfa.tenantId, alfa.companyId, async (tx) => {
      await tx.query("UPDATE third_party SET razon_social = razon_social || ' [tocado]'");
      const { rows } = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM third_party WHERE razon_social LIKE '%[tocado]%'",
      );
      return rows[0]!.n;
    });
    // El UPDATE sin WHERE sí hizo su trabajo... dentro de la propia empresa.
    expect(tocadas).toBeGreaterThan(0);

    // El DELETE sin WHERE se intenta aparte: puede chocar con una FK de la
    // PROPIA firma (atributos fiscales del tercero), y eso no es lo que se
    // está midiendo. Lo que se mide es que la otra firma quede intacta.
    await db
      .asTenant(alfa.tenantId, alfa.companyId, (tx) => tx.query('DELETE FROM third_party'))
      .catch(() => undefined);

    const beta1 = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ razon_social: string }>(
        'SELECT razon_social FROM third_party WHERE id = $1',
        [beta.thirdPartyId],
      );
      return rows[0]?.razon_social ?? null;
    });
    const alfa2 = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ razon_social: string }>(
        'SELECT razon_social FROM third_party WHERE id = $1',
        [alfaEmpresa2.thirdPartyId],
      );
      return rows[0]?.razon_social ?? null;
    });

    // Ni la otra firma...
    expect(beta1).not.toBeNull();
    expect(beta1).not.toContain('[tocado]');
    // ...ni la otra EMPRESA de la firma propia.
    expect(alfa2).not.toBeNull();
    expect(alfa2).not.toContain('[tocado]');
  });

  it('SIN pasar por withSessionContext: token de Alfa + app.company_id de Beta forjado a mano → cero filas', async () => {
    // Este es el punto que las pruebas de A12 comprueban en TypeScript
    // (EmpresaNoAutorizadaError). Aquí se comprueba en el MOTOR: se salta el
    // envoltorio por completo y se le miente a la GUC directamente. Si la
    // garantía viviera en `withSessionContext`, aquí habría filas.
    const { token } = await db.emitirSesion(alfa.tenantId, alfa.companyId, {
      userId: alfa.userId,
    });

    const r = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');
      await tx.query(
        `SELECT set_config('app.session_token', $1, true),
                set_config('app.company_id',    $2, true),
                set_config('app.tenant_id',     $3, true)`,
        [token, beta.companyId, beta.tenantId],
      );
      const { rows } = await tx.query<{
        tenant: string | null;
        company: string | null;
        terceros: number;
        asientos: number;
        documentos: number;
      }>(
        `SELECT app.current_tenant_id()::text AS tenant,
                app.current_company_id()::text AS company,
                (SELECT count(*)::int FROM third_party)     AS terceros,
                (SELECT count(*)::int FROM journal_entry)   AS asientos,
                (SELECT count(*)::int FROM source_document) AS documentos`,
      );
      return rows[0]!;
    });

    // El tenant lo decide el token, no la GUC forjada.
    expect(r.tenant).toBe(alfa.tenantId);
    // La empresa pedida no está autorizada -> NULL, y con NULL no cuadra nada.
    expect(r.company).toBeNull();
    expect(r.terceros).toBe(0);
    expect(r.asientos).toBe(0);
    expect(r.documentos).toBe(0);
  });

  it('sin ningún token, un app_user no ve una sola fila DE NINGUNA FIRMA, en ninguna tabla', async () => {
    const tablas = await db.asAdmin((tx) => tablasCon(tx, 'tenant_id'));
    const conFilas = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');
      const encontradas: string[] = [];
      for (const tabla of tablas) {
        // `tenant_id IS NOT NULL` = fila que pertenece a ALGUNA firma. Las filas
        // globales de los catálogos híbridos (tenant_id NULL) son deliberadamente
        // públicas (D-015) y se comprueban aparte, en la prueba siguiente.
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${comillas(tabla)} WHERE tenant_id IS NOT NULL`,
        );
        if (rows[0]!.n > 0) encontradas.push(`${tabla}=${rows[0]!.n}`);
      }
      return encontradas;
    });
    expect(conFilas).toEqual([]);
  });

  it('lo único visible sin sesión son las filas GLOBALES de los catálogos, y ninguna lleva dato de una firma', async () => {
    // Comprobación explícita del escape de D-015, para que quede medido y no
    // dado por hecho: sin token se ven los cinco roles de sistema y el catálogo
    // de permisos, y nada de eso pertenece a nadie.
    const visible = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');
      const tablas = await tablasCon(tx, 'tenant_id');
      const resumen: Record<string, number> = {};
      for (const tabla of tablas) {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${comillas(tabla)}`,
        );
        if (rows[0]!.n > 0) resumen[tabla] = rows[0]!.n;
      }
      return resumen;
    });

    // Solo catálogos globales; ninguna tabla de datos de negocio.
    const prohibidas = [
      'journal_entry',
      'journal_line',
      'third_party',
      'source_document',
      'audit_log',
      'company',
      'user',
      'user_session',
      'retention_applied',
      'approval',
    ];
    for (const t of prohibidas) {
      expect(`${t}: ${visible[t] ?? 0}`).toBe(`${t}: 0`);
    }
  });
});

// =============================================================================
// COMPUERTA 4 — «Insertar una vigencia nueva no altera la anterior; una consulta
//                con fecha pasada devuelve la regla que estaba vigente en esa
//                fecha.»
// =============================================================================
describe('A14 · COMPUERTA 4 — las vigencias son append-only y se resuelven por la fecha del hecho', () => {
  let e: Escenario;
  let conceptoId: string;
  let v1: string;
  let v2: string;
  let fotoV1Antes: Record<string, unknown> | null;

  // Tarifas deliberadamente ficticias: en la Ola 0 no hay ni un dato normativo
  // cargado, y no le corresponde a A14 inventarlo (advertencia 17.5).
  const TARIFA_V1 = '0.111111';
  const TARIFA_V2 = '0.222222';

  beforeAll(async () => {
    e = await crearEscenario(db);
    conceptoId = uuid();
    v1 = uuid();
    v2 = uuid();

    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, tipo, codigo, nombre)
         VALUES ($1, $2, 'retefuente', 'a14_vigencias', 'Concepto sonda de A14')`,
        [conceptoId, e.tenantId],
      );
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, account_id,
                               vigente_desde, norma_respaldo)
         VALUES ($1, $2, $3, 'retefuente', $4, $5, '2025-01-01',
                 'Valor ficticio de A14 para probar mecánica de vigencias — no es dato normativo')`,
        [v1, e.tenantId, conceptoId, TARIFA_V1, e.cuentas.retefuentePorPagar],
      );
    });

    fotoV1Antes = await db.asAdmin((tx) => fotoDeFila(tx, 'tax_rule', v1));
  });

  it('crear la vigencia nueva NO deja ni un byte distinto en la anterior salvo su cierre', async () => {
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      await tx.query("UPDATE tax_rule SET vigente_hasta = '2026-06-30' WHERE id = $1", [v1]);
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, account_id,
                               vigente_desde, norma_respaldo)
         VALUES ($1, $2, $3, 'retefuente', $4, $5, '2026-07-01',
                 'Segunda vigencia ficticia de A14 — no es dato normativo')`,
        [v2, e.tenantId, conceptoId, TARIFA_V2, e.cuentas.retefuentePorPagar],
      );
    });

    const fotoV1Despues = await db.asAdmin((tx) => fotoDeFila(tx, 'tax_rule', v1));
    expect(fotoV1Despues).not.toBeNull();

    // Comparación byte a byte de TODAS las columnas menos la que sí cambia.
    const antes = { ...(fotoV1Antes as Record<string, unknown>) };
    const despues = { ...(fotoV1Despues as Record<string, unknown>) };
    delete antes['vigente_hasta'];
    delete despues['vigente_hasta'];
    expect(despues).toEqual(antes);

    expect(fotoV1Despues!['vigente_hasta']).toBe('2026-06-30');
    expect(String(fotoV1Despues!['tarifa'])).toBe(TARIFA_V1);
  });

  it('una fecha del pasado resuelve la regla de ENTONCES, no la de hoy', async () => {
    const resuelto = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ fecha: string; id: string; tarifa: string }>(
        `SELECT f.fecha::text AS fecha, r.id, r.tarifa::text AS tarifa
           FROM (VALUES ('2025-01-01'::date), ('2026-06-15'::date), ('2026-06-30'::date),
                        ('2026-07-01'::date), ('2027-03-09'::date)) AS f(fecha)
           JOIN tax_rule r
             ON r.tax_concept_id = $1
            AND app.esta_vigente(r.vigente_desde, r.vigente_hasta, f.fecha)
          ORDER BY f.fecha`,
        [conceptoId],
      );
      return rows;
    });

    // Exactamente una regla por fecha: sin ambigüedad y sin huecos.
    expect(resuelto.map((r) => r.fecha)).toEqual([
      '2025-01-01',
      '2026-06-15',
      '2026-06-30',
      '2026-07-01',
      '2027-03-09',
    ]);
    // Los bordes son inclusivos por los dos lados.
    expect(resuelto.map((r) => r.tarifa)).toEqual([
      TARIFA_V1,
      TARIFA_V1,
      TARIFA_V1,
      TARIFA_V2,
      TARIFA_V2,
    ]);
  });

  it('el motor NO resuelve por la fecha de proceso: hoy es 2026-08-26 y una factura de junio sigue dando la tarifa de junio', async () => {
    const porFechaDelHecho = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ tarifa: string }>(
        `SELECT tarifa::text AS tarifa FROM tax_rule
          WHERE tax_concept_id = $1
            AND app.esta_vigente(vigente_desde, vigente_hasta, DATE '2026-06-15')`,
        [conceptoId],
      );
      return rows[0]?.tarifa;
    });
    const porFechaDeHoy = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ tarifa: string }>(
        `SELECT tarifa::text AS tarifa FROM tax_rule
          WHERE tax_concept_id = $1
            AND app.esta_vigente(vigente_desde, vigente_hasta, current_date)`,
        [conceptoId],
      );
      return rows[0]?.tarifa;
    });

    expect(porFechaDelHecho).toBe(TARIFA_V1);
    expect(porFechaDeHoy).toBe(TARIFA_V2);
    // Si estas dos fueran iguales, la Regla de Oro 3 estaría rota.
    expect(porFechaDelHecho).not.toBe(porFechaDeHoy);
  });

  it('el UPDATE de la tarifa de una vigencia existente lo rechaza el motor (PR001)', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('UPDATE tax_rule SET tarifa = 0.999999 WHERE id = $1', [v1]),
        ),
      [SQLSTATE.VIGENCIA_INMUTABLE],
      'reescribir la tarifa de una vigencia ya emitida',
    );
  });

  it('reabrir una vigencia ya cerrada, o moverle el cierre, también lo rechaza el motor', async () => {
    for (const [descripcion, sql] of [
      ['reabrir la vigencia cerrada', 'UPDATE tax_rule SET vigente_hasta = NULL WHERE id = $1'],
      [
        'correr la fecha de cierre',
        "UPDATE tax_rule SET vigente_hasta = '2026-12-31' WHERE id = $1",
      ],
      ['adelantar el inicio', "UPDATE tax_rule SET vigente_desde = '2024-01-01' WHERE id = $1"],
    ] as const) {
      await rechazoConCodigo(
        () => db.asTenant(e.tenantId, e.companyId, (tx) => tx.query(sql, [v1])),
        [SQLSTATE.VIGENCIA_INMUTABLE],
        descripcion,
      );
    }
  });

  it('solapar dos vigencias de la misma clave lo rechaza el motor (PR002), no un if de la aplicación', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO tax_rule (tenant_id, tax_concept_id, tipo, tarifa, account_id,
                                   vigente_desde, norma_respaldo)
             VALUES ($1, $2, 'retefuente', 0.333333, $3, '2026-08-01', 'Solape deliberado de A14')`,
            [e.tenantId, conceptoId, e.cuentas.retefuentePorPagar],
          ),
        ),
      [SQLSTATE.VIGENCIA_SOLAPADA],
      'insertar una vigencia solapada con la vigente',
    );
  });

  it('borrar una vigencia que ya surtió efecto lo rechaza el motor (PR003): la historia no se borra', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('DELETE FROM tax_rule WHERE id = $1', [v1]),
        ),
      [SQLSTATE.VIGENCIA_NO_BORRABLE],
      'borrar una vigencia pasada',
    );
  });

  it('CASO DORADO 17, la mitad que SÍ se puede probar hoy: cambiar la tarifa no toca la retención ya registrada', async () => {
    // El caso dorado completo necesita el motor de reglas (A3). Lo que sí es
    // verificable en la Ola 0 es la garantía de base de datos que lo sostiene:
    // `retention_applied` amarra la regla Y su vigencia con FK compuesta, así
    // que una vigencia posterior no puede reescribir lo ya causado.
    const retencionId = uuid();
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      await tx.query(
        `INSERT INTO retention_applied
           (id, tenant_id, company_id, source_document_id, tipo,
            tax_rule_id, regla_vigente_desde, regla_vigente_hasta,
            base, tarifa, valor, account_id, norma_respaldo, fecha_hecho_economico)
         VALUES ($1,$2,$3,$4,'retefuente',$5,'2025-01-01','2026-06-30',
                 1000000,$6,111111,$7,
                 'Sonda de A14 sobre la inmutabilidad de lo ya causado','2026-06-15')`,
        [
          retencionId,
          e.tenantId,
          e.companyId,
          e.sourceDocumentId,
          v1,
          TARIFA_V1,
          e.cuentas.retefuentePorPagar,
        ],
      );
    });

    const antes = await db.asAdmin((tx) => fotoDeFila(tx, 'retention_applied', retencionId));

    // Llega una vigencia nueva, muy posterior.
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      await tx.query("UPDATE tax_rule SET vigente_hasta = '2027-12-31' WHERE id = $1", [v2]);
      await tx.query(
        `INSERT INTO tax_rule (tenant_id, tax_concept_id, tipo, tarifa, account_id,
                               vigente_desde, norma_respaldo)
         VALUES ($1, $2, 'retefuente', 0.444444, $3, '2028-01-01', 'Tercera vigencia ficticia de A14')`,
        [e.tenantId, conceptoId, e.cuentas.retefuentePorPagar],
      );
    });

    const despues = await db.asAdmin((tx) => fotoDeFila(tx, 'retention_applied', retencionId));
    expect(despues).toEqual(antes);
    expect(String(despues!['tarifa'])).toBe(TARIFA_V1);
    expect(String(despues!['regla_vigente_desde'])).toBe('2025-01-01');
  });

  it('y una retención no puede MENTIR sobre qué vigencia usó: la FK compuesta lo impide', async () => {
    await rechazoConCodigo(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO retention_applied
               (tenant_id, company_id, source_document_id, tipo,
                tax_rule_id, regla_vigente_desde, regla_vigente_hasta,
                base, tarifa, valor, account_id, norma_respaldo, fecha_hecho_economico)
             VALUES ($1,$2,$3,'retefuente',$4,'2024-01-01','2026-12-31',
                     1000000,0.111111,111111,$5,'Vigencia inventada por A14','2026-06-15')`,
            [e.tenantId, e.companyId, e.sourceDocumentId, v1, e.cuentas.retefuentePorPagar],
          ),
        ),
      [SQLSTATE.FOREIGN_KEY_VIOLATION],
      'declarar una vigencia que la regla nunca tuvo',
    );
  });
});

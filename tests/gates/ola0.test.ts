/**
 * COMPUERTA DE LA OLA 0 — Agente A2
 *
 * Las cuatro pruebas que bloquean todo lo demás:
 *   1. UPDATE sobre un journal_entry publicado falla A NIVEL DE BASE DE DATOS.
 *   2. Un asiento desbalanceado lo rechaza la BD, no la aplicación.
 *   3. Una consulta sin filtro de tenant devuelve cero filas de otro tenant,
 *      con RLS activa y como rol sin privilegios.
 *   4. Insertar una vigencia nueva no altera la anterior, y una consulta con
 *      fecha pasada resuelve la regla que estaba vigente entonces.
 *
 * Cada rechazo se verifica por SQLSTATE. Una prueba que pasa porque el código
 * TypeScript validó antes de llegar al motor es un falso PASS y es exactamente
 * lo que invalida la Ola 0 (D-003).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import {
  crearAsientoBorrador,
  crearEscenario,
  partidasEquilibradas,
  publicarAsiento,
} from '../helpers/fixtures.js';
import type { Escenario } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

// =============================================================================
describe('Compuerta Ola 0 — control previo: el harness no corre como superusuario', () => {
  it('asTenant ejecuta como app_user y asAdmin como superusuario', async () => {
    const e = await crearEscenario(db);

    const comoTenant = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ usuario: string; superusuario: boolean }>(
        `SELECT current_user AS usuario,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario`,
      );
      return rows[0]!;
    });

    expect(comoTenant.usuario).toBe('app_user');
    // Si esto fuera true, TODAS las pruebas de RLS serían un falso PASS.
    expect(comoTenant.superusuario).toBe(false);

    const comoAdmin = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ usuario: string }>('SELECT current_user AS usuario');
      return rows[0]!;
    });
    expect(comoAdmin.usuario).not.toBe('app_user');
  });
});

// =============================================================================
describe('Compuerta 1 — el ledger publicado es inmutable en la base de datos', () => {
  let e: Escenario;
  let entryId: string;

  beforeAll(async () => {
    e = await crearEscenario(db);
    entryId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 1_000_000_00));
      await publicarAsiento(tx, id, e.userId);
      return id;
    });
  });

  it('el asiento quedó publicado (control: la vía normal sí funciona)', async () => {
    const fila = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ estado: string; posted_at: string | null }>(
        'SELECT estado, posted_at FROM journal_entry WHERE id = $1',
        [entryId],
      );
      return rows[0]!;
    });
    expect(fila.estado).toBe('posted');
    expect(fila.posted_at).not.toBeNull();
  });

  it('UPDATE sobre un asiento publicado falla con SQLSTATE LG001', async () => {
    const error = await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('UPDATE journal_entry SET descripcion = $2 WHERE id = $1', [
            entryId,
            'descripción manipulada',
          ]),
        ),
      SQLSTATE.LEDGER_INMUTABLE,
      'el UPDATE sobre un journal_entry publicado',
    );
    expect(error.message).toContain('LEDGER_INMUTABLE');
  });

  it('UPDATE del monto de una partida de un asiento publicado falla con LG001', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('UPDATE journal_line SET monto = monto + 1 WHERE journal_entry_id = $1', [
            entryId,
          ]),
        ),
      SQLSTATE.LEDGER_INMUTABLE,
      'el UPDATE sobre una journal_line publicada',
    );
  });

  it('DELETE sobre un asiento publicado falla con LG001', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('DELETE FROM journal_entry WHERE id = $1', [entryId]),
        ),
      SQLSTATE.LEDGER_INMUTABLE,
      'el DELETE sobre un journal_entry publicado',
    );
  });

  it('ni siquiera un SUPERUSUARIO puede modificarlo: la garantía es del motor, no del GRANT ni de la RLS', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query('UPDATE journal_entry SET descripcion = $2 WHERE id = $1', [
            entryId,
            'manipulado por el administrador',
          ]),
        ),
      SQLSTATE.LEDGER_INMUTABLE,
      'el UPDATE del superusuario sobre un asiento publicado',
    );

    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM journal_line WHERE journal_entry_id = $1', [entryId])),
      SQLSTATE.LEDGER_INMUTABLE,
      'el DELETE del superusuario sobre las partidas de un asiento publicado',
    );
  });

  it('el asiento sigue intacto después de todos los intentos', async () => {
    const fila = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ descripcion: string; total: string }>(
        `SELECT je.descripcion,
                (SELECT SUM(monto)::text FROM journal_line WHERE journal_entry_id = je.id) AS total
           FROM journal_entry je WHERE je.id = $1`,
        [entryId],
      );
      return rows[0]!;
    });
    expect(fila.descripcion).toBe('Causación de factura de compra');
    expect(fila.total).toBe('200000000'); // 2 partidas de $1.000.000 en centavos
  });

  it('la corrección se hace por reversa, y la vista deriva reversed_by sin tocar el original', async () => {
    const reversaId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const id = uuid();
      await tx.query(
        `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, tipo,
                                    fecha_hecho_economico, descripcion, estado,
                                    source_document_id, approval_id, reverses_entry_id,
                                    idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'reversa', '2026-06-20', 'Reversa de la causación', 'draft',
                 $5, $6, $7, $8, $9)`,
        [
          id,
          e.tenantId,
          e.companyId,
          e.fiscalPeriodId,
          e.sourceDocumentId,
          e.approvalId,
          entryId,
          `reversa-${id}`,
          e.userId,
        ],
      );
      // Partidas invertidas
      await tx.query(
        `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
         VALUES ($1, $2, $3, 1, $4, 'credito', 100000000),
                ($1, $2, $3, 2, $5, 'debito',  100000000)`,
        [e.tenantId, e.companyId, id, e.cuentas.gasto, e.cuentas.proveedores],
      );
      await publicarAsiento(tx, id, e.userId);
      return id;
    });

    const vista = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ reversed_by: string | null; esta_reversado: boolean }>(
        'SELECT reversed_by, esta_reversado FROM v_journal_entry WHERE id = $1',
        [entryId],
      );
      return rows[0]!;
    });

    expect(vista.reversed_by).toBe(reversaId);
    expect(vista.esta_reversado).toBe(true);
  });
});

// =============================================================================
describe('Compuerta 2 — un asiento desbalanceado lo rechaza la base de datos', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario(db);
  });

  it('control: un asiento equilibrado se publica sin problema', async () => {
    const id = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const entry = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 500_000_00));
      await publicarAsiento(tx, entry, e.userId);
      return entry;
    });
    expect(id).toBeTruthy();
  });

  it('publicar débitos ≠ créditos falla en el COMMIT con SQLSTATE LG002', async () => {
    const error = await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const entry = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 1_000_000_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 999_999_00 },
          ]);
          await publicarAsiento(tx, entry, e.userId);
        }),
      SQLSTATE.ASIENTO_DESBALANCEADO,
      'la publicación de un asiento desbalanceado',
    );
    expect(error.message).toContain('ASIENTO_DESBALANCEADO');
    // El mensaje trae el descuadre exacto en centavos, para el contador.
    expect(error.message).toMatch(/\d+ centavos/);
  });

  it('el asiento desbalanceado no quedó en la base: la transacción entera se revirtió', async () => {
    const total = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_line WHERE monto = 99999900`,
      );
      return rows[0]!.n;
    });
    expect(total).toBe(0);
  });

  it('publicar un asiento con una sola partida falla con LG003', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const entry = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 1000_00 },
          ]);
          await publicarAsiento(tx, entry, e.userId);
        }),
      SQLSTATE.ASIENTO_SIN_PARTIDAS,
      'la publicación de un asiento con una sola partida',
    );
  });

  it('imputar contra una cuenta que no permite movimiento falla con LG004', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const entry = await crearAsientoBorrador(tx, e, [
            { accountId: e.cuentas.claseGasto, side: 'debito', monto: 1000_00 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 1000_00 },
          ]);
          await publicarAsiento(tx, entry, e.userId);
        }),
      SQLSTATE.CUENTA_NO_IMPUTABLE,
      'la publicación contra una cuenta de clase',
    );
  });

  it('publicar sin aprobación aprobada falla con LG006', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, async (tx) => {
          const rechazoId = uuid();
          await tx.query(
            `INSERT INTO approval (id, tenant_id, company_id, entidad, entidad_id,
                                   source_document_id, decision, user_id, ip, motivo)
             VALUES ($1, $2, $3, 'source_document', $4, $4, 'rechazado', $5, '192.0.2.10', 'prueba')`,
            [rechazoId, e.tenantId, e.companyId, e.sourceDocumentId, e.userId],
          );
          const entryId = uuid();
          await tx.query(
            `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id,
                                        fecha_hecho_economico, descripcion, estado,
                                        source_document_id, approval_id, idempotency_key)
             VALUES ($1, $2, $3, $4, '2026-06-15', 'Sin aprobación', 'draft', $5, $6, $7)`,
            [
              entryId,
              e.tenantId,
              e.companyId,
              e.fiscalPeriodId,
              e.sourceDocumentId,
              rechazoId,
              `idem-${entryId}`,
            ],
          );
          await tx.query(
            `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
             VALUES ($1, $2, $3, 1, $4, 'debito', 100000), ($1, $2, $3, 2, $5, 'credito', 100000)`,
            [e.tenantId, e.companyId, entryId, e.cuentas.gasto, e.cuentas.proveedores],
          );
          await publicarAsiento(tx, entryId, e.userId);
        }),
      SQLSTATE.ASIENTO_SIN_APROBACION,
      'la publicación de un asiento cuya aprobación fue rechazada',
    );
  });

  it('insertar un asiento ya publicado (saltándose el borrador) falla con LG007', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                        descripcion, estado, posted_at, source_document_id,
                                        approval_id, idempotency_key)
             VALUES ($1, $2, $3, '2026-06-15', 'Nace publicado', 'posted', now(), $4, $5, $6)`,
            [
              e.tenantId,
              e.companyId,
              e.fiscalPeriodId,
              e.sourceDocumentId,
              e.approvalId,
              `idem-directo-${uuid()}`,
            ],
          ),
        ),
      SQLSTATE.ASIENTO_DEBE_NACER_BORRADOR,
      'el INSERT de un asiento directamente publicado',
    );
  });
});

// =============================================================================
describe('Compuerta 3 — aislamiento entre tenants impuesto por RLS', () => {
  let a: Escenario;
  let b: Escenario;

  beforeAll(async () => {
    a = await crearEscenario(db, { razonSocial: 'Firma A' });
    b = await crearEscenario(db, { razonSocial: 'Firma B' });

    for (const e of [a, b]) {
      await db.asTenant(e.tenantId, e.companyId, async (tx) => {
        const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e, 250_000_00));
        await publicarAsiento(tx, id, e.userId);
      });
    }
  });

  it('control: como superusuario los datos de ambos tenants existen', async () => {
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM third_party WHERE tenant_id IN ($1, $2)',
        [a.tenantId, b.tenantId],
      );
      return rows[0]!.n;
    });
    expect(n).toBe(2);
  });

  it('SELECT sin ningún WHERE solo devuelve filas del tenant en contexto', async () => {
    const filas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM third_party',
      );
      return rows;
    });

    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.tenant_id === a.tenantId)).toBe(true);
    expect(filas.some((f) => f.id === b.thirdPartyId)).toBe(false);
  });

  it('preguntar explícitamente por el id de otro tenant devuelve cero filas', async () => {
    const n = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM third_party WHERE id = $1',
        [b.thirdPartyId],
      );
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it('el ledger de otro tenant tampoco se ve, ni con SELECT sin filtro', async () => {
    const resultado = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const asientos = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM journal_entry');
      const partidas = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM journal_line');
      const documentos = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM source_document');
      return {
        asientos: asientos.rows,
        partidas: partidas.rows,
        documentos: documentos.rows,
      };
    });

    for (const conjunto of Object.values(resultado)) {
      expect(conjunto.length).toBeGreaterThan(0);
      expect(conjunto.every((f) => f.tenant_id === a.tenantId)).toBe(true);
    }
  });

  it('un UPDATE sin filtro de tenant no toca filas de otro tenant', async () => {
    await db.asTenant(a.tenantId, a.companyId, (tx) =>
      tx.query("UPDATE third_party SET nombre_comercial = 'tocado por A'"),
    );

    const nombreDeB = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nombre_comercial: string | null }>(
        'SELECT nombre_comercial FROM third_party WHERE id = $1',
        [b.thirdPartyId],
      );
      return rows[0]!.nombre_comercial;
    });
    expect(nombreDeB).toBeNull();
  });

  it('un DELETE sin filtro de tenant no borra filas de otro tenant', async () => {
    await db.asTenant(a.tenantId, a.companyId, (tx) => tx.query('DELETE FROM company_setting'));

    const sigueVivo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM third_party WHERE tenant_id = $1',
        [b.tenantId],
      );
      return rows[0]!.n;
    });
    expect(sigueVivo).toBe(1);
  });

  it('insertar una fila con el tenant_id de otro es rechazado por RLS (42501)', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(a.tenantId, a.companyId, (tx) =>
          tx.query(
            `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social)
             VALUES ($1, $2, '999999999', 'juridica', 'Inyectado en el tenant ajeno')`,
            [b.tenantId, b.companyId],
          ),
        ),
      SQLSTATE.RLS_VIOLATION,
      'el INSERT con el tenant_id de otra firma',
    );
  });

  it('sin contexto de tenant no se ve absolutamente nada', async () => {
    const n = await db.client.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');
      const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM third_party');
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it('el segundo nivel (company) también aísla dentro del mismo tenant', async () => {
    const otraCompanyId = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, $3, 'Segunda empresa de la firma A')`,
        [otraCompanyId, a.tenantId, `700${Date.now()}`],
      );
    });

    const n = await db.asTenant(a.tenantId, otraCompanyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM third_party');
      return rows[0]!.n;
    });
    // Mismo tenant, otra empresa: los terceros de la primera no se ven.
    expect(n).toBe(0);
  });
});

// =============================================================================
describe('Compuerta 4 — vigencias: insertar una nueva no altera la anterior', () => {
  let e: Escenario;
  let taxConceptId: string;
  let reglaV1: string;
  let reglaV2: string;

  beforeAll(async () => {
    e = await crearEscenario(db);
    taxConceptId = uuid();
    reglaV1 = uuid();

    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, tipo, codigo, nombre)
         VALUES ($1, $2, 'retefuente', 'servicios_prueba', 'Concepto de prueba de vigencias')`,
        [taxConceptId, e.tenantId],
      );
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               account_id, vigente_desde, norma_respaldo)
         VALUES ($1, $2, $3, 'retefuente', 0.040000, 4.0000, $4, '2025-01-01',
                 'Valor ficticio de prueba — no es dato normativo (A1 puebla los reales)')`,
        [reglaV1, e.tenantId, taxConceptId, e.cuentas.retefuentePorPagar],
      );
    });
  });

  it('editar la tarifa = cerrar la vigencia anterior e insertar una nueva', async () => {
    reglaV2 = uuid();
    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      // 1. Se cierra la vigencia anterior (único UPDATE permitido).
      await tx.query('UPDATE tax_rule SET vigente_hasta = $2 WHERE id = $1', [
        reglaV1,
        '2025-12-31',
      ]);
      // 2. Se inserta la vigencia nueva. La anterior no se toca.
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               account_id, vigente_desde, norma_respaldo)
         VALUES ($1, $2, $3, 'retefuente', 0.060000, 4.0000, $4, '2026-01-01',
                 'Valor ficticio de prueba — segunda vigencia')`,
        [reglaV2, e.tenantId, taxConceptId, e.cuentas.retefuentePorPagar],
      );
    });

    const v1 = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ tarifa: string; vigente_hasta: string }>(
        'SELECT tarifa::text AS tarifa, vigente_hasta::text AS vigente_hasta FROM tax_rule WHERE id = $1',
        [reglaV1],
      );
      return rows[0]!;
    });

    // La vigencia anterior conserva su tarifa intacta.
    expect(v1.tarifa).toBe('0.040000');
    expect(v1.vigente_hasta).toBe('2025-12-31');
  });

  it('una consulta con fecha pasada resuelve la regla que estaba vigente entonces', async () => {
    const resolver = (fecha: string) =>
      db.asTenant(e.tenantId, e.companyId, async (tx) => {
        const { rows } = await tx.query<{ id: string; tarifa: string; norma_respaldo: string }>(
          `SELECT id, tarifa::text AS tarifa, norma_respaldo
             FROM tax_rule
            WHERE tax_concept_id = $1
              AND app.esta_vigente(vigente_desde, vigente_hasta, $2::date)`,
          [taxConceptId, fecha],
        );
        return rows;
      });

    const enJunio2025 = await resolver('2025-06-15');
    expect(enJunio2025).toHaveLength(1);
    expect(enJunio2025[0]!.id).toBe(reglaV1);
    expect(enJunio2025[0]!.tarifa).toBe('0.040000');

    const enJunio2026 = await resolver('2026-06-15');
    expect(enJunio2026).toHaveLength(1);
    expect(enJunio2026[0]!.id).toBe(reglaV2);
    expect(enJunio2026[0]!.tarifa).toBe('0.060000');

    // Antes de la primera vigencia no resuelve nada: no se inventa una tarifa.
    expect(await resolver('2024-12-31')).toHaveLength(0);
  });

  it('UPDATE de la tarifa de una vigencia existente falla con SQLSTATE PR001', async () => {
    const error = await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('UPDATE tax_rule SET tarifa = 0.100000 WHERE id = $1', [reglaV1]),
        ),
      SQLSTATE.VIGENCIA_INMUTABLE,
      'el UPDATE de la tarifa de una vigencia',
    );
    expect(error.message).toContain('VIGENCIA_INMUTABLE');
  });

  it('reabrir o mover una vigencia ya cerrada falla con PR001', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('UPDATE tax_rule SET vigente_hasta = NULL WHERE id = $1', [reglaV1]),
        ),
      SQLSTATE.VIGENCIA_INMUTABLE,
      'reabrir una vigencia cerrada',
    );
  });

  it('insertar una vigencia que se solapa con otra falla con PR002', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO tax_rule (tenant_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                                   account_id, vigente_desde, norma_respaldo)
             VALUES ($1, $2, 'retefuente', 0.080000, 4.0000, $3, '2026-03-01',
                     'Valor ficticio de prueba — vigencia solapada')`,
            [e.tenantId, taxConceptId, e.cuentas.retefuentePorPagar],
          ),
        ),
      SQLSTATE.VIGENCIA_SOLAPADA,
      'el INSERT de una vigencia solapada',
    );
  });

  it('borrar una vigencia que ya surtió efecto falla con PR003', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query('DELETE FROM tax_rule WHERE id = $1', [reglaV1]),
        ),
      SQLSTATE.VIGENCIA_NO_BORRABLE,
      'el DELETE de una vigencia ya surtida',
    );
  });

  it('la retención registrada amarra la regla Y su vigencia: no se puede mentir sobre cuál se usó', async () => {
    // La FK compuesta (tax_rule_id, regla_vigente_desde) obliga a que la
    // vigencia declarada sea la real de esa regla.
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO retention_applied (tenant_id, company_id, source_document_id, tipo,
                                            base, tarifa, valor, tax_rule_id, regla_vigente_desde,
                                            norma_respaldo, account_id, fecha_hecho_economico)
             VALUES ($1, $2, $3, 'retefuente', 100000000, 0.040000, 4000000, $4, '2019-01-01',
                     'inventada', $5, '2025-06-15')`,
            [e.tenantId, e.companyId, e.sourceDocumentId, reglaV1, e.cuentas.retefuentePorPagar],
          ),
        ),
      SQLSTATE.FOREIGN_KEY_VIOLATION,
      'el INSERT de una retención con una vigencia que la regla nunca tuvo',
    );
  });

  it('la retención no puede declarar una vigencia que no cubre la fecha del hecho (CHECK)', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO retention_applied (tenant_id, company_id, source_document_id, tipo,
                                            base, tarifa, valor, tax_rule_id, regla_vigente_desde,
                                            regla_vigente_hasta, norma_respaldo, account_id,
                                            fecha_hecho_economico)
             VALUES ($1, $2, $3, 'retefuente', 100000000, 0.040000, 4000000, $4, '2025-01-01',
                     '2025-12-31', 'prueba', $5, '2026-06-15')`,
            [e.tenantId, e.companyId, e.sourceDocumentId, reglaV1, e.cuentas.retefuentePorPagar],
          ),
        ),
      SQLSTATE.CHECK_VIOLATION,
      'el INSERT de una retención cuya vigencia no cubre la fecha del hecho',
    );
  });

  it('una retención bien formada sí entra (control)', async () => {
    const id = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO retention_applied (tenant_id, company_id, source_document_id, tipo,
                                        base, tarifa, valor, tax_rule_id, regla_vigente_desde,
                                        regla_vigente_hasta, norma_respaldo, account_id,
                                        fecha_hecho_economico)
         VALUES ($1, $2, $3, 'retefuente', 100000000, 0.040000, 4000000, $4, '2025-01-01',
                 '2025-12-31', 'Valor ficticio de prueba', $5, '2025-06-15')
         RETURNING id`,
        [e.tenantId, e.companyId, e.sourceDocumentId, reglaV1, e.cuentas.retefuentePorPagar],
      );
      return rows[0]!.id;
    });
    expect(id).toBeTruthy();
  });
});

// =============================================================================
describe('Compuerta 0 — audit_log operativo y append-only', () => {
  it('editar un parámetro deja rastro con valor anterior y valor nuevo', async () => {
    const e = await crearEscenario(db);
    const conceptoId = uuid();
    const reglaId = uuid();

    await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        await tx.query(
          `INSERT INTO tax_concept (id, tenant_id, tipo, codigo, nombre)
           VALUES ($1, $2, 'reteica', 'auditoria_prueba', 'Concepto auditado')`,
          [conceptoId, e.tenantId],
        );
        await tx.query(
          `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, vigente_desde, norma_respaldo)
           VALUES ($1, $2, $3, 'reteica', 0.002000, '2026-01-01', 'Acuerdo municipal ficticio de prueba')`,
          [reglaId, e.tenantId, conceptoId],
        );
        await tx.query('UPDATE tax_rule SET vigente_hasta = $2 WHERE id = $1', [
          reglaId,
          '2026-06-30',
        ]);
      },
      { userId: e.userId, ip: '198.51.100.7', userAgent: 'vitest', requestId: 'req-auditoria' },
    );

    const registros = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        entidad: string;
        user_id: string | null;
        ip: string | null;
        request_id: string | null;
        valor_anterior: Record<string, unknown> | null;
        valor_nuevo: Record<string, unknown> | null;
        norma_respaldo: string | null;
      }>(
        `SELECT accion, entidad, user_id, host(ip) AS ip, request_id,
                valor_anterior, valor_nuevo, norma_respaldo
           FROM audit_log
          WHERE entidad = 'tax_rule' AND entidad_id = $1
          ORDER BY id`,
        [reglaId],
      );
      return rows;
    });

    expect(registros.map((r) => r.accion)).toEqual(['INSERT', 'UPDATE']);
    expect(registros[0]!.user_id).toBe(e.userId);
    expect(registros[0]!.ip).toBe('198.51.100.7');
    expect(registros[0]!.request_id).toBe('req-auditoria');
    expect(registros[0]!.norma_respaldo).toContain('Acuerdo municipal ficticio');
    expect(registros[1]!.valor_anterior?.['vigente_hasta']).toBeNull();
    expect(registros[1]!.valor_nuevo?.['vigente_hasta']).toBe('2026-06-30');
  });

  it('el audit_log no admite UPDATE ni DELETE, ni siquiera del superusuario', async () => {
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query("UPDATE audit_log SET accion = 'INSERT' WHERE id > 0")),
      SQLSTATE.AUDITORIA_INMUTABLE,
      'el UPDATE sobre audit_log',
    );
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM audit_log WHERE id > 0')),
      SQLSTATE.AUDITORIA_INMUTABLE,
      'el DELETE sobre audit_log',
    );
  });
});

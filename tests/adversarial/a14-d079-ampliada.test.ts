/**
 * A14 · Compuerta AMPLIADA de la Fase 2 de la bandeja (D-079).
 *
 * A14 no confirma nada por reporte. Esta suite es de A14, no de A7: ataca lo
 * que la compuerta entregada NO intentó.
 *
 *  1. Permiso: un rol sin `causacion.editar_borrador` no edita un borrador.
 *  2. Aislamiento: la sesión de otra firma no ve ni edita el asiento ajeno,
 *     ni archiva/reintegra su documento (Regla de Oro 7).
 *  3. Cuenta DESACTIVADA (`activo = false`, el mecanismo con el que una
 *     empresa esconde una cuenta genérica, D-064): el selector no la ofrece;
 *     el servicio tampoco debe aceptarla.
 *  4. Carrera edición ↔ aprobación: editar un borrador NO puede acabar
 *     mutando un asiento que entretanto quedó publicado (Regla de Oro 1).
 *  5. Fidelidad del rastro: usuario, ip, request_id, antes, después y
 *     justificación en `audit_log`.
 *  6. `archivado` es terminal para las dos transiciones (no se reintegra ni
 *     se re-archiva) y el documento archivado sale de TODAS las vistas.
 *  7. Filtros de la bandeja: unidades del monto y fecha inválida.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearAsientoBorrador, crearEscenario, partidasEquilibradas, type Escenario } from '../helpers/fixtures';
import { editarAsientoBorrador, procesarJobCausacion } from '../../src/services/causacion';
import { encolarCausacion } from '../../src/services/cola';
import {
  archivarDocumentoRechazado,
  listarRechazadas,
  reintegrarDocumentoRechazado,
} from '../../src/services/bandeja';
import { listarPendientesDeAprobacion } from '../../src/services/consulta';
import { normalizarFiltros } from '../../app/lib/bandeja';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

async function conBorrador(): Promise<{ e: Escenario; entryId: string; lineas: string[] }> {
  const e = await crearEscenario(db);
  const entryId = await db.asAdmin((tx) => crearAsientoBorrador(tx, e, partidasEquilibradas(e, 100_000_00)));
  const lineas = await db.asAdmin((tx) =>
    tx
      .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
      .then((r) => r.rows.map((x) => x.id)),
  );
  return { e, entryId, lineas };
}

function edicionCuadrada(lineas: string[], cuenta: string, montoCentavos = '10000000') {
  return [
    { journalLineId: lineas[0]!, cuentaCodigo: cuenta, montoCentavos },
    { journalLineId: lineas[1]!, cuentaCodigo: '220505', montoCentavos },
  ];
}

describe('A14 · D-079 — permisos y aislamiento de la edición de borrador', () => {
  it('un rol SIN causacion.editar_borrador (solo_lectura) no puede editar', async () => {
    const { e, entryId, lineas } = await conBorrador();
    // Usuario DISTINTO del contador del escenario: los permisos son la unión
    // de los roles del usuario en la empresa, así que reusar el mismo usuario
    // probaría de menos.
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: edicionCuadrada(lineas, '240805'),
            justificacion: 'un solo lectura no debería poder',
          }),
        { rolCodigo: 'solo_lectura', sesionNueva: true },
      ),
    ).rejects.toThrow(/permiso|PERMISO/i);
  });

  it('la sesión de OTRA firma no puede editar el asiento (RLS: no existe)', async () => {
    const { entryId, lineas } = await conBorrador();
    const otra = await crearEscenario(db);
    await expect(
      db.asTenant(
        otra.tenantId,
        otra.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: edicionCuadrada(lineas, '240805'),
            justificacion: 'intento cross-tenant',
          }),
        { userId: otra.userId },
      ),
    ).rejects.toThrow(/no existe/i);
  });

  it('la sesión de otra firma no archiva ni reintegra el documento ajeno', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'rechazada en aprobación' WHERE id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    const otra = await crearEscenario(db);

    await expect(
      db.asTenant(
        otra.tenantId,
        otra.companyId,
        (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'no es mío'),
        { userId: otra.userId },
      ),
    ).rejects.toThrow(/DOCUMENTO_INEXISTENTE/);

    await expect(
      db.asTenant(otra.tenantId, otra.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), {
        userId: otra.userId,
      }),
    ).rejects.toThrow(/DOCUMENTO_INEXISTENTE/);

    const estado = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId])
        .then((r) => r.rows[0]!.estado),
    );
    expect(estado).toBe('rechazado');
  });
});

describe('A14 · D-079 — cuenta desactivada', () => {
  it('una cuenta imputable pero DESACTIVADA no se puede imputar desde la edición', async () => {
    const { e, entryId, lineas } = await conBorrador();
    await db.asAdmin((tx) =>
      tx.query(`UPDATE account SET activo = false WHERE tenant_id = $1 AND codigo = '240805'`, [e.tenantId]),
    );

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: edicionCuadrada(lineas, '240805'),
            justificacion: 'la cuenta está desactivada en esta empresa',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/desactivada|inactiva|no existe/i);
  });
});

describe('A14 · D-079 — una partida de retención no se edita a mano', () => {
  it('cambiar el monto de una línea con retention_applied_id se rechaza (Reglas de Oro 4 y 6)', async () => {
    const e = await crearEscenario(db);
    const retencionId = uuid();
    const conceptoId = uuid();
    const reglaId = uuid();
    // Tarifa y norma FICTICIAS de A14: aquí no se prueba ningún valor
    // tributario, solo el amarre entre `journal_line` y `retention_applied`.
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, tipo, codigo, nombre)
         VALUES ($1, $2, 'retefuente', 'a14_d079', 'Concepto sonda de A14')`,
        [conceptoId, e.tenantId],
      );
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, account_id,
                               vigente_desde, norma_respaldo)
         VALUES ($1, $2, $3, 'retefuente', $4, $5, '2026-01-01',
                 'Valor ficticio de A14 — no es dato normativo')`,
        [reglaId, e.tenantId, conceptoId, 0.04, e.cuentas.retefuentePorPagar],
      );
    });
    const entryId = await db.asAdmin(async (tx) => {
      const id = await crearAsientoBorrador(tx, e, [
        { accountId: e.cuentas.gasto, side: 'debito', monto: 100_000_00, thirdPartyId: e.thirdPartyId },
        { accountId: e.cuentas.proveedores, side: 'credito', monto: 96_000_00, thirdPartyId: e.thirdPartyId },
        { accountId: e.cuentas.retefuentePorPagar, side: 'credito', monto: 4_000_00, thirdPartyId: e.thirdPartyId },
      ]);
      // Rastro del motor: la tercera partida LLEVA la retención calculada.
      await tx.query(
        `INSERT INTO retention_applied
           (id, tenant_id, company_id, source_document_id, journal_entry_id, third_party_id, tipo,
            base, tarifa, valor, tax_rule_id, regla_vigente_desde, norma_respaldo, account_id,
            fecha_hecho_economico)
         VALUES ($1, $2, $3, $4, $5, $6, 'retefuente', 10000000, 0.04, 400000, $7, '2026-01-01',
                 'norma de prueba', $8, '2026-06-15')`,
        [
          retencionId,
          e.tenantId,
          e.companyId,
          e.sourceDocumentId,
          id,
          e.thirdPartyId,
          reglaId,
          e.cuentas.retefuentePorPagar,
        ],
      );
      await tx.query(
        `UPDATE journal_line SET retention_applied_id = $2 WHERE journal_entry_id = $1 AND linea = 3`,
        [id, retencionId],
      );
      return id;
    });

    const lineas = await db.asAdmin((tx) =>
      tx
        .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
        .then((r) => r.rows.map((x) => x.id)),
    );

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: [
              { journalLineId: lineas[0]!, cuentaCodigo: '513595', montoCentavos: '10000000' },
              { journalLineId: lineas[1]!, cuentaCodigo: '220505', montoCentavos: '9700000' },
              // "le bajo la retefuente a 300.000 y que cuadre"
              { journalLineId: lineas[2]!, cuentaCodigo: '236540', montoCentavos: '300000' },
            ],
            justificacion: 'el proveedor dice que no le retenga tanto',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/retenci[óo]n calculada por el motor/i);

    // Y el ledger sigue coincidiendo con `retention_applied`.
    const monto = await db.asAdmin((tx) =>
      tx
        .query<{ monto: string }>(`SELECT monto::text FROM journal_line WHERE id = $1`, [lineas[2]!])
        .then((r) => r.rows[0]!.monto),
    );
    expect(monto).toBe('400000');
  });

  it('las partidas NO retenidas del mismo asiento sí se pueden editar', async () => {
    const { e, entryId, lineas } = await conBorrador();
    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarAsientoBorrador(tx, {
          journalEntryId: entryId,
          lineas: edicionCuadrada(lineas, '240805', '9000000'),
          justificacion: 'reclasificación del gasto y ajuste del bruto',
        }),
      { userId: e.userId },
    );
    expect(r.lineasCambiadas).toBe(2);
  });
});

describe('A14 · D-079 — carrera edición ↔ publicación', () => {
  it('si el asiento queda publicado antes de guardar, la edición NO lo muta', async () => {
    const { e, entryId, lineas } = await conBorrador();

    // Simula la ventana: el servicio ya leyó 'draft' y otra transacción publica.
    // Con el bloqueo de fila el caso es imposible; sin él, la línea cambiaría
    // bajo un asiento ya publicado. Aquí se comprueba el resultado observable.
    await db.asAdmin((tx) => tx.query(`SELECT app.publicar_asiento($1, $2)`, [entryId, e.userId]));

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: edicionCuadrada(lineas, '240805', '5000000'),
            justificacion: 'no debería tocar un publicado',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/borrador|publicad/i);

    const montos = await db.asAdmin((tx) =>
      tx
        .query<{ monto: string }>(`SELECT monto::text FROM journal_line WHERE journal_entry_id = $1`, [entryId])
        .then((r) => r.rows.map((x) => x.monto)),
    );
    expect(montos).toEqual(['10000000', '10000000']);
  });

  it('la lectura de estado del asiento se hace con bloqueo de fila (FOR UPDATE)', async () => {
    // Defensa contra la carrera: la edición y `aprobarAsiento` compiten por la
    // MISMA fila de `journal_entry`. Sin `FOR UPDATE`, dos transacciones
    // concurrentes pueden dejar una partida modificada bajo un asiento ya
    // publicado sin que ningún trigger se entere (el balance sigue cuadrando).
    const fuente = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/services/causacion.ts', import.meta.url), 'utf8'),
    );
    const bloque = fuente.slice(fuente.indexOf('export async function editarAsientoBorrador'));
    expect(bloque).toMatch(/FROM journal_entry WHERE id = \$1\s+FOR UPDATE/);
  });
});

describe('A14 · D-079 — fidelidad del rastro de auditoría', () => {
  it('el audit_log lleva quién, desde dónde, request_id, antes, después y justificación', async () => {
    const { e, entryId, lineas } = await conBorrador();
    const requestId = uuid();

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarAsientoBorrador(tx, {
          journalEntryId: entryId,
          lineas: edicionCuadrada(lineas, '240805', '12345600'),
          justificacion: 'Reclasificación a IVA descontable por el objeto del contrato.',
        }),
      { userId: e.userId, ip: '203.0.113.9', userAgent: 'A14/adversario', requestId },
    );

    const fila = await db.asAdmin((tx) =>
      tx
        .query<{
          user_id: string | null;
          company_id: string | null;
          tenant_id: string | null;
          ip: string | null;
          request_id: string | null;
          valor_anterior: unknown;
          valor_nuevo: unknown;
        }>(
          `SELECT user_id, company_id, tenant_id, ip::text AS ip, request_id::text AS request_id,
                  valor_anterior, valor_nuevo
             FROM audit_log
            WHERE entidad = 'journal_entry' AND entidad_id = $1 AND accion = 'UPDATE'
            ORDER BY id DESC LIMIT 1`,
          [entryId],
        )
        .then((r) => r.rows[0]),
    );
    expect(fila).toBeTruthy();
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    const antes = j(fila!.valor_anterior) as { cuenta: string; montoCentavos: string }[];
    const nuevo = j(fila!.valor_nuevo) as {
      lineas: { cuenta: string; montoCentavos: string }[];
      justificacion: string;
    };

    expect(fila!.user_id).toBe(e.userId);
    expect(fila!.tenant_id).toBe(e.tenantId);
    expect(fila!.company_id).toBe(e.companyId);
    expect(fila!.ip).toMatch(/^203\.0\.113\.9(\/32)?$/);
    expect(fila!.request_id).toBe(requestId);
    expect(antes.map((l) => l.montoCentavos)).toEqual(['10000000', '10000000']);
    expect(nuevo.lineas.map((l) => l.montoCentavos)).toEqual(['12345600', '12345600']);
    expect(nuevo.lineas[0]!.cuenta).toBe('240805');
    expect(nuevo.justificacion).toMatch(/Reclasificación/);
  });
});

describe('A14 · D-079 — el estado archivado es terminal y sale de todas las vistas', () => {
  it('un documento archivado no se reintegra ni se vuelve a archivar, y no aparece en la bandeja', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'rechazada en aprobación' WHERE id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'duplicado del proveedor'),
      { userId: e.userId },
    );

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), {
        userId: e.userId,
      }),
    ).rejects.toThrow(/ESTADO_INVALIDO/);

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'otra vez'), {
        userId: e.userId,
      }),
    ).rejects.toThrow(/ESTADO_INVALIDO/);

    const [rechazadas, pendientes] = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => [await listarRechazadas(tx), await listarPendientesDeAprobacion(tx)] as const,
      { userId: e.userId },
    );
    expect(rechazadas.find((d) => d.sourceDocumentId === e.sourceDocumentId)).toBeUndefined();
    expect(pendientes.find((d) => d.sourceDocumentId === e.sourceDocumentId)).toBeUndefined();
  });

  it('archivar sin motivo se rechaza (Regla de Oro 6)', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'rechazada en aprobación' WHERE id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, '   '), {
        userId: e.userId,
      }),
    ).rejects.toThrow(/MOTIVO_OBLIGATORIO/);
  });
});

describe('A14 · D-079 — la salida que el bloqueo de reproceso le ofrece al contador', () => {
  it('volver a cargar el documento NO recausa una rechazada: la ingesta converge en la MISMA fila y el motor la da por procesada', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin(async (tx) => {
      await crearAsientoBorrador(tx, e, partidasEquilibradas(e), {
        idempotencyKey: `causacion:${e.sourceDocumentId}`,
      });
      await tx.query(
        `UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'rechazada por error del revisor' WHERE id = $1`,
        [e.sourceDocumentId],
      );
    });

    // La ingesta deduplica por (empresa, CUFE) y por (empresa, hash): volver a
    // subir el mismo XML NO crea una fila nueva, reencola el trabajo de LA
    // MISMA. Esto es lo que pasa después:
    const resultado = await db.asAdmin(async (tx) => {
      const job = await encolarCausacion(tx, e.sourceDocumentId);
      return procesarJobCausacion(tx, job);
    });

    expect(resultado.estado).toBe('ya_procesado');

    const estado = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId])
        .then((r) => r.rows[0]!.estado),
    );
    // Sigue rechazada. El consejo "vuelva a cargarla desde la carga masiva" NO
    // la recupera: es un callejón sin salida documentado en ESTADO_PROYECTO.md.
    expect(estado).toBe('rechazado');
  });
});

describe('A14 · D-079 — los filtros no pueden ocultar lo que sí hay que aprobar', () => {
  it('el monto del formulario está en PESOS y el documento en CENTAVOS: la conversión se hace', () => {
    // El campo dice "Monto mín. (pesos)". Si el valor entra crudo como
    // centavos, un filtro "hasta $1.000.000" esconde todo lo que pase de
    // $10.000 — es decir, esconde facturas que sí hay que aprobar.
    const f = normalizarFiltros({ montoMin: '1000', montoMax: '1000000' });
    expect(f.montoMinCentavos).toBe(100_000);
    expect(f.montoMaxCentavos).toBe(100_000_000);
  });

  it('una fecha inválida en la URL no rompe la bandeja entera', async () => {
    const e = await crearEscenario(db);
    const f = normalizarFiltros({ desde: 'no-es-fecha', hasta: '2026-13-45' });
    expect(f.desde).toBeUndefined();
    expect(f.hasta).toBeUndefined();

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => listarPendientesDeAprobacion(tx, { desde: f.desde ?? null, hasta: f.hasta ?? null }),
        { userId: e.userId },
      ),
    ).resolves.toBeInstanceOf(Array);
  });
});

/**
 * A14 · Compuerta de la Fase 2 de la bandeja (D-079).
 *
 * QUÉ INTENTA ROMPER:
 *  1. Guardar un asiento borrador DESCUADRADO saltándose la interfaz —
 *     llamando directo al servicio. Debe rechazarlo igual (el trigger de
 *     publicación es el respaldo final, pero el servicio no puede dejarlo
 *     pasar). Es la prueba que el encargo de D-079 pide explícita.
 *  2. Editar una línea sin justificación. Regla de Oro 6.
 *  3. Editar un asiento ya publicado. Regla de Oro 1.
 *  4. Reintegrar a la cola una rechazada que YA dejó un asiento en conflicto
 *     de idempotencia: debe BLOQUEAR con un mensaje claro, no fallar oscuro.
 *  5. Archivar un documento que no está rechazado.
 *  6. Que archivar NO borre la fila (append-only) y sí la saque de las vistas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearAsientoBorrador, crearEscenario, partidasEquilibradas, type Escenario } from '../helpers/fixtures';
import { editarAsientoBorrador } from '../../src/services/causacion';
import {
  archivarDocumentoRechazado,
  listarRechazadas,
  reintegrarDocumentoRechazado,
} from '../../src/services/bandeja';
import { obtenerDocumentoOriginal } from '../../src/services/consulta';
import { formatearXml } from '../../app/bandeja/documento/[sourceDocumentId]/formato';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

async function conBorrador(): Promise<{ e: Escenario; entryId: string }> {
  const e = await crearEscenario(db);
  const entryId = await db.asAdmin((tx) =>
    crearAsientoBorrador(tx, e, partidasEquilibradas(e, 100_000_00)),
  );
  return { e, entryId };
}

/** Cambia el estado del documento sin pasar por la app (montaje del escenario). */
async function forzarEstadoDocumento(e: Escenario, estado: string, motivo?: string): Promise<void> {
  await db.asAdmin((tx) =>
    tx.query(`UPDATE source_document SET estado = $2, motivo_rechazo = $3 WHERE id = $1`, [
      e.sourceDocumentId,
      estado,
      motivo ?? null,
    ]),
  );
}

describe('A14 · D-079 — edición de línea del asiento borrador', () => {
  it('el servicio RECHAZA un borrador descuadrado aunque se le llame directo (sin la interfaz)', async () => {
    const { e, entryId } = await conBorrador();
    const lineas = await db.asAdmin((tx) =>
      tx
        .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
        .then((r) => r.rows),
    );

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            // débito 100.000, crédito 90.000 -> descuadre de 10.000
            lineas: [
              { journalLineId: lineas[0]!.id, cuentaCodigo: '513595', montoCentavos: '10000000' },
              { journalLineId: lineas[1]!.id, cuentaCodigo: '220505', montoCentavos: '9000000' },
            ],
            justificacion: 'intento de guardar descuadrado',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/descuadr/i);

    // Y la BD sigue con el asiento original intacto.
    const montos = await db.asAdmin((tx) =>
      tx
        .query<{ monto: string }>(`SELECT monto::text FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [
          entryId,
        ])
        .then((r) => r.rows.map((x) => x.monto)),
    );
    expect(montos).toEqual(['10000000', '10000000']);
  });

  it('un cambio de cuenta SIN justificación se rechaza (Regla de Oro 6)', async () => {
    const { e, entryId } = await conBorrador();
    const lineas = await db.asAdmin((tx) =>
      tx
        .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
        .then((r) => r.rows),
    );
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: [
              { journalLineId: lineas[0]!.id, cuentaCodigo: '240805', montoCentavos: '10000000' },
              { journalLineId: lineas[1]!.id, cuentaCodigo: '220505', montoCentavos: '10000000' },
            ],
            justificacion: '   ',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/justificaci/i);
  });

  it('una cuenta NO imputable (clase "5") se rechaza', async () => {
    const { e, entryId } = await conBorrador();
    const lineas = await db.asAdmin((tx) =>
      tx
        .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
        .then((r) => r.rows),
    );
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: [
              { journalLineId: lineas[0]!.id, cuentaCodigo: '5', montoCentavos: '10000000' },
              { journalLineId: lineas[1]!.id, cuentaCodigo: '220505', montoCentavos: '10000000' },
            ],
            justificacion: 'probando cuenta no imputable',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/imputable/i);
  });

  it('un cambio válido y cuadrado se guarda y deja el antes/después + justificación en audit_log', async () => {
    const { e, entryId } = await conBorrador();
    const lineas = await db.asAdmin((tx) =>
      tx
        .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
        .then((r) => r.rows),
    );

    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarAsientoBorrador(tx, {
          journalEntryId: entryId,
          lineas: [
            { journalLineId: lineas[0]!.id, cuentaCodigo: '240805', montoCentavos: '12000000' },
            { journalLineId: lineas[1]!.id, cuentaCodigo: '220505', montoCentavos: '12000000' },
          ],
          justificacion: 'La factura corresponde a IVA descontable, no a gasto; monto ajustado al valor real.',
        }),
      { userId: e.userId },
    );
    expect(r.lineasCambiadas).toBe(2);

    const audit = await db.asAdmin((tx) =>
      tx
        .query<{ valor_anterior: unknown; valor_nuevo: unknown }>(
          `SELECT valor_anterior, valor_nuevo FROM audit_log
            WHERE entidad = 'journal_entry' AND entidad_id = $1 AND accion = 'UPDATE'
            ORDER BY ocurrido_en DESC LIMIT 1`,
          [entryId],
        )
        .then((x) => x.rows[0]),
    );
    expect(audit).toBeTruthy();
    const nuevo = typeof audit!.valor_nuevo === 'string' ? JSON.parse(audit!.valor_nuevo) : audit!.valor_nuevo;
    expect(nuevo.justificacion).toMatch(/IVA descontable/);
    expect(Array.isArray(nuevo.lineas)).toBe(true);
  });

  it('editar un asiento PUBLICADO se rechaza (Regla de Oro 1)', async () => {
    const { e, entryId } = await conBorrador();
    await db.asAdmin((tx) => tx.query(`SELECT app.publicar_asiento($1, $2)`, [entryId, e.userId]));
    const lineas = await db.asAdmin((tx) =>
      tx
        .query<{ id: string }>(`SELECT id FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`, [entryId])
        .then((r) => r.rows),
    );
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarAsientoBorrador(tx, {
            journalEntryId: entryId,
            lineas: [
              { journalLineId: lineas[0]!.id, cuentaCodigo: '240805', montoCentavos: '10000000' },
              { journalLineId: lineas[1]!.id, cuentaCodigo: '220505', montoCentavos: '10000000' },
            ],
            justificacion: 'no debería poder',
          }),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/borrador|publicad/i);
  });
});

describe('A14 · D-079 — sub-bandeja de rechazadas', () => {
  it('reintegrar una rechazada cuyo asiento en conflicto NO está anulado se BLOQUEA (V-23: el resguardo se mantiene)', async () => {
    const e = await crearEscenario(db);
    // Estado ANÓMALO a propósito: un asiento de causación VIVO (draft, sin
    // anular) mientras el documento figura 'rechazado'. El resguardo
    // REPROCESO_BLOQUEADO de V-23 no se relaja para este caso.
    await db.asAdmin(async (tx) => {
      await crearAsientoBorrador(tx, e, partidasEquilibradas(e), {
        idempotencyKey: `causacion:${e.sourceDocumentId}`,
      });
    });
    await forzarEstadoDocumento(e, 'rechazado', 'rechazada en aprobación');

    const rechazadas = await db.asTenant(e.tenantId, e.companyId, (tx) => listarRechazadas(tx), {
      userId: e.userId,
    });
    const fila = rechazadas.find((d) => d.sourceDocumentId === e.sourceDocumentId)!;
    expect(fila.puedeReprocesar).toBe(false);
    expect(fila.motivoBloqueoReproceso).toMatch(/no está anulado|anómalo/i);

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), {
        userId: e.userId,
      }),
    ).rejects.toThrow(/REPROCESO_BLOQUEADO/);

    // El documento sigue rechazado; nada se movió.
    const estado = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId])
        .then((r) => r.rows[0]!.estado),
    );
    expect(estado).toBe('rechazado');
  });

  it('archivar un documento que NO está rechazado se rechaza', async () => {
    const e = await crearEscenario(db); // nace 'aprobado'
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'motivo cualquiera'),
        { userId: e.userId },
      ),
    ).rejects.toThrow(/ESTADO_INVALIDO/);
  });

  it('archivar NO borra la fila (append-only) y la saca de listarRechazadas', async () => {
    const e = await crearEscenario(db);
    await forzarEstadoDocumento(e, 'rechazado', 'rechazada');

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'proveedor duplicado, ya causado por otra vía'),
      { userId: e.userId },
    );

    const fila = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string; motivo_rechazo: string | null }>(
          `SELECT estado, motivo_rechazo FROM source_document WHERE id = $1`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows[0]),
    );
    expect(fila).toBeTruthy();
    expect(fila!.estado).toBe('archivado');
    expect(fila!.motivo_rechazo).toMatch(/archivado:/);

    const rechazadas = await db.asTenant(e.tenantId, e.companyId, (tx) => listarRechazadas(tx), {
      userId: e.userId,
    });
    expect(rechazadas.find((d) => d.sourceDocumentId === e.sourceDocumentId)).toBeUndefined();

    const audit = await db.asAdmin((tx) =>
      tx
        .query(
          `SELECT 1 FROM audit_log WHERE entidad = 'source_document' AND entidad_id = $1
             AND valor_nuevo ->> 'estado' = 'archivado'`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows.length),
    );
    expect(audit).toBe(1);
  });
});

describe('A14 · D-079 — visor del documento original', () => {
  it('obtenerDocumentoOriginal devuelve el xml_crudo y formatearXml lo indenta', async () => {
    const e = await crearEscenario(db);
    const xml = '<Invoice><cbc:ID>FE-1</cbc:ID><cbc:IssueDate>2026-06-15</cbc:IssueDate></Invoice>';
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET xml_crudo = $2 WHERE id = $1`, [e.sourceDocumentId, xml]),
    );

    const doc = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerDocumentoOriginal(tx, e.sourceDocumentId), {
      userId: e.userId,
    });
    expect(doc?.xmlCrudo).toBe(xml);

    const formateado = formatearXml(xml);
    expect(formateado.split('\n').length).toBeGreaterThan(1);
    expect(formateado).toMatch(/^ {2}<cbc:ID>FE-1<\/cbc:ID>$/m);
  });

  it('un documento inexistente / no visible devuelve null', async () => {
    const e = await crearEscenario(db);
    const doc = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerDocumentoOriginal(tx, uuid()), {
      userId: e.userId,
    });
    expect(doc).toBeNull();
  });
});

/**
 * A6 — Cola asíncrona (entregable 1): idempotencia, SKIP LOCKED, backoff,
 * cola de fallidos y visibilidad de estado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db.js';
import { crearEscenario, type Escenario } from '../helpers/fixtures.js';
import {
  calcularBackoffSegundos,
  completarJob,
  encolarCausacion,
  estadoJobDeDocumento,
  fallarJob,
  reclamarSiguienteJob,
  reencolarJob,
} from '../../src/services/cola.js';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
});

afterAll(async () => {
  await db?.close();
});

/**
 * `reclamar_siguiente_job` ve la cola de TODAS las firmas a propósito (es la
 * razón de ser del contexto de administración): un trabajo pendiente que
 * dejó otra prueba de este mismo archivo compite por el turno. Para que las
 * pruebas de exclusividad/orden sean deterministas, se drena la cola antes de
 * sembrar exactamente los trabajos que cada prueba necesita.
 */
async function drenarPendientes(): Promise<void> {
  for (;;) {
    const job = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'drenaje-de-prueba'));
    if (!job) return;
    await db.asAdmin((tx) => completarJob(tx, job.id, { drenado: true }));
  }
}

describe('encolarCausacion — idempotente por construcción (D-003)', () => {
  it('encolar el mismo documento dos veces devuelve el MISMO trabajo, no dos', async () => {
    const primero = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      encolarCausacion(tx, e.sourceDocumentId),
    );
    const segundo = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      encolarCausacion(tx, e.sourceDocumentId),
    );
    expect(segundo.id).toBe(primero.id);
    expect(segundo.intentos).toBe(primero.intentos); // encolar no reintenta ni reinicia nada.

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM document_processing_job WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      ),
    );
    expect(rows[0]?.total).toBe('1');
  });

  it('el trabajo recién encolado está pendiente y visible por RLS solo para su propia empresa', async () => {
    const job = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      estadoJobDeDocumento(tx, e.sourceDocumentId),
    );
    expect(job).toMatchObject({ estado: 'pendiente', sourceDocumentId: e.sourceDocumentId, intentos: 0 });

    const otra = await crearEscenario(db);
    const invisibleParaOtro = await db.asTenant(otra.tenantId, otra.companyId, (tx) =>
      estadoJobDeDocumento(tx, e.sourceDocumentId),
    );
    expect(invisibleParaOtro).toBeNull();
  });
});

describe('reclamarSiguienteJob — FOR UPDATE SKIP LOCKED, una sentencia atómica', () => {
  it('reclama el trabajo pendiente: pasa a en_proceso, cuenta el intento y registra quién lo tomó, y ya no lo vuelve a dar', async () => {
    await drenarPendientes();
    const solo = await crearEscenario(db);
    await db.asTenant(solo.tenantId, solo.companyId, (tx) => encolarCausacion(tx, solo.sourceDocumentId));

    const reclamado = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'worker-test-1'));
    expect(reclamado).toMatchObject({
      sourceDocumentId: solo.sourceDocumentId,
      estado: 'en_proceso',
      intentos: 1,
      tomadoPor: 'worker-test-1',
    });
    expect(reclamado!.tomadoEn).not.toBeNull();

    // Un segundo worker que reclama justo después no recibe el mismo trabajo.
    const nada = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'worker-test-2'));
    expect(nada).toBeNull();
  });

  it('dos documentos distintos, dos workers: cada uno reclama uno y nunca el mismo', async () => {
    await drenarPendientes();
    const e1 = await crearEscenario(db);
    const e2 = await crearEscenario(db);
    await db.asTenant(e1.tenantId, e1.companyId, (tx) => encolarCausacion(tx, e1.sourceDocumentId));
    await db.asTenant(e2.tenantId, e2.companyId, (tx) => encolarCausacion(tx, e2.sourceDocumentId));

    const j1 = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'worker-a'));
    const j2 = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'worker-b'));
    expect(j1).not.toBeNull();
    expect(j2).not.toBeNull();
    expect(j1!.id).not.toBe(j2!.id);
    expect(new Set([j1!.sourceDocumentId, j2!.sourceDocumentId])).toEqual(
      new Set([e1.sourceDocumentId, e2.sourceDocumentId]),
    );

    const j3 = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'worker-c'));
    expect(j3).toBeNull(); // nada más pendiente: los dos ya están en_proceso.
  });
});

describe('completarJob y fallarJob — éxito, reintento con backoff, y cola de fallidos', () => {
  it('completarJob deja el trabajo en estado completado con su resultado', async () => {
    await drenarPendientes();
    const esc = await crearEscenario(db);
    await db.asTenant(esc.tenantId, esc.companyId, (tx) => encolarCausacion(tx, esc.sourceDocumentId));
    const job = (await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w')))!;

    await db.asAdmin((tx) => completarJob(tx, job.id, { journalEntryId: uuid() }));

    const estado = await db.asTenant(esc.tenantId, esc.companyId, (tx) =>
      estadoJobDeDocumento(tx, esc.sourceDocumentId),
    );
    expect(estado?.estado).toBe('completado');
    expect(estado?.completadoEn).not.toBeNull();
    expect(estado?.resultado).toMatchObject({});
  });

  it('calcularBackoffSegundos crece exponencial y no pasa del tope de una hora', () => {
    expect(calcularBackoffSegundos(1)).toBe(30);
    expect(calcularBackoffSegundos(2)).toBe(60);
    expect(calcularBackoffSegundos(3)).toBe(120);
    expect(calcularBackoffSegundos(4)).toBe(240);
    expect(calcularBackoffSegundos(20)).toBe(3600);
  });

  it('un fallo con intentos por debajo del límite reintenta: vuelve a pendiente, NO se pierde, y no es reclamable de inmediato', async () => {
    await drenarPendientes();
    const esc = await crearEscenario(db);
    await db.asTenant(esc.tenantId, esc.companyId, (tx) => encolarCausacion(tx, esc.sourceDocumentId, { maxIntentos: 3 }));
    const job = (await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w')))!;
    expect(job.intentos).toBe(1);

    const fallado = await db.asAdmin((tx) => fallarJob(tx, job, new Error('fallo transitorio de prueba')));
    expect(fallado.estado).toBe('pendiente');
    expect(fallado.ultimoError).toContain('fallo transitorio de prueba');

    // No reclamable todavía: el backoff lo puso en el futuro.
    const nada = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w2'));
    expect(nada).toBeNull();

    // Simula que pasó el tiempo del backoff (sin dormir la prueba de verdad).
    await db.asAdmin((tx) =>
      tx.query(`UPDATE document_processing_job SET disponible_en = now() - interval '1 second' WHERE id = $1`, [
        job.id,
      ]),
    );
    const reclamadoDeNuevo = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w3'));
    expect(reclamadoDeNuevo).toMatchObject({ id: job.id, intentos: 2 });
  });

  it('agotar los intentos manda el trabajo a la cola de fallidos (agotado), no lo reintenta más', async () => {
    await drenarPendientes();
    const esc = await crearEscenario(db);
    await db.asTenant(esc.tenantId, esc.companyId, (tx) => encolarCausacion(tx, esc.sourceDocumentId, { maxIntentos: 1 }));
    const job = (await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w')))!;
    expect(job.maxIntentos).toBe(1);

    const fallado = await db.asAdmin((tx) => fallarJob(tx, job, new Error('fallo permanente de prueba')));
    expect(fallado.estado).toBe('agotado');

    // Ni con el backoff vencido a la fuerza vuelve a ser reclamable: agotado no es pendiente.
    await db.asAdmin((tx) =>
      tx.query(`UPDATE document_processing_job SET disponible_en = now() - interval '1 hour' WHERE id = $1`, [
        job.id,
      ]),
    );
    const nada = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w2'));
    expect(nada).toBeNull();
  });

  it('reencolarJob revive manualmente un trabajo agotado, en cero intentos', async () => {
    await drenarPendientes();
    const esc = await crearEscenario(db);
    await db.asTenant(esc.tenantId, esc.companyId, (tx) => encolarCausacion(tx, esc.sourceDocumentId, { maxIntentos: 1 }));
    const job = (await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w')))!;
    await db.asAdmin((tx) => fallarJob(tx, job, new Error('roto')));

    const revivido = await db.asTenant(esc.tenantId, esc.companyId, (tx) =>
      reencolarJob(tx, esc.sourceDocumentId),
    );
    expect(revivido).toMatchObject({ estado: 'pendiente', intentos: 0, ultimoError: null });

    const reclamado = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'w-final'));
    expect(reclamado?.id).toBe(job.id);
  });
});

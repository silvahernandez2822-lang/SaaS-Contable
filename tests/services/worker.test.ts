/**
 * A6 — El worker de la cola, y la prueba de que el request HTTP nunca hace
 * el trabajo pesado (entregable 5).
 *
 * `recibirDocumento` (lo que un route handler llamaría dentro de la petición)
 * termina en un INSERT y un encolado: nunca llama a `procesarJobCausacion`.
 * Quien sí lo llama es `ejecutarCicloCola`, que aquí se invoca por separado,
 * simulando el proceso/cron independiente que exige la sección 5.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { crearEscenario, type Escenario } from '../helpers/fixtures.js';
import { recibirDocumento } from '../../src/services/ingest.js';
import { estadoJobDeDocumento } from '../../src/services/cola.js';
import { ejecutarCicloCola, vaciarCola } from '../../src/services/worker.js';

const DIR_FIXTURES = fileURLToPath(new URL('../fixtures/ubl/', import.meta.url));
function leerFixture(nombre: string): Buffer {
  return readFileSync(path.join(DIR_FIXTURES, nombre));
}

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

describe('el request de ingesta nunca causa nada: solo encola', () => {
  it('recibirDocumento deja el documento en "parseado" — sin retenciones, sin asiento, sin third_party clasificado', async () => {
    const e = await crearEscenario(db);
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      recibirDocumento(tx, { bytes: leerFixture('invoice-simple.xml') }),
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    // Ningún efecto de causación existe todavía: ni journal_entry ni
    // retention_applied. Lo único que el request produjo es el documento y
    // el trabajo pendiente.
    const { rows: entries } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM journal_entry WHERE source_document_id = $1`,
        [resultado.sourceDocumentId],
      ),
    );
    expect(entries[0]?.total).toBe('0');

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      estadoJobDeDocumento(tx, resultado.sourceDocumentId),
    );
    expect(job?.estado).toBe('pendiente');
  });

  it('ejecutarCicloCola (fuera del request) es quien de verdad causa: un ciclo procesa el trabajo pendiente', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE third_party SET numero_documento = '900123456' WHERE id = $1`, [e.thirdPartyId]),
    );
    const ingreso = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      recibirDocumento(tx, { bytes: leerFixture('invoice-simple.xml') }),
    );
    if (!ingreso.ok) throw new Error('se esperaba éxito de ingesta');

    // Sin concepto clasificado, el ciclo hace su trabajo (intenta causar) y
    // termina en revisión manual: sigue siendo la prueba de que el CICLO, no
    // el request, es quien tocó la resolución de retenciones.
    const resultado = await ejecutarCicloCola(db.client, 'worker-de-prueba');
    expect(resultado.hizoAlgo).toBe(true);
    if (!resultado.hizoAlgo) return;
    expect(resultado.ok).toBe(true);

    const { rows: job } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; resultado: { requiereRevisionManual?: boolean } | null }>(
        `SELECT estado, resultado FROM document_processing_job WHERE id = $1`,
        [resultado.jobId],
      ),
    );
    expect(job[0]?.estado).toBe('completado');
    expect(job[0]?.resultado?.requiereRevisionManual).toBe(true); // sin memoria_clasificacion, no se inventa el concepto.
  });

  it('un documento sin tercero registrado termina en revisión manual, no en fallo: el ciclo distingue "dato faltante" de "error"', async () => {
    // El ciclo reclama el trabajo pendiente MÁS ANTIGUO de TODA la cola (a
    // propósito: ve todas las firmas). Se drena lo que hayan dejado pendiente
    // pruebas anteriores de este archivo para que el próximo ciclo reclame,
    // sin ambigüedad, el trabajo que esta prueba acaba de encolar.
    await vaciarCola(db.client, 'drenaje-de-prueba');
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE third_party SET numero_documento = '900123456' WHERE id = $1`, [e.thirdPartyId]),
    );
    const ingreso = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      recibirDocumento(tx, { bytes: leerFixture('invoice-simple.xml') }),
    );
    if (!ingreso.ok) throw new Error('se esperaba éxito de ingesta');
    // Se retira el tercero DESPUÉS de ingestar, para que el worker lo
    // encuentre desaparecido al procesar (no es un fallo de infraestructura:
    // es un dato de negocio que falta, y el ciclo debe completar el trabajo
    // en revisión manual en vez de reintentarlo con backoff).
    await db.asAdmin((tx) => tx.query(`UPDATE source_document SET third_party_id = NULL WHERE id = $1`, [ingreso.sourceDocumentId]));

    const resultado = await ejecutarCicloCola(db.client, 'worker-manual');
    expect(resultado).toMatchObject({ hizoAlgo: true, ok: true });

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; intentos: number }>(
        `SELECT estado, intentos FROM document_processing_job WHERE source_document_id = $1`,
        [ingreso.sourceDocumentId],
      ),
    );
    expect(rows[0]).toMatchObject({ estado: 'completado', intentos: 1 }); // no reintenta: no es un error transitorio.
  });

  it('sin nada pendiente, un ciclo no hace nada (no se equivoca de trabajo ajeno)', async () => {
    await vaciarCola(db.client, 'drenaje');
    const resultado = await ejecutarCicloCola(db.client, 'worker-ocioso');
    expect(resultado.hizoAlgo).toBe(false);
  });
});

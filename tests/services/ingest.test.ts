/**
 * A6 — Servicio de dominio: ingest de documento (entregable 2).
 *
 * Reutiliza el fixture real de A4 (`invoice-simple.xml`) y su
 * `procesarAdjuntoXml`/`guardarDocumentoProcesado`: esta suite prueba la capa
 * de A6 alrededor de esos dos puntos (permiso, vínculo con el tercero,
 * cuarentena de carga manual, y el encolado), no el parser en sí mismo.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import { recibirDocumento } from '../../src/services/ingest';
import { estadoJobDeDocumento } from '../../src/services/cola';

const DIR_FIXTURES = fileURLToPath(new URL('../fixtures/ubl/', import.meta.url));
function leerFixture(nombre: string): Buffer {
  return readFileSync(path.join(DIR_FIXTURES, nombre));
}

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
});

afterAll(async () => {
  await db?.close();
});

describe('recibirDocumento — camino feliz', () => {
  it('decodifica (A4), guarda el documento y encola su causación, sin resolver nada tributario', async () => {
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      recibirDocumento(tx, { bytes: leerFixture('invoice-simple.xml'), nombreArchivo: 'factura.xml' }),
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.duplicado).toBe(false);
    expect(resultado.job).toMatchObject({ estado: 'pendiente', sourceDocumentId: resultado.sourceDocumentId });

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; third_party_id: string | null; cufe: string }>(
        `SELECT estado, third_party_id, cufe FROM source_document WHERE id = $1`,
        [resultado.sourceDocumentId],
      ),
    );
    expect(rows[0]?.estado).toBe('parseado');
    // El emisor del fixture (NIT 900123456) no está registrado como tercero
    // de esta empresa (el escenario usa otro NIT): sin invento, queda NULL.
    expect(rows[0]?.third_party_id).toBeNull();
  });

  it('vincula el third_party cuando el NIT del emisor SÍ está registrado en la empresa', async () => {
    const escenarioConProveedor = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(
        `UPDATE third_party SET numero_documento = '900123456' WHERE id = $1`,
        [escenarioConProveedor.thirdPartyId],
      ),
    );

    const resultado = await db.asTenant(escenarioConProveedor.tenantId, escenarioConProveedor.companyId, (tx) =>
      recibirDocumento(tx, { bytes: leerFixture('invoice-simple.xml') }),
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ third_party_id: string }>(`SELECT third_party_id FROM source_document WHERE id = $1`, [
        resultado.sourceDocumentId,
      ]),
    );
    expect(rows[0]?.third_party_id).toBe(escenarioConProveedor.thirdPartyId);
  });

  it('exige el permiso documento.cargar: un rol sin ese permiso no llega ni a intentar el INSERT', async () => {
    const esc = await crearEscenario(db);
    await expect(
      db.asTenant(
        esc.tenantId,
        esc.companyId,
        (tx) => recibirDocumento(tx, { bytes: leerFixture('invoice-simple.xml') }),
        { rolCodigo: 'solo_lectura' },
      ),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(`SELECT count(*)::text AS total FROM source_document WHERE company_id = $1`, [
        esc.companyId,
      ]),
    );
    expect(rows[0]?.total).toBe('1'); // solo el que crearEscenario ya había insertado; nada nuevo.
  });
});

describe('recibirDocumento — idempotencia por CUFE (D-003, restricción de A4/A2)', () => {
  it('el mismo XML ingestado dos veces no crea un segundo source_document ni un segundo trabajo', async () => {
    const esc = await crearEscenario(db);
    const bytes = leerFixture('invoice-simple.xml');

    const primero = await db.asTenant(esc.tenantId, esc.companyId, (tx) => recibirDocumento(tx, { bytes }));
    const segundo = await db.asTenant(esc.tenantId, esc.companyId, (tx) => recibirDocumento(tx, { bytes }));

    expect(primero.ok).toBe(true);
    expect(segundo.ok).toBe(true);
    if (!primero.ok || !segundo.ok) return;
    expect(segundo.duplicado).toBe(true);
    expect(segundo.sourceDocumentId).toBe(primero.sourceDocumentId);

    const cufe = (
      await db.asAdmin((tx) =>
        tx.query<{ cufe: string }>(`SELECT cufe FROM source_document WHERE id = $1`, [primero.sourceDocumentId]),
      )
    ).rows[0]!.cufe;
    const { rows: porCufe } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM source_document WHERE company_id = $1 AND cufe = $2`,
        [esc.companyId, cufe],
      ),
    );
    expect(porCufe[0]?.total).toBe('1');

    const { rows: jobs } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM document_processing_job WHERE source_document_id = $1`,
        [primero.sourceDocumentId],
      ),
    );
    expect(jobs[0]?.total).toBe('1');
  });
});

describe('recibirDocumento — cuarentena (vía de carga manual)', () => {
  it('un XML mal formado no crea ningún trabajo de causación, y queda trazado con su motivo', async () => {
    const esc = await crearEscenario(db);
    const resultado = await db.asTenant(esc.tenantId, esc.companyId, (tx) =>
      recibirDocumento(tx, { bytes: leerFixture('roto-xml-mal-formado.xml') }),
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivoCuarentena).toBe('xml_mal_formado');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; motivo_rechazo: string | null }>(
        `SELECT estado, motivo_rechazo FROM source_document WHERE id = $1`,
        [resultado.sourceDocumentId],
      ),
    );
    expect(rows[0]?.estado).toBe('en_cuarentena');
    expect(rows[0]?.motivo_rechazo).toContain('xml_mal_formado');

    const job = await db.asTenant(esc.tenantId, esc.companyId, (tx) =>
      estadoJobDeDocumento(tx, resultado.sourceDocumentId),
    );
    expect(job).toBeNull(); // la cuarentena no encola causación: no hay nada que causar.
  });

  it('reenviar el mismo archivo roto no duplica la fila de cuarentena', async () => {
    const esc = await crearEscenario(db);
    const bytes = leerFixture('roto-sin-cufe.xml');

    const primero = await db.asTenant(esc.tenantId, esc.companyId, (tx) => recibirDocumento(tx, { bytes }));
    const segundo = await db.asTenant(esc.tenantId, esc.companyId, (tx) => recibirDocumento(tx, { bytes }));
    expect(primero.ok).toBe(false);
    expect(segundo.ok).toBe(false);
    if (primero.ok || segundo.ok) return;
    expect(segundo.duplicado).toBe(true);
    expect(segundo.sourceDocumentId).toBe(primero.sourceDocumentId);
  });
});

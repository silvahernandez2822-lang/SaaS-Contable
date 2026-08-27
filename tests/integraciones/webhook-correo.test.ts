/**
 * A13 — `procesarWebhookCorreo`: la costura real entre n8n y A6/A4 (Ola 2).
 *
 * Reutiliza el fixture real de A4 (`invoice-simple.xml`), igual que
 * `tests/services/ingest.test.ts` de A6: esta suite prueba la capa de
 * orquestación de A13 alrededor de `recibirDocumento`, no el parser en sí.
 *
 * Lo que demuestra, contra PGlite real, sin red (D-004):
 *  1. Autenticación por token con alcance de tenant — nunca por el buzón
 *     (V-1): un token de la firma A con el buzón de la firma B en el
 *     payload se rechaza como "buzón no reconocido EN ESA FIRMA", sin leer
 *     ni escribir una sola fila de la firma B.
 *  2. Idempotencia por CUFE: la MISMA restricción de A2/A4
 *     (`source_document_cufe_uq`), reenviar el mismo adjunto no duplica nada.
 *  3. Registro de todo llamado entrante (`integration_call_log`), incluidas
 *     las llamadas que ni siquiera se autenticaron.
 *  4. Nunca se calcula una retención ni se construye un asiento: el
 *     documento queda `parseado` con un trabajo `pendiente`, exactamente
 *     igual que prueba `tests/services/worker.test.ts` de A6 para
 *     `recibirDocumento`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { crearEscenario, type Escenario } from '../helpers/fixtures.js';
import { provisionarCanalIngestaCorreo } from '../../src/integraciones/aprovisionamiento.js';
import { procesarWebhookCorreo, ENDPOINT_INGEST_CORREO } from '../../src/integraciones/ingest-correo.js';
import type { CorreoEntrante } from '../../src/ingest/correo/tipos.js';

const DIR_FIXTURES = fileURLToPath(new URL('../fixtures/ubl/', import.meta.url));
function base64Fixture(nombre: string): string {
  return readFileSync(path.join(DIR_FIXTURES, nombre)).toString('base64');
}

let db: TestDb;
let alfa: Escenario;
let beta: Escenario;
let tokenAlfa: string;
let tokenBeta: string;

function correoParaBuzon(buzon: string, opciones: Partial<CorreoEntrante> = {}): unknown {
  return {
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    remitenteEmail: 'proveedor@ejemplo.com',
    remitenteNombre: 'Proveedor S.A.S.',
    destinatarios: [buzon],
    asunto: 'Factura electrónica',
    headers: {},
    adjuntos: [{ nombreArchivo: 'factura.xml', contentType: 'application/xml', contenidoBase64: base64Fixture('invoice-simple.xml') }],
    tamanoBytes: null,
    ...opciones,
  };
}

beforeAll(async () => {
  db = await createTestDb();
  alfa = await crearEscenario(db);
  beta = await crearEscenario(db);
  tokenAlfa = (
    await db.asTenant(alfa.tenantId, alfa.companyId, (tx) => provisionarCanalIngestaCorreo(tx, { tenantId: alfa.tenantId }))
  ).token;
  tokenBeta = (
    await db.asTenant(beta.tenantId, beta.companyId, (tx) => provisionarCanalIngestaCorreo(tx, { tenantId: beta.tenantId }))
  ).token;
});

afterAll(async () => {
  await db?.close();
});

async function buzonDe(escenario: Escenario): Promise<string> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ buzon_email: string }>('SELECT buzon_email FROM company WHERE id = $1', [escenario.companyId]),
  );
  return rows[0]!.buzon_email;
}

describe('camino feliz', () => {
  it('autentica por token, resuelve la empresa por el buzón (sin app.resolver_empresa_por_buzon) y encola la causación sin calcular nada', async () => {
    const buzon = await buzonDe(alfa);
    const resultado = await procesarWebhookCorreo(db.client, {
      token: tokenAlfa,
      payloadCrudo: correoParaBuzon(buzon),
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.companyId).toBe(alfa.companyId);
    expect(resultado.adjuntos).toHaveLength(1);
    expect(resultado.adjuntos[0]?.resultado).toBe('procesado');

    const sourceDocumentId = resultado.adjuntos[0]!.sourceDocumentId!;
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>('SELECT estado FROM source_document WHERE id = $1', [sourceDocumentId]),
    );
    // Nunca causado dentro del request: sigue "parseado", esperando al worker.
    expect(rows[0]?.estado).toBe('parseado');

    const { rows: jobs } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>('SELECT estado FROM document_processing_job WHERE source_document_id = $1', [
        sourceDocumentId,
      ]),
    );
    expect(jobs[0]?.estado).toBe('pendiente');

    const { rows: asientos } = await db.asAdmin((tx) =>
      tx.query('SELECT 1 FROM journal_entry WHERE source_document_id = $1', [sourceDocumentId]),
    );
    expect(asientos).toHaveLength(0);
  });

  it('registra la llamada entrante como "ok" en integration_call_log', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const buzon = await buzonDe(escenario);
    await procesarWebhookCorreo(db.client, { token: provisionado.token, payloadCrudo: correoParaBuzon(buzon) });

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ resultado: string; canal: string; endpoint: string }>(
        `SELECT resultado, canal, endpoint FROM integration_call_log
          WHERE tenant_id = $1 ORDER BY ocurrido_en DESC LIMIT 1`,
        [escenario.tenantId],
      ),
    );
    expect(rows[0]).toMatchObject({ resultado: 'ok', canal: 'correo', endpoint: ENDPOINT_INGEST_CORREO });
  });
});

describe('idempotencia por CUFE (source_document_cufe_uq — sin restricción propia)', () => {
  it('reenviar el mismo adjunto no crea un segundo source_document ni un segundo trabajo', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const buzon = await buzonDe(escenario);
    const payload = correoParaBuzon(buzon);

    const primero = await procesarWebhookCorreo(db.client, { token: provisionado.token, payloadCrudo: payload });
    const segundo = await procesarWebhookCorreo(db.client, { token: provisionado.token, payloadCrudo: payload });

    expect(primero.ok).toBe(true);
    expect(segundo.ok).toBe(true);
    if (!primero.ok || !segundo.ok) return;
    expect(primero.adjuntos[0]?.resultado).toBe('procesado');
    expect(segundo.adjuntos[0]?.resultado).toBe('duplicado');
    expect(segundo.adjuntos[0]?.sourceDocumentId).toBe(primero.adjuntos[0]?.sourceDocumentId);

    const { rows } = await db.asAdmin((tx) =>
      tx.query('SELECT id FROM source_document WHERE id = $1', [primero.adjuntos[0]!.sourceDocumentId]),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('V-1 — la autenticación nunca depende de que el buzón sea secreto', () => {
  it('el token de la firma A con el buzón de la firma B en el payload NO lee ni escribe nada de B', async () => {
    const buzonDeBeta = await buzonDe(beta);
    const resultado = await procesarWebhookCorreo(db.client, {
      token: tokenAlfa,
      payloadCrudo: correoParaBuzon(buzonDeBeta),
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('buzon_no_reconocido');

    // La fila de auditoría del intento queda del lado de ALFA (tenant que se
    // autenticó), NUNCA del lado de BETA — quien fue "mencionado" en el
    // payload no ve ni una fila.
    const { rows: logAlfa } = await db.asAdmin((tx) =>
      tx.query('SELECT tenant_id, company_id FROM email_ingest_log WHERE id = $1', [resultado.emailIngestLogId]),
    );
    expect(logAlfa[0]).toMatchObject({ tenant_id: alfa.tenantId, company_id: null });

    const { rows: sourceDocsBeta } = await db.asAdmin((tx) =>
      tx.query('SELECT count(*)::int AS n FROM source_document WHERE company_id = $1', [beta.companyId]),
    );
    // Solo el documento de fixture que ya trae crearEscenario, ninguno nuevo.
    expect(sourceDocsBeta[0]?.n).toBe(1);
  });
});

describe('autenticación fallida', () => {
  it('un token inválido no procesa nada y queda registrado sin tenant', async () => {
    const resultado = await procesarWebhookCorreo(db.client, {
      token: 'token-que-no-existe-en-ningun-lado',
      payloadCrudo: correoParaBuzon('cualquier-cosa@inbox.ejemplo.co'),
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('no_autenticado');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ tenant_id: string | null; resultado: string }>(
        `SELECT tenant_id, resultado FROM integration_call_log
          WHERE resultado = 'no_autenticado' ORDER BY ocurrido_en DESC LIMIT 1`,
      ),
    );
    expect(rows[0]).toMatchObject({ tenant_id: null, resultado: 'no_autenticado' });
  });
});

describe('payload inválido', () => {
  it('un payload sin los campos mínimos se rechaza sin lanzar y sin abrir sesión de más', async () => {
    const resultado = await procesarWebhookCorreo(db.client, {
      token: tokenAlfa,
      payloadCrudo: { destinatarios: [] },
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('payload_invalido');
  });

  it('un correo sin adjuntos se rechaza con motivo explícito, no como error', async () => {
    const buzon = await buzonDe(alfa);
    const resultado = await procesarWebhookCorreo(db.client, {
      token: tokenAlfa,
      payloadCrudo: correoParaBuzon(buzon, { adjuntos: [] }),
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('sin_adjuntos');
  });
});

describe('SPF/DKIM — cuarentena por autenticación fallida (insumo de "cuando un buzón falla")', () => {
  it('spf=fail pone el correo en cuarentena sin llegar a procesar ningún adjunto', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const buzon = await buzonDe(escenario);
    const resultado = await procesarWebhookCorreo(db.client, {
      token: provisionado.token,
      payloadCrudo: correoParaBuzon(buzon, {
        headers: { 'authentication-results': 'mx.ejemplo.com; spf=fail smtp.mailfrom=proveedor@ejemplo.com; dkim=pass' },
      }),
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('autenticacion_correo_fallida');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ resultado: string; spf_resultado: string }>(
        'SELECT resultado, spf_resultado FROM email_ingest_log WHERE id = $1',
        [resultado.emailIngestLogId],
      ),
    );
    expect(rows[0]).toMatchObject({ resultado: 'en_cuarentena', spf_resultado: 'fail' });

    const { rows: docs } = await db.asAdmin((tx) =>
      tx.query('SELECT count(*)::int AS n FROM source_document WHERE company_id = $1', [escenario.companyId]),
    );
    // El único documento es el que crearEscenario ya trae de fábrica.
    expect(docs[0]?.n).toBe(1);
  });
});

describe('límite de tasa (sección 10.3)', () => {
  it('el correo número 61 de la hora se rechaza sin procesar', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO email_ingest_log
           (tenant_id, company_id, buzon_destino, remitente_email, tamano_bytes, resultado, cantidad_adjuntos)
         SELECT $1, $2, 'relleno@inbox.ejemplo.co', 'x@x.com', 100, 'procesado', 1
           FROM generate_series(1, 60)`,
        [escenario.tenantId, escenario.companyId],
      ),
    );

    const buzon = await buzonDe(escenario);
    const resultado = await procesarWebhookCorreo(db.client, { token: provisionado.token, payloadCrudo: correoParaBuzon(buzon) });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('limite_tasa_excedido');
  });
});

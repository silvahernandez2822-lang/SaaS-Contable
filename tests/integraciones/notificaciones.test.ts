/**
 * A13 — Datos de solo lectura para las notificaciones que n8n programa
 * (sección 13.1). Cada prueba demuestra que la función es un SELECT: no
 * inserta, no calcula, no decide una retención.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { crearEscenario, type Escenario } from '../helpers/fixtures.js';
import {
  listarBuzonesConFallas,
  listarFacturasPendientesParaNotificar,
  listarVencimientosProximos,
} from '../../src/integraciones/notificaciones.js';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
});

afterAll(async () => {
  await db?.close();
});

describe('listarFacturasPendientesParaNotificar', () => {
  it('encuentra un documento en pendiente_aprobacion con más de N días esperando', async () => {
    // `source_document_updated_at` (008) fija `updated_at = now()` en TODO
    // UPDATE: hay que apagarlo un instante para poder simular "lleva 3 días
    // esperando" sin esperar de verdad.
    await db.asAdmin(async (tx) => {
      await tx.exec('ALTER TABLE source_document DISABLE TRIGGER source_document_updated_at');
      await tx.query(
        `UPDATE source_document SET estado = 'pendiente_aprobacion', updated_at = now() - interval '3 days'
          WHERE id = $1`,
        [e.sourceDocumentId],
      );
      await tx.exec('ALTER TABLE source_document ENABLE TRIGGER source_document_updated_at');
    });

    const pendientes = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarFacturasPendientesParaNotificar(tx, { diasMinimos: 1 }),
    );
    expect(pendientes.some((p) => p.sourceDocumentId === e.sourceDocumentId)).toBe(true);

    const ningunaHoy = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarFacturasPendientesParaNotificar(tx, { diasMinimos: 10 }),
    );
    expect(ningunaHoy).toEqual([]);
  });
});

describe('listarBuzonesConFallas', () => {
  it('agrupa correos rechazados/en cuarentena recientes por buzón', async () => {
    const escenario = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO email_ingest_log
           (tenant_id, company_id, buzon_destino, remitente_email, tamano_bytes, resultado, motivo, cantidad_adjuntos)
         VALUES
           ($1, $2, 'roto@inbox.ejemplo.co', 'x@x.com', 10, 'rechazado', 'sin adjuntos', 0),
           ($1, $2, 'roto@inbox.ejemplo.co', 'x@x.com', 10, 'en_cuarentena', 'spf fail', 1)`,
        [escenario.tenantId, escenario.companyId],
      ),
    );

    const fallas = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) => listarBuzonesConFallas(tx));
    const fila = fallas.find((f) => f.buzonDestino === 'roto@inbox.ejemplo.co');
    expect(fila?.totalFallas).toBe(2);
  });

  it('no ve las fallas de OTRA firma', async () => {
    const propia = await crearEscenario(db);
    const otra = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO email_ingest_log
           (tenant_id, company_id, buzon_destino, remitente_email, tamano_bytes, resultado, motivo, cantidad_adjuntos)
         VALUES ($1, $2, 'buzon-de-otra-firma@inbox.ejemplo.co', 'x@x.com', 10, 'rechazado', 'motivo', 0)`,
        [otra.tenantId, otra.companyId],
      ),
    );
    const fallas = await db.asTenant(propia.tenantId, propia.companyId, (tx) => listarBuzonesConFallas(tx));
    expect(fallas.find((f) => f.buzonDestino === 'buzon-de-otra-firma@inbox.ejemplo.co')).toBeUndefined();
  });
});

describe('listarVencimientosProximos', () => {
  it('filtra por el último dígito del NIT de la empresa en sesión, sin calcular ningún vencimiento nuevo', async () => {
    const escenario = await crearEscenario(db);
    const { rows: comp } = await db.asAdmin((tx) =>
      tx.query<{ nit: string }>('SELECT nit FROM company WHERE id = $1', [escenario.companyId]),
    );
    const ultimoDigito = comp[0]!.nit.slice(-1);

    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO tax_calendar
           (tenant_id, anio, tipo_obligacion, periodo, ultimo_digito_nit, fecha_vencimiento, vigente_desde, norma_respaldo)
         VALUES
           ($1, extract(year from now())::int, 'retencion_fuente', 'mensual', $2, CURRENT_DATE + 5, CURRENT_DATE - 30, 'Prueba, no normativo'),
           ($1, extract(year from now())::int, 'iva', 'bimestral', 'todos', CURRENT_DATE + 10, CURRENT_DATE - 30, 'Prueba, no normativo'),
           ($1, extract(year from now())::int, 'fuera_de_ventana', 'mensual', $2, CURRENT_DATE + 90, CURRENT_DATE - 30, 'Prueba, no normativo')`,
        [escenario.tenantId, ultimoDigito],
      ),
    );

    const vencimientos = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      listarVencimientosProximos(tx, { diasVentana: 15 }),
    );
    const tipos = vencimientos.map((v) => v.tipoObligacion).sort();
    expect(tipos).toEqual(['iva', 'retencion_fuente']);
  });
});

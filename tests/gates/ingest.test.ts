/**
 * COMPUERTA DE INGEST — Agente A4, Ola 1.
 *
 * A diferencia de `tests/ingest/*.test.ts` (puras, sin base de datos), esta
 * suite demuestra las garantías que la sección 10.3 exige que imponga LA
 * BASE, no el código (D-003):
 *
 *   1. La deduplicación por CUFE es un UNIQUE de `source_document`: un intento
 *      de causar el mismo CUFE dos veces lo rechaza el MOTOR (23505), no un
 *      `if` en TypeScript.
 *   2. El caso crítico de la sección 10.2 — Invoice embebido en base64 dentro
 *      de un AttachedDocument — sobrevive el viaje completo hasta quedar
 *      guardado como `source_document` correcto.
 *   3. Resolver la empresa dueña de un buzón, ANTES de que exista sesión, es
 *      posible sin darle a `app_user` un privilegio general sobre `company`
 *      (que su RLS de tenant estricto nunca concedería sin sesión).
 *   4. El registro del correo (`email_ingest_log`) para un buzón NO reconocido
 *      queda invisible para cualquier tenant, tal como `audit_log`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import { crearEscenario } from '../helpers/fixtures.js';
import type { Escenario } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import { procesarAdjuntoXml } from '../../src/ingest/procesar.js';
import {
  contarCorreosRecientes,
  guardarDocumentoProcesado,
  registrarAdjunto,
  registrarCorreo,
  resolverEmpresaPorBuzon,
} from '../../src/ingest/persistencia.js';

const DIR_FIXTURES = fileURLToPath(new URL('../fixtures/ubl/', import.meta.url));
function leerFixture(nombre: string): Buffer {
  return readFileSync(path.join(DIR_FIXTURES, nombre));
}

let db: TestDb;
let e: Escenario;
let buzon: string;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ buzon_email: string }>('SELECT buzon_email FROM company WHERE id = $1', [e.companyId]),
  );
  buzon = rows[0]!.buzon_email;
});

afterAll(async () => {
  await db?.close();
});

// =============================================================================
describe('resolverEmpresaPorBuzon — antes de que exista sesión', () => {
  it('resuelve tenant/company de un buzón reconocido, sin ninguna sesión abierta', async () => {
    // db.asAdmin corre como superusuario, pero el SET LOCAL ROLE de abajo
    // degrada la conexión a app_user DENTRO de esa transacción, y aquí no se
    // llama emitirSesion en ningún momento: no hay app.session_token.
    await db.asAdmin(async (tx) => {
      await tx.exec('SET LOCAL ROLE app_user');

      // Prueba de control: sin sesión, una consulta DIRECTA a `company` no ve
      // absolutamente nada (RLS de tenant estricto, 012_rls.sql). Es la razón
      // de ser de app.resolver_empresa_por_buzon.
      const directa = await tx.query('SELECT id FROM company');
      expect(directa.rows).toEqual([]);

      const { rows } = await tx.query<{ company_id: string; tenant_id: string }>(
        'SELECT * FROM app.resolver_empresa_por_buzon($1)',
        [buzon],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ company_id: e.companyId, tenant_id: e.tenantId });
    });
  });

  it('un buzón que no existe no resuelve nada (ni error, ni una fila)', async () => {
    const resuelto = await db.asAdmin((tx) =>
      resolverEmpresaPorBuzon(tx, 'empresa-no-existe@inbox.ejemplo.co'),
    );
    expect(resuelto).toBeNull();
  });

  it('resolverEmpresaPorBuzon (el helper de persistencia.ts) también resuelve el buzón real', async () => {
    const resuelto = await db.asAdmin((tx) => resolverEmpresaPorBuzon(tx, buzon.toUpperCase()));
    expect(resuelto).toEqual({ tenantId: e.tenantId, companyId: e.companyId });
  });
});

// =============================================================================
describe('Deduplicación por CUFE — impuesta por la BASE (D-003)', () => {
  it('guardarDocumentoProcesado crea el documento la primera vez', async () => {
    const r = procesarAdjuntoXml(leerFixture('invoice-simple.xml'));
    if (!r.ok) throw new Error('fixture debía parsear');

    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      guardarDocumentoProcesado(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        documento: r.documento,
        remitenteEmail: 'proveedor@ejemplo.co',
      }),
    );
    expect(resultado.resultado).toBe('creado');

    const { rows } = await db.asAdmin((tx) =>
      tx.query('SELECT tipo_documento, cufe, estado FROM source_document WHERE id = $1', [
        (resultado as { sourceDocumentId: string }).sourceDocumentId,
      ]),
    );
    expect(rows[0]).toMatchObject({ tipo_documento: 'Invoice', cufe: r.documento.cufe, estado: 'parseado' });
  });

  it('reprocesar EL MISMO adjunto no crea un segundo documento: guardarDocumentoProcesado detecta el duplicado', async () => {
    const r = procesarAdjuntoXml(leerFixture('invoice-simple.xml'));
    if (!r.ok) throw new Error('fixture debía parsear');

    const segundoIntento = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      guardarDocumentoProcesado(tx, { tenantId: e.tenantId, companyId: e.companyId, documento: r.documento }),
    );
    expect(segundoIntento.resultado).toBe('duplicado');
    if (segundoIntento.resultado !== 'duplicado') return;
    expect(segundoIntento.porQue).toBe('cufe');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>('SELECT count(*)::text AS total FROM source_document WHERE cufe = $1', [
        r.documento.cufe,
      ]),
    );
    expect(rows[0]?.total).toBe('1'); // UN solo source_document con ese CUFE, nunca dos.
  });

  it('LA GARANTÍA REAL es el UNIQUE de la base, no el SELECT previo: un INSERT directo con el mismo CUFE lo rechaza el motor con 23505', async () => {
    const r = procesarAdjuntoXml(leerFixture('invoice-simple.xml'));
    if (!r.ok) throw new Error('fixture debía parsear');

    await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      await esperarErrorPg(
        () =>
          tx.query(
            `INSERT INTO source_document
               (tenant_id, company_id, tipo_documento, cufe, numero_documento, emisor_nit,
                fecha_hecho_economico, hash_contenido)
             VALUES ($1, $2, 'Invoice', $3, 'OTRO-NUMERO', '900000000', '2026-01-01', $4)`,
            [e.tenantId, e.companyId, r.documento.cufe, uuid()],
          ),
        SQLSTATE.UNIQUE_VIOLATION,
        'insertar un segundo source_document con un CUFE ya causado, saltándose guardarDocumentoProcesado',
      );
    });
  });
});

// =============================================================================
describe('EL CASO CRÍTICO — Invoice en base64 dentro de AttachedDocument, hasta la BASE', () => {
  it('el documento embebido llega a source_document como Invoice, con SU CUFE y SU xml_crudo desempaquetado', async () => {
    const r = procesarAdjuntoXml(leerFixture('attached-document-invoice-base64.xml'));
    if (!r.ok) throw new Error('fixture debía parsear');
    expect(r.documento.veniaEnAttachedDocument).toBe(true);

    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      guardarDocumentoProcesado(tx, { tenantId: e.tenantId, companyId: e.companyId, documento: r.documento }),
    );
    expect(resultado.resultado).toBe('creado');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ tipo_documento: string; cufe: string; xml_crudo: string }>(
        'SELECT tipo_documento, cufe, xml_crudo FROM source_document WHERE id = $1',
        [(resultado as { sourceDocumentId: string }).sourceDocumentId],
      ),
    );
    const fila = rows[0]!;
    expect(fila.tipo_documento).toBe('Invoice'); // NO "AttachedDocument": el contenedor no es el tipo causable.
    expect(fila.cufe).toBe(r.documento.cufe);
    expect(fila.xml_crudo.includes('<AttachedDocument')).toBe(false);
    expect(fila.xml_crudo.includes('<Invoice')).toBe(true);
  });

  it('extraction.datos_extraidos guarda el documento normalizado, con los bigint como texto', async () => {
    const r = procesarAdjuntoXml(leerFixture('attached-document-invoice-plano.xml'));
    if (!r.ok) throw new Error('fixture debía parsear');

    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      guardarDocumentoProcesado(tx, { tenantId: e.tenantId, companyId: e.companyId, documento: r.documento }),
    );
    if (resultado.resultado !== 'creado') throw new Error('se esperaba creado');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ datos_extraidos: { totales: { neto: string } } }>(
        'SELECT datos_extraidos FROM extraction WHERE source_document_id = $1',
        [resultado.sourceDocumentId],
      ),
    );
    expect(rows[0]?.datos_extraidos.totales.neto).toBe('59500000');
  });
});

// =============================================================================
describe('Nota crédito — resuelve la factura referenciada por CUFE', () => {
  it('documento_referenciado_id apunta a la factura ya guardada, encontrada por su CUFE', async () => {
    const notaCredito = procesarAdjuntoXml(leerFixture('credit-note-simple.xml'));
    if (!notaCredito.ok) throw new Error('fixture debía parsear');

    // La factura invoice-simple.xml ya se guardó en el describe de dedup, con
    // el mismo CUFE que la nota crédito referencia por BillingReference.
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      guardarDocumentoProcesado(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        documento: notaCredito.documento,
      }),
    );
    if (resultado.resultado !== 'creado') throw new Error('se esperaba creado');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ documento_referenciado_id: string | null; cufe_factura: string | null }>(
        `SELECT nc.documento_referenciado_id, f.cufe AS cufe_factura
           FROM source_document nc
           LEFT JOIN source_document f ON f.id = nc.documento_referenciado_id
          WHERE nc.id = $1`,
        [resultado.sourceDocumentId],
      ),
    );
    expect(rows[0]?.documento_referenciado_id).not.toBeNull();
    expect(rows[0]?.cufe_factura).toBe(notaCredito.documento.documentoReferenciado?.cufe);
  });
});

// =============================================================================
describe('Registro de correo (sección 10.3) — email_ingest_log / email_ingest_attachment', () => {
  it('registra un correo procesado y su adjunto, ligados a la empresa', async () => {
    const r = procesarAdjuntoXml(leerFixture('invoice-simple.xml'), { nombreArchivo: 'otra-factura.xml' });
    if (!r.ok) throw new Error('fixture debía parsear');

    const { logId } = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const guardado = await guardarDocumentoProcesado(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        documento: { ...r.documento, cufe: `${r.documento.cufe!.slice(0, -4)}zzzz` },
      });
      const logId = await registrarCorreo(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        buzonDestino: buzon,
        messageId: '<mensaje-1@ejemplo.co>',
        remitenteEmail: 'proveedor@ejemplo.co',
        remitenteNombre: 'Proveedor Fixture SAS',
        asunto: 'Factura electrónica',
        tamanoBytes: 4096,
        spfResultado: 'pass',
        dkimResultado: 'pass',
        cantidadAdjuntos: 1,
        resultado: 'procesado',
        motivo: null,
        limiteTasaExcedido: false,
      });
      await registrarAdjunto(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        emailIngestLogId: logId,
        nombreArchivo: 'otra-factura.xml',
        tamanoBytes: 4096,
        hashSha256: r.documento.hashContenido,
        tipoDocumentoDetectado: 'Invoice',
        contenedorAttachedDocument: false,
        resultado: 'procesado',
        motivoCuarentena: null,
        sourceDocumentId: guardado.sourceDocumentId,
      });
      return { logId };
    });

    const { rows } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      tx.query('SELECT resultado, cantidad_adjuntos FROM email_ingest_log WHERE id = $1', [logId]),
    );
    expect(rows[0]).toMatchObject({ resultado: 'procesado', cantidad_adjuntos: 1 });
  });

  it('un correo a un buzón NO reconocido se registra (tenant_id/company_id NULL) y NINGÚN tenant lo ve', async () => {
    const logId = await db.asAdmin((tx) =>
      registrarCorreo(tx, {
        tenantId: null,
        companyId: null,
        buzonDestino: 'empresa-inexistente@inbox.ejemplo.co',
        messageId: null,
        remitenteEmail: 'quien-sea@ejemplo.co',
        remitenteNombre: null,
        asunto: null,
        tamanoBytes: 1024,
        spfResultado: 'no_verificado',
        dkimResultado: 'no_verificado',
        cantidadAdjuntos: 0,
        resultado: 'rechazado',
        motivo: 'buzón no corresponde a ninguna empresa activa',
        limiteTasaExcedido: false,
      }),
    );

    // Invisible para el tenant del escenario (mismo patrón que audit_log).
    const { rows: comoTenant } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      tx.query('SELECT id FROM email_ingest_log WHERE id = $1', [logId]),
    );
    expect(comoTenant).toEqual([]);

    // Sí visible por el camino administrativo.
    const { rows: comoAdmin } = await db.asAdmin((tx) =>
      tx.query<{ resultado: string; tenant_id: string | null }>(
        'SELECT resultado, tenant_id FROM email_ingest_log WHERE id = $1',
        [logId],
      ),
    );
    expect(comoAdmin[0]).toMatchObject({ resultado: 'rechazado', tenant_id: null });
  });

  it('email_ingest_log es append-only: intentar corregirlo lo rechaza el motor', async () => {
    const logId = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      registrarCorreo(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        buzonDestino: buzon,
        messageId: null,
        remitenteEmail: 'x@y.co',
        remitenteNombre: null,
        asunto: null,
        tamanoBytes: 10,
        spfResultado: 'pass',
        dkimResultado: 'pass',
        cantidadAdjuntos: 0,
        resultado: 'rechazado',
        motivo: 'motivo original',
        limiteTasaExcedido: false,
      }),
    );

    await db.asAdmin((tx) =>
      esperarErrorPg(
        () => tx.query("UPDATE email_ingest_log SET motivo = 'motivo corregido' WHERE id = $1", [logId]),
        SQLSTATE.AUDITORIA_INMUTABLE,
        'corregir un email_ingest_log ya registrado, incluso como superusuario',
      ),
    );
  });

  it('contarCorreosRecientes cuenta los correos ya registrados para la empresa en la ventana', async () => {
    const antes = await db.asTenant(e.tenantId, e.companyId, (tx) => contarCorreosRecientes(tx, e.companyId, 60));
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      registrarCorreo(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        buzonDestino: buzon,
        messageId: null,
        remitenteEmail: 'otro@ejemplo.co',
        remitenteNombre: null,
        asunto: null,
        tamanoBytes: 10,
        spfResultado: 'pass',
        dkimResultado: 'pass',
        cantidadAdjuntos: 0,
        resultado: 'en_cuarentena',
        motivo: 'xml_mal_formado',
        limiteTasaExcedido: false,
      }),
    );
    const despues = await db.asTenant(e.tenantId, e.companyId, (tx) => contarCorreosRecientes(tx, e.companyId, 60));
    expect(despues).toBe(antes + 1);
  });
});

// =============================================================================
describe('Guardia de alcance (D-037) sobre las tablas nuevas de A4', () => {
  it('email_ingest_log.company_id no puede citar una empresa de OTRO tenant (AL001)', async () => {
    const otro = await crearEscenario(db);

    await db.asAdmin((tx) =>
      esperarErrorPg(
        () =>
          tx.query(
            `INSERT INTO email_ingest_log
               (tenant_id, company_id, buzon_destino, remitente_email, tamano_bytes, resultado)
             VALUES ($1, $2, 'buzon@x.co', 'a@b.co', 10, 'procesado')`,
            [e.tenantId, otro.companyId],
          ),
        SQLSTATE.FK_ALCANCE_AJENO,
        'email_ingest_log citando una empresa de otro tenant',
      ),
    );
  });
});

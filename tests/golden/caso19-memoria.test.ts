/**
 * CASO DORADO 19 — «Segunda factura del mismo proveedor con la misma
 * descripción: se clasifica desde memoria, CERO llamadas al LLM.»
 *
 * Era el único de los veinte que quedaba sin implementar: A3 probó en la Ola 1
 * la mitad que se podía probar sin IA (que el motor no tiene con qué llamar a
 * nadie) y A14 lo dejó explícitamente pendiente de esta ola en vez de darlo
 * por bueno. Esta es la otra mitad, y se prueba como hay que probarla: con un
 * proveedor de LLM falso que CUENTA sus llamadas.
 *
 * La evidencia es un número. En la primera factura el contador sube a 1; en la
 * segunda, después de que un humano confirmó, el contador se queda en 0 y el
 * costo del documento es exactamente 0 millonésimas de USD.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProveedorLlmFalso,
  clasificarDocumento,
  confirmarClasificacion,
} from '../../src/ai/index.js';
import { encolarCausacion, procesarJobCausacion } from '../../src/services/index.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { crearEscenario, type Escenario } from '../helpers/fixtures.js';
import { crearConceptos, crearDocumentoConLineas, type ConceptosPrueba } from '../ai/_escenario.js';

let db: TestDb;
let e: Escenario;
let conceptos: ConceptosPrueba;

/**
 * La misma compra, facturada dos meses seguidos. Lo que cambia entre una y
 * otra es lo que SIEMPRE cambia en la vida real: el mes, el consecutivo de la
 * orden y cómo el proveedor escribió las mayúsculas y las tildes ese día.
 */
const PRIMERA = 'Servicio de mantenimiento de equipos de cómputo — julio 2026, OT-4471';
const SEGUNDA = 'SERVICIO DE MANTENIMIENTO DE EQUIPOS DE COMPUTO - agosto 2026, OT-5093';

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  conceptos = await crearConceptos(db, e);
});

afterAll(async () => {
  await db?.close();
});

describe('Caso dorado 19 · la segunda factura del mismo proveedor no consume tokens', () => {
  const proveedor = new ProveedorLlmFalso();
  let primerDocumento = '';
  let segundoDocumento = '';

  it('1) primera factura de un proveedor nuevo: hay que preguntarle al modelo, UNA vez', async () => {
    primerDocumento = await crearDocumentoConLineas(db, e, [PRIMERA]);
    proveedor.reiniciarContador();

    const r = await db.asAdmin((tx) => clasificarDocumento(tx, primerDocumento, { proveedor }));

    expect(proveedor.llamadas).toBe(1);
    expect(r.llamadasLlm).toBe(1);
    expect(r.costoMicrosUsd).toBeGreaterThan(0);
    expect(r.lineas[0]!.origen).toBe('llm');
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
    expect(r.lineas[0]!.decision).toBe('proponer');
  });

  it('2) el humano confirma la propuesta y la decisión queda en memoria', async () => {
    const pendiente = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM clasificacion_pendiente WHERE source_document_id = $1`,
        [primerDocumento],
      );
      return rows[0]!.id;
    });

    const confirmacion = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      confirmarClasificacion(tx, {
        pendienteId: pendiente,
        conceptoId: conceptos.mantenimiento,
        usuarioId: e.userId,
      }),
    );
    expect(confirmacion.origen).toBe('aprobacion_humana');

    const memoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ patron_descripcion: string; concepto_causacion_id: string }>(
        `SELECT patron_descripcion, concepto_causacion_id FROM memoria_clasificacion
          WHERE company_id = $1 AND third_party_id = $2`,
        [e.companyId, e.thirdPartyId],
      );
      return rows;
    });
    expect(memoria).toHaveLength(1);
    expect(memoria[0]!.patron_descripcion).toBe('servicio de mantenimiento de equipos de computo');
    expect(memoria[0]!.concepto_causacion_id).toBe(conceptos.mantenimiento);
  });

  it('3) SEGUNDA FACTURA: cero llamadas al LLM y cero costo — la evidencia del caso 19', async () => {
    segundoDocumento = await crearDocumentoConLineas(db, e, [SEGUNDA], { fecha: '2026-06-20' });

    // El contador arranca en cero justo antes de la segunda pasada: lo que se
    // mide es EXACTAMENTE lo que costó esta factura.
    proveedor.reiniciarContador();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, segundoDocumento, { proveedor }));

    expect(proveedor.llamadas).toBe(0);
    expect(proveedor.peticiones).toHaveLength(0);
    expect(r.llamadasLlm).toBe(0);
    expect(r.costoMicrosUsd).toBe(0);
    expect(r.lineas[0]!.origen).toBe('memoria');
    expect(r.lineas[0]!.decision).toBe('aplicar');
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
  });

  it('4) no se creó una memoria nueva: se reutilizó la que había, y el acierto quedó contado', async () => {
    const memoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number; aciertos: number }>(
        `SELECT count(*)::int AS n, max(aciertos)::int AS aciertos
           FROM memoria_clasificacion WHERE company_id = $1 AND third_party_id = $2`,
        [e.companyId, e.thirdPartyId],
      );
      return rows[0]!;
    });
    expect(Number(memoria.n)).toBe(1);
    // 1 de la confirmación humana + 1 del acierto de la segunda factura.
    expect(Number(memoria.aciertos)).toBe(2);
  });

  it('5) la segunda factura tampoco entra a la cola de revisión: no hay nada que revisar', async () => {
    const pendientes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clasificacion_pendiente
          WHERE source_document_id = $1 AND estado = 'pendiente'`,
        [segundoDocumento],
      );
      return rows[0]!.n;
    });
    expect(pendientes).toBe(0);
  });

  it('6) y la causación de A6 resuelve el concepto desde esa misma memoria', async () => {
    // El puente A5 -> A6: la entrada que escribió A5 (normalizador versión 2,
    // sin tildes y sin el consecutivo de la orden) tiene que encontrarla el
    // worker de causación, que recibe la descripción CRUDA de la factura.
    const job = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      encolarCausacion(tx, segundoDocumento),
    );
    const r = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: segundoDocumento }),
    );

    // Puede quedarse en revisión manual por otras razones (este escenario no
    // carga parámetros tributarios), pero JAMÁS por falta de clasificación.
    const motivos = r.estado === 'revision_manual' ? r.motivos.map((m) => m.codigo) : [];
    expect(motivos).not.toContain('sin_clasificacion_automatica');
  });

  it('7) el ahorro no depende de que las dos facturas se escriban igual', async () => {
    // Tres variantes más del mismo servicio, con otro mes, otra orden, otra
    // puntuación y otras mayúsculas. Ninguna cuesta una llamada.
    proveedor.reiniciarContador();
    const variantes = [
      'Servicio de mantenimiento de equipos de computo, septiembre 2026 (OT 6120)',
      'servicio de mantenimiento de EQUIPOS de cómputo — 15/10/2026 OT-7001',
      '  Servicio  de  mantenimiento  de  equipos  de  cómputo   OT-8899  ',
    ];
    for (const descripcion of variantes) {
      const documento = await crearDocumentoConLineas(db, e, [descripcion]);
      const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
      expect(r.lineas[0]!.origen).toBe('memoria');
      expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
    }
    expect(proveedor.llamadas).toBe(0);
  });

  it('8) y con OTRO proveedor la memoria no se contagia: ahí sí hay que preguntar', async () => {
    // La clave es (empresa, tercero, patrón). Un proveedor distinto con la
    // misma descripción no hereda la decisión: puede facturar otra cosa.
    const otroTercero = await db.asAdmin(async (tx) => {
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO third_party (id, tenant_id, company_id, numero_documento, tipo_persona,
                                  razon_social, municipality_id, codigo_dane)
         VALUES ($1,$2,$3,$4,'juridica','Otro proveedor',$5,'11001')`,
        [id, e.tenantId, e.companyId, `9021${id.slice(0, 6)}`, e.municipalityId],
      );
      return id;
    });

    const documento = await crearDocumentoConLineas(db, e, [SEGUNDA], { terceroId: otroTercero });
    proveedor.reiniciarContador();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(proveedor.llamadas).toBe(1);
    expect(r.lineas[0]!.origen).toBe('llm');
  });
});

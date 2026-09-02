/**
 * A14 · Compuerta AMPLIADA de V-23 (recuperación de una factura rechazada por
 * error).
 *
 * Suite PROPIA de A14: no reusa ni una aserción de las pruebas que A3/A2/A7
 * entregaron con el fix. Lo que aquí se prueba es lo que aquella compuerta NO
 * intentó.
 *
 *  A. RO-1 byte a byte: el asiento anulado del primer intento, sus líneas y su
 *     `retention_applied` quedan EXACTAMENTE igual tras el reproceso.
 *  B. Carreras: dos causaciones sobre el mismo documento tras un reproceso,
 *     saltándose la cola; el invariante "un solo asiento de causación vivo".
 *  C. Máquina de estados: reintegrar dos veces, reintegrar con job pendiente,
 *     reintegrar con draft vivo, con posted vivo, con archivado.
 *  D. RO-7 y permisos sobre la firma nueva de dos argumentos.
 *  E. Caso dorado 18: la idempotencia clásica no se rompió.
 *  F. Nota crédito rechazada y reintegrada.
 *  G. DIVERGENCIA LEDGER/TRAZA — el vector caro: tras un reproceso quedan DOS
 *     juegos de `retention_applied` con `aplicada = true` para el mismo
 *     documento (el del asiento anulado y el del asiento vivo). Cualquier
 *     reporte que lea `retention_applied` sin atarlo al ledger `posted`
 *     duplica la retención.
 *  H. Trazabilidad: `reproceso_numero` y `asiento_anulado_previo` con 0, 1 y 2
 *     anulados.
 *  I. RO-2 sobre los archivos que tocó el fix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { aprobarAsiento, procesarJobCausacion } from '../../src/services/causacion';
import { encolarCausacion, reclamarSiguienteJob } from '../../src/services/cola';
import {
  archivarDocumentoRechazado,
  listarRechazadas,
  reintegrarDocumentoRechazado,
} from '../../src/services/bandeja';
import { retencionesPorTercero } from '../../src/reports/consulta';
import { retencionesPorTerceroYTipo } from '../../src/reports/exogena/consulta';

let db: TestDb;
const DIR_SEEDS = fileURLToPath(new URL('../../db/seeds', import.meta.url));

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

// =============================================================================
// Andamiaje propio
// =============================================================================

interface LineaPrueba {
  descripcion: string;
  baseGravable: number;
  valorIva: number;
}

/** Concepto SIN ninguna retención activa: aísla la máquina de estados. */
async function conceptoNeutro(e: Escenario): Promise<string> {
  return db.asAdmin(async (tx) => {
    const id = uuid();
    await tx.query(
      `INSERT INTO concepto_causacion (
         id, tenant_id, company_id, codigo, nombre, naturaleza,
         cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
         aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
       VALUES ($1,$2,$3,$4,'Concepto neutro A14/V-23','compra',$5,$6,$7,false,false,false,false)`,
      [id, e.tenantId, e.companyId, `A14V23-${id.slice(0, 8)}`, e.cuentas.gasto, e.cuentas.ivaDescontable, e.cuentas.proveedores],
    );
    return id;
  });
}

/**
 * Concepto CON retefuente real de A1 (`honorarios_pj`: 11% desde el primer
 * peso, caso dorado 6). Se usa para el vector G: sin retenciones reales no hay
 * traza que pueda divergir del ledger.
 */
async function conceptoConRetefuente(e: Escenario): Promise<string> {
  return db.asAdmin(async (tx) => {
    const { seed } = await import('../../src/db/seed');
    await seed(tx, { dir: DIR_SEEDS });
    const { rows: tc } = await tx.query<{ id: string }>(
      `SELECT id FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL
        AND tipo = 'retefuente' AND codigo = 'honorarios_pj'`,
    );
    if (!tc[0]) throw new Error('A1 no cargó el tax_concept retefuente/honorarios_pj');
    await tx.query(
      `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
       VALUES ($1,$2,2026,7,'2026-07-01','2026-07-31','abierto')`,
      [e.tenantId, e.companyId],
    );
    const id = uuid();
    await tx.query(
      `INSERT INTO concepto_causacion (
         id, tenant_id, company_id, codigo, nombre, naturaleza,
         cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
         tax_concept_retefuente_id, aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
       VALUES ($1,$2,$3,$4,'Honorarios PJ (A14/V-23)','compra',$5,$6,$7,$8,true,false,false,false)`,
      [id, e.tenantId, e.companyId, `A14V23R-${id.slice(0, 8)}`, e.cuentas.gasto, e.cuentas.ivaDescontable, e.cuentas.proveedores, tc[0].id],
    );
    return id;
  });
}

async function sembrar(
  e: Escenario,
  conceptoId: string,
  lineas: LineaPrueba[],
  opciones: { fecha?: string; tipoDocumento?: string } = {},
): Promise<void> {
  await db.asAdmin(async (tx) => {
    for (const l of lineas) {
      await tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [e.tenantId, e.companyId, e.thirdPartyId, l.descripcion.toLowerCase().trim(), conceptoId],
      );
    }
    await tx.query(
      `UPDATE source_document SET estado = 'parseado', fecha_hecho_economico = COALESCE($2::date, fecha_hecho_economico) WHERE id = $1`,
      [e.sourceDocumentId, opciones.fecha ?? null],
    );
    await tx.query(
      `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
       VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        JSON.stringify({
          tipoDocumento: opciones.tipoDocumento ?? 'Invoice',
          emisor: { nit: '900123456', nombre: 'Proveedor de prueba' },
          adquirente: { nit: null, nombre: null },
          lineas: lineas.map((l, i) => ({
            numero: i + 1,
            descripcion: l.descripcion,
            subtotal: String(l.baseGravable),
            impuestos: l.valorIva > 0 ? [{ codigo: '01', valor: String(l.valorIva) }] : [],
          })),
        }),
      ],
    );
  });
}

async function encolar(e: Escenario): Promise<string> {
  const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId), {
    userId: e.userId,
  });
  return job.id;
}

async function causar(e: Escenario, jobId: string) {
  return db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
}

async function rechazar(e: Escenario, entryId: string, userId: string, motivo = 'rechazada por error'): Promise<void> {
  await db.asTenant(
    e.tenantId,
    e.companyId,
    (tx) => aprobarAsiento(tx, { journalEntryId: entryId, decision: 'rechazado', ip: '198.51.100.9', userId, motivo }),
    { userId },
  );
}

async function estadoDoc(id: string): Promise<string> {
  return db.asAdmin((tx) =>
    tx.query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [id]).then((r) => r.rows[0]!.estado),
  );
}

interface FilaAsiento {
  id: string;
  estado: string;
  idempotency_key: string;
  tipo: string;
}

async function asientosDe(docId: string): Promise<FilaAsiento[]> {
  return db.asAdmin((tx) =>
    tx
      .query<FilaAsiento>(
        `SELECT id, estado, idempotency_key, tipo FROM journal_entry
          WHERE source_document_id = $1 ORDER BY created_at, id`,
        [docId],
      )
      .then((r) => r.rows),
  );
}

/** Fotografía completa (asiento + líneas + retenciones) para comparar byte a byte. */
async function fotoDelAsiento(entryId: string): Promise<string> {
  return db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ foto: unknown }>(
      `SELECT jsonb_build_object(
                'asiento', (SELECT to_jsonb(j.*) FROM journal_entry j WHERE j.id = $1),
                'lineas',  (SELECT coalesce(jsonb_agg(to_jsonb(l.*) ORDER BY l.linea), '[]'::jsonb)
                              FROM journal_line l WHERE l.journal_entry_id = $1),
                'retenciones', (SELECT coalesce(jsonb_agg(to_jsonb(r.*) ORDER BY r.id), '[]'::jsonb)
                                  FROM retention_applied r WHERE r.journal_entry_id = $1)
              ) AS foto`,
      [entryId],
    );
    return JSON.stringify(rows[0]!.foto);
  });
}

/** Escenario neutro causado y rechazado: el punto de partida de V-23. */
async function causadoYRechazado(): Promise<{ e: Escenario; userId: string; entryUno: string; jobId: string }> {
  const e = await crearEscenario(db);
  const concepto = await conceptoNeutro(e);
  await sembrar(e, concepto, [{ descripcion: 'Servicio neutro A14 V-23', baseGravable: 40_000_00, valorIva: 7_600_00 }]);
  const jobId = await encolar(e);
  const r = await causar(e, jobId);
  if (r.estado !== 'causado') throw new Error(`se esperaba causado, llegó ${r.estado}`);
  const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
  await rechazar(e, r.journalEntryId, userId);
  return { e, userId, entryUno: r.journalEntryId, jobId };
}

// =============================================================================
// A. REGLA DE ORO 1 — el asiento anulado no se mueve ni un byte
// =============================================================================
describe('A14 · V-23 / RO-1 — el asiento anulado del primer intento es intocable', () => {
  it('tras reintegrar y recausar, la foto del asiento anulado (asiento + líneas + retenciones) es idéntica', async () => {
    const { e, userId, entryUno } = await causadoYRechazado();
    const antes = await fotoDelAsiento(entryUno);

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'sí va'), {
      userId,
    });
    const segundo = await causar(e, job.id);
    expect(segundo.estado).toBe('causado');

    const despues = await fotoDelAsiento(entryUno);
    expect(despues).toBe(antes);
  });

  it('el UPDATE de retention_applied del segundo intento no toca las filas del primero', async () => {
    const { e, userId, entryUno } = await causadoYRechazado();
    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), {
      userId,
    });
    const segundo = await causar(e, job.id);
    if (segundo.estado !== 'causado') throw new Error('se esperaba causado');

    const filas = await db.asAdmin((tx) =>
      tx
        .query<{ journal_entry_id: string | null; n: string }>(
          `SELECT journal_entry_id, count(*)::text AS n FROM retention_applied
            WHERE source_document_id = $1 GROUP BY journal_entry_id`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows),
    );
    // Concepto neutro: cero retenciones. Lo que importa es que ninguna fila
    // haya sido reapuntada del asiento anulado al nuevo.
    for (const f of filas) {
      expect(f.journal_entry_id === entryUno || f.journal_entry_id === segundo.journalEntryId).toBe(true);
    }
  });

  it('reintegrar NO reabre el asiento anulado: sigue en anulado y sigue siendo inmutable en la BD', async () => {
    const { e, userId, entryUno } = await causadoYRechazado();
    await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId });

    const estado = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM journal_entry WHERE id = $1`, [entryUno]).then((r) => r.rows[0]!.estado),
    );
    expect(estado).toBe('anulado');

    // Y el motor sigue negando la resurrección del anulado a 'draft'.
    await expect(
      db.asAdmin((tx) => tx.query(`UPDATE journal_entry SET estado = 'draft' WHERE id = $1`, [entryUno])),
    ).rejects.toThrow();
  });
});

// =============================================================================
// B. CARRERAS — dos causaciones sobre el mismo documento reintegrado
// =============================================================================
describe('A14 · V-23 — carreras y doble procesamiento', () => {
  it('dos procesarJobCausacion sobre el documento reintegrado (saltándose la cola) dejan UN solo asiento vivo', async () => {
    const { e, userId, jobId } = await causadoYRechazado();
    const job2 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), {
      userId,
    });

    const a = await causar(e, job2.id);
    // Segundo worker, con el job ORIGINAL, invocado directo: la guardia de
    // estado ya no deja pasar (el documento salió de 'parseado').
    const b = await causar(e, jobId);

    expect(a.estado).toBe('causado');
    expect(b.estado).toBe('ya_procesado');

    const vivos = (await asientosDe(e.sourceDocumentId)).filter((x) => x.estado !== 'anulado' && x.tipo !== 'reversa');
    expect(vivos).toHaveLength(1);
  });

  it('si la guardia de estado se fuerza a mano (documento devuelto a parseado con un asiento VIVO), el UNIQUE de la BD corta', async () => {
    const { e, userId } = await causadoYRechazado();
    const job2 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), {
      userId,
    });
    const a = await causar(e, job2.id);
    if (a.estado !== 'causado') throw new Error('se esperaba causado');

    // Ataque: alguien (un bug futuro, una migración de datos) devuelve el
    // documento a 'parseado' con su asiento #2 VIVO y relanza el worker.
    await db.asAdmin((tx) => tx.query(`UPDATE source_document SET estado = 'parseado' WHERE id = $1`, [e.sourceDocumentId]));
    const jobId3 = await encolar(e);
    const c = await causar(e, jobId3);

    // Debe reconocerlo como ya procesado y devolver el asiento VIVO, no null.
    expect(c.estado).toBe('ya_procesado');
    if (c.estado === 'ya_procesado') expect(c.journalEntryId).toBe(a.journalEntryId);

    const vivos = (await asientosDe(e.sourceDocumentId)).filter((x) => x.estado !== 'anulado' && x.tipo !== 'reversa');
    expect(vivos).toHaveLength(1);
  });

  it('la cola sigue serializando: reclamarSiguienteJob no entrega dos veces el mismo trabajo', async () => {
    const { e, userId } = await causadoYRechazado();
    await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId });

    const primero = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'a14-v23-worker'));
    expect(primero).toBeTruthy();
    const segundo = await db.asAdmin((tx) => reclamarSiguienteJob(tx, 'a14-v23-worker'));
    expect(segundo?.id).not.toBe(primero?.id);
  });
});

// =============================================================================
// C. MÁQUINA DE ESTADOS
// =============================================================================
describe('A14 · V-23 — máquina de estados de la reintegración', () => {
  it('reintegrar dos veces seguidas, sin causar en medio, falla la segunda vez (ESTADO_INVALIDO)', async () => {
    const { e, userId } = await causadoYRechazado();
    await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId });
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId }),
    ).rejects.toThrow(/ESTADO_INVALIDO/);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('parseado');
  });

  it('con un asiento de causación en DRAFT vivo, el bloqueo se mantiene y el documento no se mueve', async () => {
    const e = await crearEscenario(db);
    const concepto = await conceptoNeutro(e);
    await sembrar(e, concepto, [{ descripcion: 'Servicio con draft vivo', baseGravable: 25_000_00, valorIva: 4_750_00 }]);
    const jobId = await encolar(e);
    const r = await causar(e, jobId);
    if (r.estado !== 'causado') throw new Error('se esperaba causado');
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'anómalo' WHERE id = $1`, [e.sourceDocumentId]),
    );
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId }),
    ).rejects.toThrow(/REPROCESO_BLOQUEADO/);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('rechazado');
  });

  it('con un asiento POSTED vivo, el bloqueo también se mantiene (no se recausa lo ya publicado)', async () => {
    const e = await crearEscenario(db);
    const concepto = await conceptoNeutro(e);
    await sembrar(e, concepto, [{ descripcion: 'Servicio publicado A14', baseGravable: 30_000_00, valorIva: 5_700_00 }]);
    const jobId = await encolar(e);
    const r = await causar(e, jobId);
    if (r.estado !== 'causado') throw new Error('se esperaba causado');
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: r.journalEntryId, decision: 'aprobado', userId, ip: '198.51.100.1' }),
      { userId },
    );
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'anómalo' WHERE id = $1`, [e.sourceDocumentId]),
    );
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId }),
    ).rejects.toThrow(/REPROCESO_BLOQUEADO/);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('rechazado');
  });

  it('archivado sigue siendo terminal: no se reintegra', async () => {
    const { e, userId } = await causadoYRechazado();
    await db.asTenant(e.tenantId, e.companyId, (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'duplicada'), {
      userId,
    });
    expect(await estadoDoc(e.sourceDocumentId)).toBe('archivado');
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'me arrepentí'), {
        userId,
      }),
    ).rejects.toThrow(/ESTADO_INVALIDO/);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('archivado');
  });

  it('la sub-bandeja ofrece reprocesar solo cuando el asiento quedó anulado, y lo deja de ofrecer al archivarlo', async () => {
    const { e, userId } = await causadoYRechazado();
    const antes = await db.asTenant(e.tenantId, e.companyId, (tx) => listarRechazadas(tx), { userId });
    expect(antes.find((d) => d.sourceDocumentId === e.sourceDocumentId)?.puedeReprocesar).toBe(true);

    await db.asTenant(e.tenantId, e.companyId, (tx) => archivarDocumentoRechazado(tx, e.sourceDocumentId, 'ya no'), { userId });
    const despues = await db.asTenant(e.tenantId, e.companyId, (tx) => listarRechazadas(tx), { userId });
    expect(despues.find((d) => d.sourceDocumentId === e.sourceDocumentId)).toBeUndefined();
  });
});

// =============================================================================
// D. AISLAMIENTO (RO-7) Y PERMISOS sobre la firma nueva de dos argumentos
// =============================================================================
describe('A14 · V-23 — aislamiento y permisos', () => {
  it('la sesión de otra firma no reintegra el documento ajeno, ni con motivo', async () => {
    const { e } = await causadoYRechazado();
    const otra = await crearEscenario(db);
    await expect(
      db.asTenant(otra.tenantId, otra.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'no es mío'), {
        userId: otra.userId,
      }),
    ).rejects.toThrow(/DOCUMENTO_INEXISTENTE/);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('rechazado');
  });

  it('un solo_lectura no reintegra (falta documento.reprocesar)', async () => {
    const { e } = await causadoYRechazado();
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'intento'), {
        rolCodigo: 'solo_lectura',
        sesionNueva: true,
      }),
    ).rejects.toThrow(/permiso|PERMISO/i);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('rechazado');
  });
});

// =============================================================================
// E. CASO DORADO 18 — la idempotencia clásica no se rompió
// =============================================================================
describe('A14 · V-23 — el caso dorado 18 sigue en pie', () => {
  it('reprocesar 10 veces un documento ya causado (sin rechazo) da el mismo asiento y no crea claves #n', async () => {
    const e = await crearEscenario(db);
    const concepto = await conceptoNeutro(e);
    await sembrar(e, concepto, [{ descripcion: 'Servicio idempotente A14', baseGravable: 90_000_00, valorIva: 17_100_00 }]);
    const jobId = await encolar(e);
    const primero = await causar(e, jobId);
    if (primero.estado !== 'causado') throw new Error('se esperaba causado');
    const foto = await fotoDelAsiento(primero.journalEntryId);

    for (let i = 0; i < 10; i += 1) {
      const r = await causar(e, jobId);
      expect(r.estado).toBe('ya_procesado');
      if (r.estado === 'ya_procesado') expect(r.journalEntryId).toBe(primero.journalEntryId);
    }

    expect(await fotoDelAsiento(primero.journalEntryId)).toBe(foto);
    const claves = (await asientosDe(e.sourceDocumentId)).map((x) => x.idempotency_key);
    expect(claves).toEqual([`causacion:${e.sourceDocumentId}`]);
  });
});

// =============================================================================
// F. NOTA CRÉDITO por el mismo camino
// =============================================================================
describe('A14 · V-23 — una nota crédito rechazada se recupera igual que una factura', () => {
  it('nota crédito: rechazada, reintegrada y recausada, con clave versionada y un solo asiento vivo', async () => {
    // Factura original causada y publicada.
    const e = await crearEscenario(db);
    const concepto = await conceptoNeutro(e);
    await sembrar(e, concepto, [{ descripcion: 'Servicio base de la nota', baseGravable: 100_000_00, valorIva: 19_000_00 }]);
    const jobFactura = await encolar(e);
    const causada = await causar(e, jobFactura);
    if (causada.estado !== 'causado') throw new Error('se esperaba causado');
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: causada.journalEntryId, decision: 'aprobado', userId, ip: '198.51.100.2' }),
      { userId },
    );

    // Nota crédito que referencia la factura.
    const notaId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                      emisor_nit, third_party_id, fecha_hecho_economico, hash_contenido,
                                      estado, total_neto, documento_referenciado_id)
         VALUES ($1,$2,$3,'CreditNote',$4,$5,$6,$7,'2026-06-20',$8,'parseado',59500000,$9)`,
        [
          notaId,
          e.tenantId,
          e.companyId,
          `CUFE-NC-${notaId.slice(0, 8)}`,
          `NC-${notaId.slice(0, 8)}`,
          '901000000',
          e.thirdPartyId,
          `hash-nc-${notaId}`,
          e.sourceDocumentId,
        ],
      ),
    );
    const jobNota = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, notaId), { userId: e.userId });
    const nota1 = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobNota.id, sourceDocumentId: notaId }));
    expect(nota1.estado).toBe('causado');
    if (nota1.estado !== 'causado') return;

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        aprobarAsiento(tx, {
          journalEntryId: nota1.journalEntryId,
          decision: 'rechazado',
          userId,
          ip: '198.51.100.3',
          motivo: 'nota rechazada por error',
        }),
      { userId },
    );
    expect(await estadoDoc(notaId)).toBe('rechazado');

    const jobNota2 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, notaId, 'la nota sí va'), {
      userId,
    });
    const nota2 = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobNota2.id, sourceDocumentId: notaId }));
    expect(nota2.estado).toBe('causado');
    if (nota2.estado !== 'causado') return;
    expect(nota2.journalEntryId).not.toBe(nota1.journalEntryId);

    const asientos = await asientosDe(notaId);
    expect(asientos.map((a) => a.idempotency_key)).toEqual([`causacion:${notaId}`, `causacion:${notaId}#2`]);
    expect(asientos.filter((a) => a.estado !== 'anulado')).toHaveLength(1);
  });
});

// =============================================================================
// G. DIVERGENCIA LEDGER / TRAZA — el vector caro
// =============================================================================
describe('A14 · V-23 — la traza de retenciones del intento anulado no puede contaminar la reportería', () => {
  /** Factura de honorarios PJ causada, rechazada, reintegrada, recausada y publicada. */
  async function conRetefuenteReprocesada(): Promise<{ e: Escenario; userId: string; entryVivo: string; entryAnulado: string }> {
    const e = await crearEscenario(db);
    const concepto = await conceptoConRetefuente(e);
    await sembrar(e, concepto, [{ descripcion: 'Honorarios de prueba A14 V-23', baseGravable: 200_000_00, valorIva: 0 }], {
      fecha: '2026-07-15',
    });
    const jobId = await encolar(e);
    const uno = await causar(e, jobId);
    if (uno.estado !== 'causado') throw new Error(`se esperaba causado, llegó ${uno.estado}`);
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await rechazar(e, uno.journalEntryId, userId);

    const job2 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'sí va'), {
      userId,
    });
    const dos = await causar(e, job2.id);
    if (dos.estado !== 'causado') throw new Error(`se esperaba causado, llegó ${dos.estado}`);
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: dos.journalEntryId, decision: 'aprobado', userId, ip: '198.51.100.4' }),
      { userId },
    );
    return { e, userId, entryVivo: dos.journalEntryId, entryAnulado: uno.journalEntryId };
  }

  it('el escenario deja, en efecto, DOS juegos de retention_applied aplicadas para el mismo documento', async () => {
    const { e, entryVivo, entryAnulado } = await conRetefuenteReprocesada();
    const filas = await db.asAdmin((tx) =>
      tx
        .query<{ journal_entry_id: string | null; valor: string }>(
          `SELECT journal_entry_id, valor::text FROM retention_applied
            WHERE source_document_id = $1 AND aplicada = true AND tipo = 'retefuente'`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows),
    );
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.journal_entry_id).sort()).toEqual([entryAnulado, entryVivo].sort());
    // 11% sobre $200.000 = $22.000 (caso dorado 6). Cada juego, por separado.
    for (const f of filas) expect(f.valor).toBe('2200000');
  });

  it('el CERTIFICADO DE RETENCIONES no puede certificar dos veces la misma retención', async () => {
    const { e, userId } = await conRetefuenteReprocesada();
    const filas = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => retencionesPorTercero(tx, { terceroId: e.thirdPartyId, desde: '2026-07-01', hasta: '2026-07-31' }),
      { userId },
    );
    const total = filas.reduce((acc, f) => acc + Number(f.valor), 0);
    expect(total).toBe(22_000_00);
    expect(filas).toHaveLength(1);
  });

  it('EXÓGENA (retenciones por tercero y tipo) no puede reportar el doble', async () => {
    const { e, userId } = await conRetefuenteReprocesada();
    const filas = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => retencionesPorTerceroYTipo(tx, { desde: '2026-07-01', hasta: '2026-07-31', anioGravable: 2026 }),
      { userId },
    );
    const retefuente = filas.filter((f) => f.terceroId === e.thirdPartyId && f.tipo === 'retefuente');
    expect(retefuente).toHaveLength(1);
    expect(Number(retefuente[0]!.total)).toBe(22_000_00);
    expect(retefuente[0]!.n).toBe(1);
  });

  it('el ledger publicado sí trae una sola vez la retención (control: la vista posted nunca estuvo mal)', async () => {
    const { e, entryVivo } = await conRetefuenteReprocesada();
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM v_journal_line_reporte
          WHERE source_document_id = $1 AND retention_applied_id IS NOT NULL`,
        [e.sourceDocumentId],
      ),
    );
    expect(rows[0]!.n).toBe('1');
    const { rows: dueño } = await db.asAdmin((tx) =>
      tx.query<{ journal_entry_id: string }>(
        `SELECT journal_entry_id FROM v_journal_line_reporte
          WHERE source_document_id = $1 AND retention_applied_id IS NOT NULL`,
        [e.sourceDocumentId],
      ),
    );
    expect(dueño[0]!.journal_entry_id).toBe(entryVivo);
  });
});

// =============================================================================
// G-bis. REGRESIÓN DE LOS DEFECTOS QUE A14 ENCONTRÓ Y CORRIGIÓ
// =============================================================================
describe('A14 · V-23 — regresión de V-27/V-28/V-29/V-31', () => {
  it('V-27: el índice journal_entry_causacion_viva_uq que la migración 172 documentaba EXISTE de verdad', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'journal_entry_causacion_viva_uq'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/);
    expect(rows[0]!.indexdef).toMatch(/anulado/);
  });

  it('V-27: la BASE, no la aplicación, impide un segundo asiento de causación VIVO para el mismo documento', async () => {
    const { e, entryUno } = await causadoYRechazado();
    // Se salta TODA la aplicación: INSERT directo de un segundo asiento vivo
    // con una clave de causación distinta. Sin el índice, esto pasaba.
    await expect(
      db.asAdmin(async (tx) => {
        const { rows: base } = await tx.query<{ fiscal_period_id: string; approval_id: string }>(
          `SELECT fiscal_period_id, approval_id FROM journal_entry WHERE id = $1`,
          [entryUno],
        );
        // Primero un asiento VIVO (el reproceso legítimo), luego otro más.
        for (const sufijoClave of ['#2', '#3']) {
          await tx.query(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                        descripcion, estado, source_document_id, approval_id, idempotency_key)
             VALUES ($1,$2,$3,'2026-06-15','ataque directo V-27','draft',$4,$5,$6)`,
            [
              e.tenantId,
              e.companyId,
              base[0]!.fiscal_period_id,
              e.sourceDocumentId,
              base[0]!.approval_id,
              `causacion:${e.sourceDocumentId}${sufijoClave}`,
            ],
          );
        }
      }),
    ).rejects.toThrow(/journal_entry_causacion_viva_uq/);
  });

  it('V-28: una NOTA CRÉDITO rechazada por error se reintegra y se recausa sin romper el worker', async () => {
    const e = await crearEscenario(db);
    const concepto = await conceptoNeutro(e);
    await sembrar(e, concepto, [{ descripcion: 'Servicio base V-28', baseGravable: 100_000_00, valorIva: 19_000_00 }]);
    const jobFactura = await encolar(e);
    const causada = await causar(e, jobFactura);
    if (causada.estado !== 'causado') throw new Error('se esperaba causado');
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: causada.journalEntryId, decision: 'aprobado', userId, ip: '198.51.100.5' }),
      { userId },
    );

    const notaId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                      emisor_nit, third_party_id, fecha_hecho_economico, hash_contenido,
                                      estado, total_neto, documento_referenciado_id)
         VALUES ($1,$2,$3,'CreditNote',$4,$5,$6,$7,'2026-06-20',$8,'parseado',59500000,$9)`,
        [
          notaId,
          e.tenantId,
          e.companyId,
          `CUFE-D081-${notaId.slice(0, 8)}`,
          `NC-D081-${notaId.slice(0, 8)}`,
          '901000000',
          e.thirdPartyId,
          `hash-d081-${notaId}`,
          e.sourceDocumentId,
        ],
      ),
    );
    const jobNota = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, notaId), { userId: e.userId });
    const nota1 = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobNota.id, sourceDocumentId: notaId }));
    if (nota1.estado !== 'causado') throw new Error(`se esperaba causado, llegó ${nota1.estado}`);

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        aprobarAsiento(tx, {
          journalEntryId: nota1.journalEntryId,
          decision: 'rechazado',
          userId,
          ip: '198.51.100.6',
          motivo: 'nota rechazada por error',
        }),
      { userId },
    );

    const jobNota2 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, notaId, 'sí va'), {
      userId,
    });
    const nota2 = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobNota2.id, sourceDocumentId: notaId }));
    expect(nota2.estado).toBe('causado');
    if (nota2.estado !== 'causado') return;
    expect(nota2.journalEntryId).not.toBe(nota1.journalEntryId);

    const asientos = await asientosDe(notaId);
    expect(asientos.map((a) => a.idempotency_key)).toEqual([`causacion:${notaId}`, `causacion:${notaId}#2`]);
    expect(asientos.filter((a) => a.estado !== 'anulado')).toHaveLength(1);
    // Y el asiento original de la factura sigue reversado UNA sola vez EN VIVO.
    const reversasVivas = await db.asAdmin((tx) =>
      tx
        .query<{ n: string }>(
          `SELECT count(*)::text AS n FROM journal_entry
            WHERE reverses_entry_id = $1 AND estado <> 'anulado'`,
          [causada.journalEntryId],
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(reversasVivas).toBe('1');
  });

  it('V-28: dos reversas VIVAS sobre el mismo asiento original siguen prohibidas por la base', async () => {
    const { e, entryUno } = await causadoYRechazado();
    await expect(
      db.asAdmin(async (tx) => {
        const { rows: base } = await tx.query<{ fiscal_period_id: string; approval_id: string }>(
          `SELECT fiscal_period_id, approval_id FROM journal_entry WHERE id = $1`,
          [entryUno],
        );
        for (let i = 0; i < 2; i += 1) {
          await tx.query(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                        descripcion, estado, tipo, reverses_entry_id, source_document_id,
                                        approval_id, idempotency_key)
             VALUES ($1,$2,$3,'2026-06-15','doble reversa V-28','draft','reversa',$4,$5,$6,$7)`,
            [
              e.tenantId,
              e.companyId,
              base[0]!.fiscal_period_id,
              entryUno,
              e.sourceDocumentId,
              base[0]!.approval_id,
              `reversa-d081-${i}-${e.sourceDocumentId}`,
            ],
          );
        }
      }),
    ).rejects.toThrow(/journal_entry_reversa_viva_uq/);
  });

  it('V-29: un documento que acaba en revisión manual por falta de período no deja traza de retenciones huérfana', async () => {
    const e = await crearEscenario(db);
    const concepto = await conceptoConRetefuente(e);
    // Fecha FUERA de todo período abierto de la empresa (hay 2026-06 y 2026-07).
    await sembrar(e, concepto, [{ descripcion: 'Honorarios sin período V-29', baseGravable: 200_000_00, valorIva: 0 }], {
      fecha: '2026-09-15',
    });
    const jobId = await encolar(e);
    const r = await causar(e, jobId);
    expect(r.estado).toBe('revision_manual');
    if (r.estado === 'revision_manual') {
      expect(r.motivos.map((m) => m.codigo)).toContain('sin_periodo_fiscal_abierto');
    }

    const huerfanas = await db.asAdmin((tx) =>
      tx
        .query<{ n: string }>(
          `SELECT count(*)::text AS n FROM retention_applied
            WHERE source_document_id = $1 AND journal_entry_id IS NULL`,
          [e.sourceDocumentId],
        )
        .then((x) => x.rows[0]!.n),
    );
    expect(huerfanas).toBe('0');
  });

  it('V-32: el resguardo REPROCESO_BLOQUEADO también cubre una NOTA CRÉDITO con su asiento vivo', async () => {
    const e = await crearEscenario(db);
    const concepto = await conceptoNeutro(e);
    await sembrar(e, concepto, [{ descripcion: 'Servicio base V-32', baseGravable: 100_000_00, valorIva: 19_000_00 }]);
    const jobFactura = await encolar(e);
    const causada = await causar(e, jobFactura);
    if (causada.estado !== 'causado') throw new Error('se esperaba causado');
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: causada.journalEntryId, decision: 'aprobado', userId, ip: '198.51.100.8' }),
      { userId },
    );

    const notaId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                      emisor_nit, third_party_id, fecha_hecho_economico, hash_contenido,
                                      estado, total_neto, documento_referenciado_id)
         VALUES ($1,$2,$3,'CreditNote',$4,$5,$6,$7,'2026-06-20',$8,'parseado',59500000,$9)`,
        [
          notaId,
          e.tenantId,
          e.companyId,
          `CUFE-D085-${notaId.slice(0, 8)}`,
          `NC-D085-${notaId.slice(0, 8)}`,
          '901000000',
          e.thirdPartyId,
          `hash-d085-${notaId}`,
          e.sourceDocumentId,
        ],
      ),
    );
    const jobNota = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, notaId), { userId: e.userId });
    const nota = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobNota.id, sourceDocumentId: notaId }));
    if (nota.estado !== 'causado') throw new Error(`se esperaba causado, llegó ${nota.estado}`);

    // Estado ANÓMALO: la nota queda 'rechazado' pero su asiento sigue VIVO
    // (draft). Antes de V-32 este caso se colaba: el asiento de una nota es de
    // tipo 'reversa' y el filtro `tipo <> 'reversa'` lo hacía invisible.
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'anómalo' WHERE id = $1`, [notaId]),
    );

    const rechazadas = await db.asTenant(e.tenantId, e.companyId, (tx) => listarRechazadas(tx), { userId });
    const fila = rechazadas.find((d) => d.sourceDocumentId === notaId);
    expect(fila?.puedeReprocesar).toBe(false);
    expect(fila?.motivoBloqueoReproceso).toBeTruthy();

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, notaId), { userId }),
    ).rejects.toThrow(/REPROCESO_BLOQUEADO/);
    expect(await estadoDoc(notaId)).toBe('rechazado');
  });

  it('V-31: un documento rechazado que nunca tuvo trabajo de causación se reintegra igual (y queda encolado)', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'rechazada sin causar' WHERE id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    const job = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'sin asiento'),
      { userId },
    );
    expect(job.estado).toBe('pendiente');
    expect(job.sourceDocumentId).toBe(e.sourceDocumentId);
    expect(await estadoDoc(e.sourceDocumentId)).toBe('parseado');
  });
});

// =============================================================================
// H. TRAZABILIDAD — reproceso_numero y asiento_anulado_previo
// =============================================================================
describe('A14 · V-23 — el rastro del reproceso es exacto', () => {
  async function rastroDe(docId: string): Promise<Record<string, unknown>[]> {
    return db.asAdmin((tx) =>
      tx
        .query<{ valor_nuevo: unknown }>(
          `SELECT valor_nuevo FROM audit_log
            WHERE entidad = 'source_document' AND entidad_id = $1
              AND valor_nuevo->>'estado' = 'parseado'
            ORDER BY id`,
          [docId],
        )
        .then((r) => r.rows.map((x) => (typeof x.valor_nuevo === 'string' ? JSON.parse(x.valor_nuevo) : x.valor_nuevo) as Record<string, unknown>)),
    );
  }

  it('sin ningún asiento previo (rechazo sin causar), reproceso_numero = 0 y asiento_anulado_previo = null', async () => {
    const e = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'rechazada sin causar' WHERE id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'sin asiento'), {
      userId,
    });
    const rastro = await rastroDe(e.sourceDocumentId);
    expect(rastro).toHaveLength(1);
    expect(rastro[0]!.reproceso_numero).toBe(0);
    expect(rastro[0]!.asiento_anulado_previo).toBeNull();
    expect(rastro[0]!.desde_estado).toBe('rechazado');
    expect(rastro[0]!.motivo).toBe('sin asiento');
  });

  it('con 1 y luego 2 anulados, el número crece y siempre apunta al último anulado', async () => {
    const { e, userId, entryUno } = await causadoYRechazado();

    const job2 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'r1'), {
      userId,
    });
    const dos = await causar(e, job2.id);
    if (dos.estado !== 'causado') throw new Error('se esperaba causado');
    await rechazar(e, dos.journalEntryId, userId, 'otra vez no');

    const job3 = await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'r2'), {
      userId,
    });
    const tres = await causar(e, job3.id);
    if (tres.estado !== 'causado') throw new Error('se esperaba causado');

    const rastro = await rastroDe(e.sourceDocumentId);
    expect(rastro).toHaveLength(2);
    expect(rastro[0]!.reproceso_numero).toBe(1);
    expect(rastro[0]!.asiento_anulado_previo).toBe(entryUno);
    expect(rastro[1]!.reproceso_numero).toBe(2);
    expect(rastro[1]!.asiento_anulado_previo).toBe(dos.journalEntryId);

    const claves = (await asientosDe(e.sourceDocumentId)).map((x) => x.idempotency_key);
    expect(claves).toEqual([
      `causacion:${e.sourceDocumentId}`,
      `causacion:${e.sourceDocumentId}#2`,
      `causacion:${e.sourceDocumentId}#3`,
    ]);
  });

  it('el motivo vacío o en blanco se guarda como null, no como cadena vacía', async () => {
    const { e, userId } = await causadoYRechazado();
    await db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId, '   '), { userId });
    const rastro = await rastroDe(e.sourceDocumentId);
    expect(rastro[0]!.motivo).toBeNull();
  });
});

// =============================================================================
// I. REGLA DE ORO 2 sobre lo que tocó el fix
// =============================================================================
describe('A14 · V-23 — RO-2 sobre los archivos del fix', () => {
  const ARCHIVOS = [
    'db/migrations/172_a3a2_v23_reproceso_rechazadas.sql',
    'src/services/causacion.ts',
    'src/services/bandeja.ts',
    'app/bandeja/acciones.ts',
  ];

  it('ningún archivo tocado por V-23 introduce un literal que parezca tarifa, UVT o salario mínimo', () => {
    const sospechosos: string[] = [];
    for (const rel of ARCHIVOS) {
      const ruta = fileURLToPath(new URL(`../../${rel}`, import.meta.url));
      const texto = readFileSync(ruta, 'utf8');
      texto.split('\n').forEach((linea, i) => {
        // Tarifas en decimal (0.04, 0.11...) y magnitudes de UVT / SMMLV.
        if (/\b0\.(0[1-9]|1[0-9]|2[0-9]|3[0-9])\b/.test(linea)) sospechosos.push(`${rel}:${i + 1}: ${linea.trim()}`);
        if (/\b(52[._]?374|47[._]?065|1[._]?423[._]?500)\b/.test(linea)) sospechosos.push(`${rel}:${i + 1}: ${linea.trim()}`);
        if (/\b\d+\s*%/.test(linea) && !/^\s*(\*|\/\/|--)/.test(linea)) sospechosos.push(`${rel}:${i + 1}: ${linea.trim()}`);
      });
    }
    expect(sospechosos).toEqual([]);
  });
});

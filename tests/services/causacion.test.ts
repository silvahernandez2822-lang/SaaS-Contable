/**
 * A6 — Causación, aprobación, aprobación en lote y reversa (entregable 2).
 *
 * Escenario deliberadamente simple en materia tributaria (concepto con los
 * cuatro `aplica_*` en false): lo que se prueba aquí es la MECÁNICA de A6
 * (construcción del asiento, idempotencia, ciclo de aprobación, reversa), no
 * el motor de A3 — eso lo prueba `tests/golden/casos-dorados.test.ts`. Con
 * `aplica_*` en false, `resolverFactura` devuelve cero retenciones evaluadas
 * y `requiereRevisionManual = false` sin necesitar ninguna `tax_rule` de A1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { SQLSTATE } from '../../src/db/types';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import {
  aprobarAsiento,
  aprobarAsientosEnLote,
  procesarJobCausacion,
  reversarAsientoPublicado,
} from '../../src/services/causacion';
import { encolarCausacion, reclamarSiguienteJob } from '../../src/services/cola';
import { listarRechazadas, reintegrarDocumentoRechazado } from '../../src/services/bandeja';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

interface LineaPrueba {
  descripcion: string;
  baseGravable: number;
  valorIva: number;
}

/** Concepto sin ninguna retención activa: aísla la mecánica contable de A6 del motor de A3. */
async function crearConceptoSimple(
  e: Escenario,
  cuentaGasto: string,
): Promise<string> {
  return db.asAdmin(async (tx) => {
    const id = uuid();
    await tx.query(
      `INSERT INTO concepto_causacion (
         id, tenant_id, company_id, codigo, nombre, naturaleza,
         cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
         aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
       VALUES ($1,$2,$3,$4,'Concepto de prueba de A6','compra',$5,$6,$7,false,false,false,false)`,
      [id, e.tenantId, e.companyId, `A6-${id.slice(0, 8)}`, cuentaGasto, e.cuentas.ivaDescontable, e.cuentas.proveedores],
    );
    return id;
  });
}

async function sembrarMemoria(e: Escenario, descripcion: string, conceptoId: string): Promise<void> {
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [e.tenantId, e.companyId, e.thirdPartyId, descripcion.toLowerCase().trim(), conceptoId],
    ),
  );
}

async function sembrarExtraccionYPreparar(e: Escenario, lineas: LineaPrueba[]): Promise<void> {
  const datosExtraidos = {
    tipoDocumento: 'Invoice',
    emisor: { nit: '900123456', nombre: 'Proveedor de prueba' },
    adquirente: { nit: null, nombre: null },
    lineas: lineas.map((l, i) => ({
      numero: i + 1,
      descripcion: l.descripcion,
      subtotal: String(l.baseGravable),
      impuestos: l.valorIva > 0 ? [{ codigo: '01', valor: String(l.valorIva) }] : [],
    })),
  };
  await db.asAdmin(async (tx) => {
    await tx.query(`UPDATE source_document SET estado = 'parseado' WHERE id = $1`, [e.sourceDocumentId]);
    await tx.query(
      `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
       VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
      [e.tenantId, e.companyId, e.sourceDocumentId, JSON.stringify(datosExtraidos)],
    );
  });
}

/** Monta un escenario listo para causar: escenario base + concepto + memoria + extracción + trabajo encolado. */
async function montarEscenarioCausacion(
  lineas: LineaPrueba[],
  opciones: { conceptosPorLinea?: string[] } = {},
): Promise<{ e: Escenario; conceptoIds: string[]; jobId: string }> {
  const e = await crearEscenario(db);
  const conceptoIds: string[] = [];
  if (opciones.conceptosPorLinea) {
    conceptoIds.push(...opciones.conceptosPorLinea);
  } else {
    conceptoIds.push(await crearConceptoSimple(e, e.cuentas.gasto));
  }
  for (let i = 0; i < lineas.length; i += 1) {
    const conceptoId = conceptoIds[Math.min(i, conceptoIds.length - 1)]!;
    await sembrarMemoria(e, lineas[i]!.descripcion, conceptoId);
  }
  await sembrarExtraccionYPreparar(e, lineas);
  const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
  return { e, conceptoIds, jobId: job.id };
}

describe('procesarJobCausacion — causación simple, sin retenciones activas', () => {
  it('construye un asiento borrador balanceado: débito gasto+iva, crédito contrapartida', async () => {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Servicios de consultoría de prueba', baseGravable: 100_000_00, valorIva: 19_000_00 },
    ]);

    const resultado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
    expect(resultado.estado).toBe('causado');
    if (resultado.estado !== 'causado') return;

    const { rows: balance } = await db.asAdmin((tx) =>
      tx.query<{ partidas: string; total_debito: string; total_credito: string; descuadre: string; estado: string }>(
        `SELECT partidas::text, total_debito::text, total_credito::text, descuadre::text, estado
           FROM v_journal_entry_balance WHERE journal_entry_id = $1`,
        [resultado.journalEntryId],
      ),
    );
    expect(balance[0]).toMatchObject({ partidas: '3', descuadre: '0', estado: 'draft' });
    expect(balance[0]?.total_debito).toBe('11900000');
    expect(balance[0]?.total_credito).toBe('11900000');

    const { rows: doc } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId]),
    );
    expect(doc[0]?.estado).toBe('pendiente_aprobacion');

    const { rows: job } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM document_processing_job WHERE id = $1`, [jobId]),
    );
    expect(job[0]?.estado).toBe('completado');
  });

  it('factura con 3 líneas de conceptos distintos: un débito de gasto por concepto y un solo crédito de contrapartida', async () => {
    const e = await crearEscenario(db);
    const cuentaGasto2 = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,'513510','Gasto 2 de prueba',4,'debito',true) RETURNING id`,
        [e.tenantId, e.companyId],
      );
      return rows[0]!.id;
    });
    const cuentaGasto3 = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,'513515','Gasto 3 de prueba',4,'debito',true) RETURNING id`,
        [e.tenantId, e.companyId],
      );
      return rows[0]!.id;
    });

    const c1 = await crearConceptoSimple(e, e.cuentas.gasto);
    const c2 = await crearConceptoSimple(e, cuentaGasto2);
    const c3 = await crearConceptoSimple(e, cuentaGasto3);

    const lineas: LineaPrueba[] = [
      { descripcion: 'Concepto uno de la factura', baseGravable: 100_000_00, valorIva: 19_000_00 },
      { descripcion: 'Concepto dos de la factura', baseGravable: 200_000_00, valorIva: 38_000_00 },
      { descripcion: 'Concepto tres de la factura', baseGravable: 50_000_00, valorIva: 9_500_00 },
    ];
    for (let i = 0; i < lineas.length; i += 1) {
      await sembrarMemoria(e, lineas[i]!.descripcion, [c1, c2, c3][i]!);
    }
    await sembrarExtraccionYPreparar(e, lineas);
    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));

    const resultado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(resultado.estado).toBe('causado');
    if (resultado.estado !== 'causado') return;

    const { rows: lineasAsiento } = await db.asAdmin((tx) =>
      tx.query<{ account_id: string; side: string; monto: string }>(
        `SELECT account_id, side, monto::text FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`,
        [resultado.journalEntryId],
      ),
    );
    // 3 débitos de gasto + 3 débitos de IVA + 1 crédito de contrapartida.
    expect(lineasAsiento).toHaveLength(7);
    const debitos = lineasAsiento.filter((l) => l.side === 'debito');
    const creditos = lineasAsiento.filter((l) => l.side === 'credito');
    expect(debitos).toHaveLength(6);
    expect(creditos).toHaveLength(1);
    expect(creditos[0]).toMatchObject({ account_id: e.cuentas.proveedores, monto: '41650000' });

    const { rows: balance } = await db.asAdmin((tx) =>
      tx.query<{ descuadre: string }>(`SELECT descuadre::text FROM v_journal_entry_balance WHERE journal_entry_id = $1`, [
        resultado.journalEntryId,
      ]),
    );
    expect(balance[0]?.descuadre).toBe('0');
  });

  it('reprocesar el mismo documento no crea un segundo asiento (caso dorado 18)', async () => {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Servicio repetible de prueba', baseGravable: 50_000_00, valorIva: 9_500_00 },
    ]);

    const primero = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(primero.estado).toBe('causado');

    // El job ya está 'completado'; se simula un reencolado/reintento manual
    // llamando otra vez procesarJobCausacion con el MISMO source_document.
    const segundo = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(segundo.estado).toBe('ya_procesado');
    if (primero.estado !== 'causado' || segundo.estado !== 'ya_procesado') return;
    expect(segundo.journalEntryId).toBe(primero.journalEntryId);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM journal_entry WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      ),
    );
    expect(rows[0]?.total).toBe('1');
  });

  it('sin concepto confirmado en memoria_clasificacion: va a revisión manual, no causa nada', async () => {
    const e = await crearEscenario(db);
    await crearConceptoSimple(e, e.cuentas.gasto); // existe el concepto, pero nadie lo confirmó en memoria.
    await sembrarExtraccionYPreparar(e, [
      { descripcion: 'Línea nunca antes vista', baseGravable: 10_000_00, valorIva: 1_900_00 },
    ]);
    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));

    const resultado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(resultado.estado).toBe('revision_manual');
    if (resultado.estado !== 'revision_manual') return;
    expect(resultado.motivos[0]?.codigo).toBe('sin_clasificacion_automatica');

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(`SELECT count(*)::text AS total FROM journal_entry WHERE source_document_id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    expect(rows[0]?.total).toBe('0');

    const { rows: doc } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId]),
    );
    expect(doc[0]?.estado).toBe('parseado'); // no avanzó: sigue esperando clasificación.
  });
});

describe('aprobarAsiento — decisión humana, publica solo si aprueba', () => {
  /** Causa un SEGUNDO documento sobre la MISMA empresa de `e` (para probar el lote sin mezclar firmas). */
  async function causarSegundoDocumentoEnEmpresa(
    e: Escenario,
    linea: LineaPrueba,
  ): Promise<{ journalEntryId: string }> {
    const sourceDocumentId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                      emisor_nit, third_party_id, fecha_hecho_economico, hash_contenido, estado)
         VALUES ($1,$2,$3,'Invoice',$4,$5,$6,$7,'2026-06-15',$8,'parseado')`,
        [
          sourceDocumentId,
          e.tenantId,
          e.companyId,
          `CUFE-lote-${sourceDocumentId}`,
          `FE-lote-${sourceDocumentId}`,
          `901-lote-${sourceDocumentId.slice(0, 8)}`,
          e.thirdPartyId,
          `hash-lote-${sourceDocumentId}`,
        ],
      ),
    );
    const conceptoId = await crearConceptoSimple(e, e.cuentas.gasto);
    await sembrarMemoria(e, linea.descripcion, conceptoId);
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
         VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
        [
          e.tenantId,
          e.companyId,
          sourceDocumentId,
          JSON.stringify({
            tipoDocumento: 'Invoice',
            emisor: { nit: '900123456', nombre: 'Proveedor de prueba' },
            adquirente: { nit: null, nombre: null },
            lineas: [
              {
                numero: 1,
                descripcion: linea.descripcion,
                subtotal: String(linea.baseGravable),
                impuestos: linea.valorIva > 0 ? [{ codigo: '01', valor: String(linea.valorIva) }] : [],
              },
            ],
          }),
        ],
      ),
    );
    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, sourceDocumentId));
    const resultado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: job.id, sourceDocumentId }));
    if (resultado.estado !== 'causado') throw new Error('se esperaba causado');
    return { journalEntryId: resultado.journalEntryId };
  }

  async function causarYObtenerEntry(): Promise<{ e: Escenario; journalEntryId: string; userId: string }> {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Línea para aprobar', baseGravable: 80_000_00, valorIva: 15_200_00 },
    ]);
    const resultado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (resultado.estado !== 'causado') throw new Error('se esperaba causado');
    const sesion = await db.emitirSesion(e.tenantId, e.companyId);
    return { e, journalEntryId: resultado.journalEntryId, userId: sesion.userId };
  }

  it('aprobar publica el asiento (transición, no INSERT ya publicado) y marca el documento causado', async () => {
    const { e, journalEntryId, userId } = await causarYObtenerEntry();

    const aprobacion = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, { journalEntryId, decision: 'aprobado', userId, ip: '10.0.0.5' }),
    );
    expect(aprobacion.publicado).toBe(true);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; posted_at: string | null }>(
        `SELECT estado, posted_at FROM journal_entry WHERE id = $1`,
        [journalEntryId],
      ),
    );
    expect(rows[0]?.estado).toBe('posted');
    expect(rows[0]?.posted_at).not.toBeNull();

    const { rows: doc } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId]),
    );
    expect(doc[0]?.estado).toBe('causado');
  });

  it('rechazar anula el borrador sin publicarlo', async () => {
    const { e, journalEntryId, userId } = await causarYObtenerEntry();

    const rechazo = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, {
        journalEntryId,
        decision: 'rechazado',
        userId,
        ip: '10.0.0.5',
        motivo: 'Datos incorrectos de prueba',
      }),
    );
    expect(rechazo.publicado).toBe(false);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM journal_entry WHERE id = $1`, [journalEntryId]),
    );
    expect(rows[0]?.estado).toBe('anulado');
  });

  it('exige causacion.aprobar: un auxiliar de causación no puede aprobar (SE002 lo respalda la BD; aquí falla antes, limpio)', async () => {
    const { e, journalEntryId } = await causarYObtenerEntry();
    const sesionAuxiliar = await db.emitirSesion(e.tenantId, e.companyId, { rolCodigo: 'auxiliar_causacion' });

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => aprobarAsiento(tx, { journalEntryId, decision: 'aprobado', userId: sesionAuxiliar.userId }),
        { rolCodigo: 'auxiliar_causacion' },
      ),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string }>(`SELECT estado FROM journal_entry WHERE id = $1`, [journalEntryId]),
    );
    expect(rows[0]?.estado).toBe('draft'); // el intento fallido no dejó nada a medias.
  });

  it('aprobarAsientosEnLote aprueba varios asientos de un golpe, con un lote_id compartido', async () => {
    // Contrato con A7 (ver docs/reportes/ola1-a6.md): un lote opera sobre UNA
    // empresa por llamada — aquí, dos facturas de la MISMA empresa aprobadas
    // en un solo golpe, que es exactamente lo que pide la sección 4.
    const uno = await causarYObtenerEntry();
    const dosEntry = await causarSegundoDocumentoEnEmpresa(uno.e, {
      descripcion: 'Segunda línea del lote',
      baseGravable: 40_000_00,
      valorIva: 7_600_00,
    });
    const sesion = await db.emitirSesion(uno.e.tenantId, uno.e.companyId);

    const resultado = await db.asTenant(uno.e.tenantId, uno.e.companyId, (tx) =>
      aprobarAsientosEnLote(tx, {
        items: [
          { journalEntryId: uno.journalEntryId, decision: 'aprobado' },
          { journalEntryId: dosEntry.journalEntryId, decision: 'aprobado' },
        ],
        userId: sesion.userId,
        ip: '10.0.0.5',
      }),
    );
    expect(resultado.resultados).toHaveLength(2);
    expect(resultado.resultados.every((r) => 'publicado' in r && r.publicado)).toBe(true);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(`SELECT count(*)::text AS total FROM approval WHERE lote_id = $1`, [
        resultado.loteId,
      ]),
    );
    expect(rows[0]?.total).toBe('2');
  });

  it('un fallo en un ítem del lote no arrastra a los demás', async () => {
    const uno = await causarYObtenerEntry();
    const sesion = await db.emitirSesion(uno.e.tenantId, uno.e.companyId);

    const resultado = await db.asTenant(uno.e.tenantId, uno.e.companyId, (tx) =>
      aprobarAsientosEnLote(tx, {
        items: [
          { journalEntryId: uno.journalEntryId, decision: 'aprobado' },
          { journalEntryId: uuid(), decision: 'aprobado' }, // no existe en el contexto actual.
        ],
        userId: sesion.userId,
        ip: '10.0.0.5',
      }),
    );
    expect(resultado.resultados).toHaveLength(2);
    expect('publicado' in resultado.resultados[0]! && resultado.resultados[0]!.publicado).toBe(true);
    expect('error' in resultado.resultados[1]!).toBe(true);
  });
});

describe('reversarAsientoPublicado — Regla de Oro 1: toda corrección va por reversa', () => {
  it('reversa un asiento publicado con las partidas invertidas, como borrador a la espera de aprobación', async () => {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Línea a reversar', baseGravable: 60_000_00, valorIva: 11_400_00 },
    ]);
    const causado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (causado.estado !== 'causado') throw new Error('se esperaba causado');
    const sesion = await db.emitirSesion(e.tenantId, e.companyId);
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, {
        journalEntryId: causado.journalEntryId,
        decision: 'aprobado',
        userId: sesion.userId,
        ip: '10.0.0.5',
      }),
    );

    const { journalEntryId: reversaId } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      reversarAsientoPublicado(tx, { journalEntryId: causado.journalEntryId, motivo: 'Corrección de prueba' }),
    );

    const { rows: reversa } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; tipo: string; reverses_entry_id: string }>(
        `SELECT estado, tipo, reverses_entry_id FROM journal_entry WHERE id = $1`,
        [reversaId],
      ),
    );
    expect(reversa[0]).toMatchObject({ estado: 'draft', tipo: 'reversa', reverses_entry_id: causado.journalEntryId });

    const { rows: lineasOriginal } = await db.asAdmin((tx) =>
      tx.query<{ account_id: string; side: string; monto: string }>(
        `SELECT account_id, side, monto::text FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`,
        [causado.journalEntryId],
      ),
    );
    const { rows: lineasReversa } = await db.asAdmin((tx) =>
      tx.query<{ account_id: string; side: string; monto: string }>(
        `SELECT account_id, side, monto::text FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`,
        [reversaId],
      ),
    );
    expect(lineasReversa).toHaveLength(lineasOriginal.length);
    for (const original of lineasOriginal) {
      const invertida = lineasReversa.find((l) => l.account_id === original.account_id);
      expect(invertida).toMatchObject({
        monto: original.monto,
        side: original.side === 'debito' ? 'credito' : 'debito',
      });
    }

    // Publicarla es una aprobación más: se prueba que la reversa aprobada
    // queda visible como reversa del original en v_journal_entry.
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, { journalEntryId: reversaId, decision: 'aprobado', userId: sesion.userId, ip: '10.0.0.5' }),
    );
    const { rows: vista } = await db.asAdmin((tx) =>
      tx.query<{ reversed_by: string }>(`SELECT reversed_by FROM v_journal_entry WHERE id = $1`, [
        causado.journalEntryId,
      ]),
    );
    expect(vista[0]?.reversed_by).toBe(reversaId);
  });

  it('falla limpio si se intenta reversar un asiento que NO está publicado', async () => {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Línea de borrador sin aprobar', baseGravable: 20_000_00, valorIva: 3_800_00 },
    ]);
    const causado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (causado.estado !== 'causado') throw new Error('se esperaba causado');

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        reversarAsientoPublicado(tx, { journalEntryId: causado.journalEntryId, motivo: 'no debería funcionar' }),
      ),
    ).rejects.toThrow(/solo se reversa lo publicado/);
  });

  it('LA GARANTÍA REAL la impone la BD: publicar un asiento que reversa algo no publicado falla con LG008', async () => {
    // Se salta el servicio a propósito para demostrar que el rechazo viene
    // del motor (LG008), no de un `if` de TypeScript (D-003).
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Original para el vector adversarial', baseGravable: 30_000_00, valorIva: 5_700_00 },
    ]);
    const original = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (original.estado !== 'causado') throw new Error('se esperaba causado');
    // El original queda en 'draft' (nunca se aprobó): reversarlo es inválido.

    // La validación de LG008 es un CONSTRAINT TRIGGER DEFERRABLE (se evalúa
    // en el COMMIT, no en el UPDATE): por eso `esperarErrorPg` envuelve la
    // transacción COMPLETA (`db.asAdmin(...)`), igual que hacen las pruebas
    // de LG002/LG003 de la Ola 0 — el rechazo llega cuando esa transacción
    // intenta comitear al terminar el callback, no antes.
    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          const { rows: entry } = await tx.query<{ fiscal_period_id: string }>(
            `SELECT fiscal_period_id FROM journal_entry WHERE id = $1`,
            [original.journalEntryId],
          );
          // Una aprobación 'aprobado' de verdad, para aislar LG008: si se
          // reutilizara el placeholder 'devuelto' del borrador automático, el
          // motor rechazaría antes por LG006 (sin aprobación) y no probaría
          // lo que este vector busca (que el guardia de la REVERSA, no el de
          // la aprobación, es el que dispara).
          const { rows: aprob } = await tx.query<{ id: string }>(
            `INSERT INTO approval (tenant_id, company_id, entidad, entidad_id, source_document_id, decision, user_id, ip)
             VALUES ($1,$2,'journal_entry',$3,$4,'aprobado',$5,'127.0.0.1') RETURNING id`,
            [e.tenantId, e.companyId, original.journalEntryId, e.sourceDocumentId, e.userId],
          );
          const reversaId = uuid();
          await tx.query(
            `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, tipo, fecha_hecho_economico,
                                        descripcion, estado, source_document_id, approval_id, reverses_entry_id, idempotency_key)
             VALUES ($1,$2,$3,$4,'reversa','2026-06-15','reversa adversarial','draft',$5,$6,$7,$8)`,
            [
              reversaId,
              e.tenantId,
              e.companyId,
              entry[0]!.fiscal_period_id,
              e.sourceDocumentId,
              aprob[0]!.id,
              original.journalEntryId,
              `adversarial-${reversaId}`,
            ],
          );
          await tx.query(
            `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
             VALUES ($1,$2,$3,1,$4,'debito',100)`,
            [e.tenantId, e.companyId, reversaId, e.cuentas.gasto],
          );
          await tx.query(
            `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
             VALUES ($1,$2,$3,2,$4,'credito',100)`,
            [e.tenantId, e.companyId, reversaId, e.cuentas.proveedores],
          );
          await tx.query('SELECT app.publicar_asiento($1, $2)', [reversaId, e.userId]);
        }),
      SQLSTATE.REVERSA_INVALIDA,
      'publicar una reversa cuyo original nunca se publicó',
    );
  });
});

// =============================================================================
// V-23 — una factura rechazada por error se recupera (A3 + A2)
// =============================================================================
describe('V-23 · reproceso de una rechazada: idempotency_key versionada + transición auditada', () => {
  async function causarRechazarReintegrar(): Promise<{
    e: Escenario;
    userId: string;
    entryUno: string;
  }> {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Servicio recuperable de prueba', baseGravable: 40_000_00, valorIva: 7_600_00 },
    ]);
    const primero = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (primero.estado !== 'causado') throw new Error('se esperaba causado');
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);

    // El revisor la rechaza por error: el borrador se anula, el documento
    // queda 'rechazado', la clave `causacion:<doc>` sigue en el asiento anulado.
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, {
        journalEntryId: primero.journalEntryId,
        decision: 'rechazado',
        ip: '198.51.100.7',
        userId,
        motivo: 'rechazada por error del revisor',
      }),
    );
    return { e, userId, entryUno: primero.journalEntryId };
  }

  it('la sub-bandeja ofrece reprocesar (el asiento anulado ya no bloquea)', async () => {
    const { e, userId } = await causarRechazarReintegrar();
    const rechazadas = await db.asTenant(e.tenantId, e.companyId, (tx) => listarRechazadas(tx), { userId });
    const fila = rechazadas.find((d) => d.sourceDocumentId === e.sourceDocumentId)!;
    expect(fila.puedeReprocesar).toBe(true);
    expect(fila.motivoBloqueoReproceso).toBeNull();
  });

  it('reintegrar + recausar produce un SEGUNDO asiento con clave versionada, y el anulado queda intacto', async () => {
    const { e, userId, entryUno } = await causarRechazarReintegrar();

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'el proveedor confirmó que la factura sí va'),
    );

    const estadoTrasReintegrar = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId])
        .then((r) => r.rows[0]!.estado),
    );
    expect(estadoTrasReintegrar).toBe('parseado');

    const segundo = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(segundo.estado).toBe('causado');
    if (segundo.estado !== 'causado') return;
    expect(segundo.journalEntryId).not.toBe(entryUno);

    const asientos = await db.asAdmin((tx) =>
      tx
        .query<{ id: string; estado: string; idempotency_key: string }>(
          `SELECT id, estado, idempotency_key FROM journal_entry
            WHERE source_document_id = $1 AND idempotency_key LIKE 'causacion:%'
            ORDER BY created_at`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows),
    );
    expect(asientos).toHaveLength(2);
    expect(asientos[0]).toMatchObject({ id: entryUno, estado: 'anulado', idempotency_key: `causacion:${e.sourceDocumentId}` });
    expect(asientos[1]).toMatchObject({ estado: 'draft', idempotency_key: `causacion:${e.sourceDocumentId}#2` });

    // Solo un asiento de causación VIVO.
    const vivos = asientos.filter((a) => a.estado !== 'anulado');
    expect(vivos).toHaveLength(1);

    // El documento vuelve a estar pendiente de aprobación: se puede aprobar y publicar.
    const docEstado = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId])
        .then((r) => r.rows[0]!.estado),
    );
    expect(docEstado).toBe('pendiente_aprobacion');
  });

  it('el reproceso queda trazado en audit_log: quién, desde qué estado, qué asiento anulado quedó atrás', async () => {
    const { e, userId, entryUno } = await causarRechazarReintegrar();
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'motivo trazable'),
    );

    const fila = await db.asAdmin((tx) =>
      tx
        .query<{ user_id: string | null; valor_anterior: unknown; valor_nuevo: unknown }>(
          `SELECT user_id, valor_anterior, valor_nuevo FROM audit_log
            WHERE entidad = 'source_document' AND entidad_id = $1
              AND valor_nuevo->>'estado' = 'parseado'
            ORDER BY id DESC LIMIT 1`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows[0]),
    );
    expect(fila).toBeTruthy();
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>;
    expect(fila!.user_id).toBe(userId);
    expect(j(fila!.valor_nuevo).desde_estado).toBe('rechazado');
    expect(j(fila!.valor_nuevo).asiento_anulado_previo).toBe(entryUno);
    expect(j(fila!.valor_nuevo).reproceso_numero).toBe(1);
    expect(j(fila!.valor_nuevo).motivo).toBe('motivo trazable');
  });

  it('el resguardo se mantiene: reintegrar con un asiento de causación VIVO (no anulado) sigue bloqueado', async () => {
    const { e, jobId } = await montarEscenarioCausacion([
      { descripcion: 'Servicio con asiento vivo', baseGravable: 25_000_00, valorIva: 4_750_00 },
    ]);
    const causado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (causado.estado !== 'causado') throw new Error('se esperaba causado');
    // Forzamos el estado anómalo: documento 'rechazado' pero el asiento sigue 'draft'.
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = 'anómalo' WHERE id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId);
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => reintegrarDocumentoRechazado(tx, e.sourceDocumentId), { userId }),
    ).rejects.toThrow(/REPROCESO_BLOQUEADO/);

    const estado = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string }>(`SELECT estado FROM source_document WHERE id = $1`, [e.sourceDocumentId])
        .then((r) => r.rows[0]!.estado),
    );
    expect(estado).toBe('rechazado');
  });

  it('reprocesar dos veces: cada rechazo-reintegración versiona la clave (#2, #3) y nunca hay dos asientos vivos', async () => {
    const { e, userId } = await causarRechazarReintegrar();

    // Primer reproceso -> #2, y lo rechazamos otra vez.
    const job2 = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'reproceso 1'),
    );
    const seg = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job2.id, sourceDocumentId: e.sourceDocumentId }),
    );
    if (seg.estado !== 'causado') throw new Error('se esperaba causado');
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, {
        journalEntryId: seg.journalEntryId,
        decision: 'rechazado',
        userId,
        ip: '198.51.100.7',
        motivo: 'otra vez no',
      }),
    );

    // Segundo reproceso -> #3.
    const job3 = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      reintegrarDocumentoRechazado(tx, e.sourceDocumentId, 'reproceso 2'),
    );
    const ter = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job3.id, sourceDocumentId: e.sourceDocumentId }),
    );
    if (ter.estado !== 'causado') throw new Error('se esperaba causado');

    const asientos = await db.asAdmin((tx) =>
      tx
        .query<{ estado: string; idempotency_key: string }>(
          `SELECT estado, idempotency_key FROM journal_entry
            WHERE source_document_id = $1 AND idempotency_key LIKE 'causacion:%'
            ORDER BY created_at`,
          [e.sourceDocumentId],
        )
        .then((r) => r.rows),
    );
    expect(asientos.map((a) => a.idempotency_key)).toEqual([
      `causacion:${e.sourceDocumentId}`,
      `causacion:${e.sourceDocumentId}#2`,
      `causacion:${e.sourceDocumentId}#3`,
    ]);
    expect(asientos.filter((a) => a.estado !== 'anulado')).toHaveLength(1);
  });
});

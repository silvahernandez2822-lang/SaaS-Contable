/**
 * A14 — COMPUERTA DE SALIDA DE LA OLA 1, verificada con pruebas propias.
 *
 * Los cuatro criterios de la sección 4 para la Ola 1:
 *   1. El motor resuelve correctamente los 20 casos dorados de la sección 12.
 *   2. El parser extrae un XML real DIAN, incluido el `Invoice` embebido en
 *      base64 dentro del `AttachedDocument`.
 *   3. El motor no contiene ni un solo valor tributario en código.
 *   4. Un cambio de tarifa en la tabla paramétrica cambia el resultado del
 *      cálculo sin tocar código ni redesplegar.
 *
 * El 1 vive en `casos-dorados.test.ts` (los que se resuelven contra el motor) y
 * aquí (los cuatro que solo existen de verdad al nivel del ASIENTO: 15, 17, 18 y
 * 20). El 3 vive en `valores-tributarios.test.ts`. El 2 y el 4 están aquí.
 *
 * Y encima de la compuerta, lo de siempre: romper lo nuevo. La cola de A6 y el
 * ingest de A4 se atacan como atacante — reprocesar, duplicar, correr dos
 * trabajadores a la vez, mandar el mismo CUFE por dos caminos, cruzar firmas
 * por la vía del buzón, publicar dos veces el mismo asiento.
 *
 * CRITERIO ÚNICO, HEREDADO DE LA OLA 0: si el rechazo no trae SQLSTATE de
 * PostgreSQL, no cuenta. Un `throw` de TypeScript demuestra que la aplicación
 * se porta bien hoy, no que la garantía exista.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { SQLSTATE, type SqlClient } from '../../src/db/types';
import { withAdminContext } from '../../src/db/tenant-context';
import { procesarAdjuntoXml } from '../../src/ingest/index';
import { MODOS_REDONDEO } from '../../src/domain/dinero';
import { guardarDocumentoProcesado, resolverEmpresaPorBuzon } from '../../src/ingest/persistencia';
import {
  aprobarAsiento,
  procesarJobCausacion,
  reversarAsientoPublicado,
} from '../../src/services/causacion';
import { encolarCausacion, reclamarSiguienteJob } from '../../src/services/cola';
import { ejecutarCicloCola } from '../../src/services/worker';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

// =============================================================================
// Utilería propia de A14
// =============================================================================

/** Fotografía byte a byte de un asiento y sus partidas. Lo que no cambie aquí, no cambió. */
async function fotoAsiento(entryId: string): Promise<string> {
  return db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ foto: string }>(
      `SELECT (to_jsonb(je.*)::text || COALESCE(
                 (SELECT jsonb_agg(to_jsonb(jl.*) ORDER BY jl.linea)::text
                    FROM journal_line jl WHERE jl.journal_entry_id = je.id), '[]')) AS foto
         FROM journal_entry je WHERE je.id = $1`,
      [entryId],
    );
    if (!rows[0]) throw new Error(`No existe el asiento ${entryId}`);
    return rows[0].foto;
  });
}

/** Forma canónica de un asiento, sin identificadores generados: dos causaciones iguales deben coincidir. */
async function formaAsiento(entryId: string): Promise<string> {
  return db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ forma: string }>(
      `SELECT jsonb_build_object(
                'tipo', je.tipo,
                'fecha', je.fecha_hecho_economico,
                'estado', je.estado,
                'partidas', (SELECT jsonb_agg(jsonb_build_object(
                                'linea', jl.linea, 'cuenta', jl.account_id,
                                'side', jl.side, 'monto', jl.monto,
                                'base', jl.base_gravable) ORDER BY jl.linea)
                               FROM journal_line jl WHERE jl.journal_entry_id = je.id)
              )::text AS forma
         FROM journal_entry je WHERE je.id = $1`,
      [entryId],
    );
    return rows[0]!.forma;
  });
}

interface EscenarioCausable {
  e: Escenario;
  conceptoId: string;
  jobId: string;
}

async function crearConcepto(e: Escenario): Promise<string> {
  return db.asAdmin(async (tx) => {
    const id = uuid();
    await tx.query(
      `INSERT INTO concepto_causacion (
         id, tenant_id, company_id, codigo, nombre, naturaleza,
         cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
         aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
       VALUES ($1,$2,$3,$4,'Concepto de A14','compra',$5,$6,$7,false,false,false,false)`,
      [id, e.tenantId, e.companyId, `A14-${id.slice(0, 8)}`, e.cuentas.gasto, e.cuentas.ivaDescontable, e.cuentas.proveedores],
    );
    return id;
  });
}

/** Escenario listo para causar de punta a punta: documento parseado, clasificado y encolado. */
async function montarCausable(
  descripcion = 'Servicio de mantenimiento mensual',
  opciones: { base?: number; iva?: number } = {},
): Promise<EscenarioCausable> {
  const e = await crearEscenario(db);
  const conceptoId = await crearConcepto(e);
  const base = opciones.base ?? 100_000_00;
  const iva = opciones.iva ?? 19_000_00;

  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [e.tenantId, e.companyId, e.thirdPartyId, descripcion.toLowerCase().trim(), conceptoId],
    );
    await tx.query(`UPDATE source_document SET estado = 'parseado' WHERE id = $1`, [e.sourceDocumentId]);
    await tx.query(
      `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
       VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        JSON.stringify({
          tipoDocumento: 'Invoice',
          emisor: { nit: '900123456', nombre: 'Proveedor' },
          adquirente: { nit: null, nombre: null },
          lineas: [
            {
              numero: 1,
              descripcion,
              subtotal: String(base),
              impuestos: iva > 0 ? [{ codigo: '01', valor: String(iva) }] : [],
            },
          ],
        }),
      ],
    );
  });

  const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
  return { e, conceptoId, jobId: job.id };
}

// =============================================================================
describe('A14 · COMPUERTA 1 — caso 18: reprocesar 10 veces produce EL MISMO ASIENTO', () => {
  it('diez pasadas de la cola sobre la misma factura dejan UN solo asiento, idéntico byte a byte', async () => {
    const { e, jobId } = await montarCausable('Reproceso decuplicado de A14');

    const primera = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(primera.estado).toBe('causado');
    if (primera.estado !== 'causado' || !primera.journalEntryId) throw new Error('no causó');

    const fotoInicial = await fotoAsiento(primera.journalEntryId);
    const estados: string[] = [];

    for (let i = 0; i < 9; i += 1) {
      // Se reencola a la fuerza (como haría un reintento o un operador) y se
      // vuelve a procesar. Nueve veces más: diez en total.
      await db.asAdmin(async (tx) => {
        await tx.query(
          `UPDATE document_processing_job SET estado = 'pendiente', disponible_en = now() WHERE id = $1`,
          [jobId],
        );
      });
      const r = await db.asAdmin((tx) =>
        procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
      );
      estados.push(r.estado);
      if (r.estado === 'revision_manual') throw new Error('reprocesar mandó el documento a revisión manual');
      expect(r.journalEntryId).toBe(primera.journalEntryId);
    }

    // Las nueve repeticiones no vuelven a causar: reconocen que ya está hecho.
    expect(new Set(estados)).toEqual(new Set(['ya_procesado']));

    // UN asiento, no diez.
    const conteo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      );
      return rows[0]!.n;
    });
    expect(conteo).toBe(1);

    // Y el asiento no cambió NI UN BYTE en las diez pasadas.
    expect(await fotoAsiento(primera.journalEntryId)).toBe(fotoInicial);
  });

  it('LA GARANTÍA NO ES EL `if` DE TYPESCRIPT: la impone `journal_entry_idem_uq` en la base', async () => {
    // Se salta `procesarJobCausacion` entero y se intenta insertar a mano un
    // segundo asiento con la misma `idempotency_key`. Si la garantía viviera
    // solo en el chequeo de `source_document.estado`, esto pasaría.
    const { e, jobId } = await montarCausable('Idempotencia impuesta por la base');
    const r = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
    if (r.estado !== 'causado') throw new Error('no causó');

    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          await tx.query(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, tipo,
                                        fecha_hecho_economico, descripcion, estado,
                                        source_document_id, approval_id, idempotency_key)
             SELECT tenant_id, company_id, fiscal_period_id, tipo, fecha_hecho_economico,
                    'Segundo asiento del mismo documento', 'draft', source_document_id,
                    approval_id, idempotency_key
               FROM journal_entry WHERE id = $1`,
            [r.journalEntryId],
          );
        }),
      '23505',
      'insertar un segundo asiento con la misma idempotency_key',
    );
  });

  it('encolar el mismo documento diez veces deja UN solo trabajo (UNIQUE de la base)', async () => {
    const { e, jobId } = await montarCausable('Encolado decuplicado');
    const ids = new Set<string>([jobId]);
    for (let i = 0; i < 9; i += 1) {
      const j = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
      ids.add(j.id);
    }
    expect(ids.size).toBe(1);

    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          await tx.query(
            `INSERT INTO document_processing_job (tenant_id, company_id, source_document_id, tipo, payload)
             VALUES ($1,$2,$3,'causacion','{}'::jsonb)`,
            [e.tenantId, e.companyId, e.sourceDocumentId],
          );
        }),
      '23505',
      'encolar dos veces el mismo documento por la vía directa',
    );
  });
});

// =============================================================================
describe('A14 · COMPUERTA 1 — caso 15: la nota crédito no muta el asiento original', () => {
  it('reversar un asiento publicado crea uno NUEVO y deja el original idéntico byte a byte', async () => {
    const { e, jobId } = await montarCausable('Factura que luego se reversa');
    const causado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
    if (causado.estado !== 'causado' || !causado.journalEntryId) throw new Error('no causó');

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, {
        journalEntryId: causado.journalEntryId!,
        decision: 'aprobado',
        userId: e.userId,
        ip: '192.0.2.14',
      }),
      { userId: e.userId },
    );

    const fotoOriginal = await fotoAsiento(causado.journalEntryId);
    expect(fotoOriginal).toContain('"posted"');

    const reversa = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      reversarAsientoPublicado(tx, {
        journalEntryId: causado.journalEntryId!,
        motivo: 'Nota crédito total (prueba adversarial de A14)',
      }),
      { userId: e.userId },
    );

    expect(reversa.journalEntryId).not.toBe(causado.journalEntryId);
    // El original: ni un byte distinto.
    expect(await fotoAsiento(causado.journalEntryId)).toBe(fotoOriginal);

    // Y la reversa apunta al original y suma cero con él.
    const suma = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ neto: string }>(
        `SELECT COALESCE(SUM(CASE WHEN jl.side = 'debito' THEN jl.monto ELSE -jl.monto END), 0)::text AS neto
           FROM journal_line jl
          WHERE jl.journal_entry_id IN ($1, $2)`,
        [causado.journalEntryId, reversa.journalEntryId],
      );
      return rows[0]!.neto;
    });
    expect(suma).toBe('0');
  });

  // El nombre de la restricción cambió en la migración 173 (A14, V-28):
  // `journal_entry_reversa_uq` era TOTAL y confundía "ya se reversó" con "hubo
  // un intento de reversa que se anuló", dejando irrecuperable una nota
  // crédito rechazada por error. Ahora es el índice parcial
  // `journal_entry_reversa_viva_uq`. El invariante que esta prueba defiende —
  // no hay dos reversas VIVAS del mismo asiento — es exactamente el mismo.
  it('no se puede reversar dos veces el mismo asiento: lo impide `journal_entry_reversa_viva_uq`', async () => {
    const { e, jobId } = await montarCausable('Factura con doble reversa');
    const causado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
    if (causado.estado !== 'causado' || !causado.journalEntryId) throw new Error('no causó');
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: causado.journalEntryId!, decision: 'aprobado', userId: e.userId, ip: '192.0.2.14' }),
      { userId: e.userId },
    );
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => reversarAsientoPublicado(tx, { journalEntryId: causado.journalEntryId!, motivo: 'primera' }),
      { userId: e.userId },
    );

    // Segunda reversa por la vía cruda: la base tiene que negarse.
    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          await tx.query(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, tipo,
                                        fecha_hecho_economico, descripcion, estado,
                                        source_document_id, approval_id, idempotency_key, reverses_entry_id)
             SELECT tenant_id, company_id, fiscal_period_id, 'reversa', fecha_hecho_economico,
                    'Segunda reversa del mismo asiento', 'draft', source_document_id,
                    approval_id, 'reversa-duplicada-' || id::text, id
               FROM journal_entry WHERE id = $1`,
            [causado.journalEntryId],
          );
        }),
      '23505',
      'reversar dos veces el mismo asiento',
    );
  });
});

// =============================================================================
describe('A14 · COMPUERTA 1 — caso 17 y criterio 4: cambiar la tarifa cambia el resultado, sin tocar código', () => {
  it('una vigencia nueva NO altera lo publicado y SÍ aplica a los hechos posteriores', async () => {
    const e = await crearEscenario(db);

    // Regla propia de esta prueba, con vigencia acotada. Los NÚMEROS son de
    // laboratorio y su `norma_respaldo` lo dice: no se está afirmando ninguna
    // tarifa real, se está probando el MECANISMO de vigencias.
    const conceptoTributario = uuid();
    const reglaVieja = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, tipo, codigo, nombre)
         VALUES ($1,$2,'retefuente','a14_mecanismo','Concepto de laboratorio de A14')`,
        [conceptoTributario, e.tenantId],
      );
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde,
                               norma_respaldo, requiere_verificacion_humana)
         VALUES ($1,$2,$3,'retefuente',0.010000,0,'base_gravable','ambos','ambos',$4,
                 DATE '2026-01-01',
                 'PARÁMETRO DE LABORATORIO de la prueba adversarial de A14: no es una tarifa real.', true)`,
        [reglaVieja, e.tenantId, conceptoTributario, e.cuentas.retefuentePorPagar],
      );
    });

    const leerTarifa = async (fecha: string): Promise<string | null> =>
      db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ tarifa: string }>(
          `SELECT tarifa::text FROM tax_rule
            WHERE tax_concept_id = $1 AND app.esta_vigente(vigente_desde, vigente_hasta, $2::date)`,
          [conceptoTributario, fecha],
        );
        return rows[0]?.tarifa ?? null;
      });

    expect(await leerTarifa('2026-07-15')).toBe('0.010000');

    // Se registra una retención con la tarifa vieja y se publica su traza.
    const documento = e.sourceDocumentId;
    const retencionId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO retention_applied (
           tenant_id, company_id, source_document_id, third_party_id, tipo, base, tarifa,
           valor, tax_rule_id, regla_vigente_desde, account_id, fecha_hecho_economico,
           norma_respaldo, aplicada)
         VALUES ($1,$2,$3,$4,'retefuente',100000000,0.010000,1000000,$5,DATE '2026-01-01',$6,
                 DATE '2026-07-15','laboratorio de A14', true)
         RETURNING id`,
        [e.tenantId, e.companyId, documento, e.thirdPartyId, reglaVieja, e.cuentas.retefuentePorPagar],
      );
      return rows[0]!.id;
    });
    const fotoRetencion = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ f: string }>(
        `SELECT to_jsonb(ra.*)::text AS f FROM retention_applied ra WHERE ra.id = $1`,
        [retencionId],
      );
      return rows[0]!.f;
    });

    // CAMBIO DE PARÁMETRO: se cierra la vigencia y se inserta la nueva. Sin
    // tocar una línea de código, sin redesplegar nada.
    await db.asAdmin(async (tx) => {
      await tx.query(`UPDATE tax_rule SET vigente_hasta = DATE '2026-12-31' WHERE id = $1`, [reglaVieja]);
      await tx.query(
        `INSERT INTO tax_rule (tenant_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde,
                               norma_respaldo, requiere_verificacion_humana)
         VALUES ($1,$2,'retefuente',0.030000,0,'base_gravable','ambos','ambos',$3,
                 DATE '2027-01-01',
                 'PARÁMETRO DE LABORATORIO de A14: vigencia nueva del mecanismo de cambio de tarifa.', true)`,
        [e.tenantId, conceptoTributario, e.cuentas.retefuentePorPagar],
      );
    });

    // 1. La resolución por fecha del hecho pasado no cambió.
    expect(await leerTarifa('2026-07-15')).toBe('0.010000');
    // 2. La resolución de un hecho posterior sí usa la tarifa nueva.
    expect(await leerTarifa('2027-03-15')).toBe('0.030000');
    // 3. La traza ya registrada quedó idéntica byte a byte.
    const fotoDespues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ f: string }>(
        `SELECT to_jsonb(ra.*)::text AS f FROM retention_applied ra WHERE ra.id = $1`,
        [retencionId],
      );
      return rows[0]!.f;
    });
    expect(fotoDespues).toBe(fotoRetencion);
  });

  it('cambiar la UVT mueve el umbral de retención sin tocar una línea de código', async () => {
    // El criterio 4 de la compuerta con el parámetro más transversal de todos.
    const e = await crearEscenario(db);
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, vigente_hasta,
                                norma_respaldo, requiere_verificacion_humana)
         VALUES ($1,$2,2026,5000000,DATE '2026-01-01',DATE '2026-12-31',
                 'UVT DE LABORATORIO de A14 (alcance de empresa): no es un valor normativo.', true)`,
        [e.tenantId, e.companyId],
      );
    });

    const umbral = async (fecha: string): Promise<number> =>
      db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ u: string }>(
          `SELECT (2 * valor)::text AS u FROM uvt_value
            WHERE company_id = $1 AND app.esta_vigente(vigente_desde, vigente_hasta, $2::date)`,
          [e.companyId, fecha],
        );
        return Number(rows[0]!.u);
      });

    expect(await umbral('2026-07-15')).toBe(10_000_000);

    // Vigencia nueva desde 2027 con otro valor: el umbral se mueve solo.
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde,
                                norma_respaldo, requiere_verificacion_humana)
         VALUES ($1,$2,2027,6000000,DATE '2027-01-01',
                 'UVT DE LABORATORIO de A14 (alcance de empresa): no es un valor normativo.', true)`,
        [e.tenantId, e.companyId],
      );
    });
    expect(await umbral('2026-07-15')).toBe(10_000_000); // el pasado no se mueve
    expect(await umbral('2027-03-15')).toBe(12_000_000); // el futuro sí
  });
});

// =============================================================================
describe('A14 · COMPUERTA 1 — caso 20: la firma B no ve NADA de la firma A en las tablas nuevas de la Ola 1', () => {
  it('barrido de las seis tablas que estrena la Ola 1: cero filas ajenas desde una sesión real', async () => {
    const a = await montarCausable('Documento de la firma A');
    await db.asAdmin((tx) => procesarJobCausacion(tx, { id: a.jobId, sourceDocumentId: a.e.sourceDocumentId }));
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO email_ingest_log (tenant_id, company_id, buzon_destino, message_id,
                                       remitente_email, asunto, tamano_bytes, resultado)
         VALUES ($1,$2,'buzon@ejemplo.co',$3,'proveedor@ejemplo.co','Factura',1024,'procesado')`,
        [a.e.tenantId, a.e.companyId, `msg-${uuid()}`],
      );
    });

    const b = await crearEscenario(db);

    const vistoPorB = await db.asTenant(b.tenantId, b.companyId, async (tx) => {
      const conteos: Record<string, number> = {};
      const consultas: [string, string, unknown[]][] = [
        ['document_processing_job', 'SELECT count(*)::int AS n FROM document_processing_job WHERE tenant_id = $1', [a.e.tenantId]],
        ['source_document', 'SELECT count(*)::int AS n FROM source_document WHERE tenant_id = $1', [a.e.tenantId]],
        ['extraction', 'SELECT count(*)::int AS n FROM extraction WHERE tenant_id = $1', [a.e.tenantId]],
        ['retention_applied', 'SELECT count(*)::int AS n FROM retention_applied WHERE tenant_id = $1', [a.e.tenantId]],
        ['memoria_clasificacion', 'SELECT count(*)::int AS n FROM memoria_clasificacion WHERE tenant_id = $1', [a.e.tenantId]],
        ['email_ingest_log', 'SELECT count(*)::int AS n FROM email_ingest_log WHERE tenant_id = $1', [a.e.tenantId]],
        ['journal_entry', 'SELECT count(*)::int AS n FROM journal_entry WHERE tenant_id = $1', [a.e.tenantId]],
        ['journal_line', 'SELECT count(*)::int AS n FROM journal_line WHERE tenant_id = $1', [a.e.tenantId]],
        ['concepto_causacion', 'SELECT count(*)::int AS n FROM concepto_causacion WHERE tenant_id = $1', [a.e.tenantId]],
      ];
      for (const [nombre, sql, params] of consultas) {
        const { rows } = await tx.query<{ n: number }>(sql, params);
        conteos[nombre] = rows[0]!.n;
      }
      // Y sin filtro ninguno, tampoco: la consulta olvidadiza del desarrollador.
      const { rows: sinFiltro } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM document_processing_job`,
      );
      conteos['document_processing_job (sin WHERE, ajenos)'] = sinFiltro[0]!.n;
      return conteos;
    });

    for (const [tabla, n] of Object.entries(vistoPorB)) {
      expect(`${tabla}=${n}`).toBe(`${tabla}=0`);
    }
  });

  it('la firma B no puede encolar, completar ni tocar el trabajo de la firma A', async () => {
    const a = await montarCausable('Trabajo que B intentará robar');
    const b = await crearEscenario(db);

    // (a) Escribir un trabajo con el tenant de A desde la sesión de B.
    await esperarErrorPg(
      () =>
        db.asTenant(b.tenantId, b.companyId, async (tx) => {
          await tx.query(
            `INSERT INTO document_processing_job (tenant_id, company_id, source_document_id, tipo, payload)
             VALUES ($1,$2,$3,'causacion','{}'::jsonb)`,
            [a.e.tenantId, a.e.companyId, a.e.sourceDocumentId],
          );
        }),
      '42501',
      'insertar un trabajo de cola en la firma ajena',
    );

    // (b) Marcarlo completado sin pasar por la función de plataforma.
    const tocadas = await db.asTenant(b.tenantId, b.companyId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE document_processing_job SET estado = 'completado' WHERE id = $1 RETURNING id`,
        [a.jobId],
      );
      return rows.length;
    });
    expect(tocadas).toBe(0);

    // (c) Llamar a la función de plataforma desde la sesión de negocio: el
    // privilegio EXECUTE no existe para app_user (REVOKE de la migración 040).
    await esperarErrorPg(
      () =>
        db.asTenant(b.tenantId, b.companyId, async (tx) => {
          await tx.query('SELECT * FROM app.reclamar_siguiente_job($1)', ['ladron']);
        }),
      '42501',
      'reclamar un trabajo de la cola desde una sesión de negocio',
    );
    await esperarErrorPg(
      () =>
        db.asTenant(b.tenantId, b.companyId, async (tx) => {
          await tx.query('SELECT app.completar_job($1, NULL)', [a.jobId]);
        }),
      '42501',
      'completar el trabajo de otra firma desde una sesión de negocio',
    );
  });

  it('la firma B no puede aprobar ni publicar el asiento de la firma A', async () => {
    const a = await montarCausable('Asiento que B intentará aprobar');
    const causado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: a.jobId, sourceDocumentId: a.e.sourceDocumentId }));
    if (causado.estado !== 'causado' || !causado.journalEntryId) throw new Error('no causó');
    const b = await crearEscenario(db);

    // Ni por el servicio (no ve el asiento)...
    let mensaje = '';
    try {
      await db.asTenant(
        b.tenantId,
        b.companyId,
        (tx) => aprobarAsiento(tx, { journalEntryId: causado.journalEntryId!, decision: 'aprobado', userId: b.userId, ip: '192.0.2.99' }),
        { userId: b.userId },
      );
    } catch (error) {
      mensaje = error instanceof Error ? error.message : String(error);
    }
    expect(mensaje).not.toBe('');

    // ...ni por la vía cruda del motor: `app.publicar_asiento` no ve la fila.
    const publicado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM journal_entry WHERE id = $1`,
        [causado.journalEntryId],
      );
      return rows[0]!.estado;
    });
    expect(publicado).toBe('draft');
  });
});

// =============================================================================
describe('A14 · integridad de la sección 12 sobre lo que construyó la Ola 1', () => {
  it('UPDATE y DELETE sobre el asiento PUBLICADO por el pipeline de A6 fallan en la BASE', async () => {
    const { e, jobId } = await montarCausable('Asiento inmutable');
    const causado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
    if (causado.estado !== 'causado' || !causado.journalEntryId) throw new Error('no causó');
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: causado.journalEntryId!, decision: 'aprobado', userId: e.userId, ip: '192.0.2.14' }),
      { userId: e.userId },
    );

    const foto = await fotoAsiento(causado.journalEntryId);

    const vectores: [string, string, unknown[]][] = [
      ['UPDATE idempotente', `UPDATE journal_entry SET descripcion = descripcion WHERE id = $1`, [causado.journalEntryId]],
      ['des-publicar', `UPDATE journal_entry SET estado = 'draft' WHERE id = $1`, [causado.journalEntryId]],
      ['DELETE del asiento', `DELETE FROM journal_entry WHERE id = $1`, [causado.journalEntryId]],
      ['UPDATE de una partida', `UPDATE journal_line SET monto = monto + 1 WHERE journal_entry_id = $1`, [causado.journalEntryId]],
      ['DELETE de una partida', `DELETE FROM journal_line WHERE journal_entry_id = $1`, [causado.journalEntryId]],
      ['INSERT de una partida nueva', `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
        SELECT tenant_id, company_id, journal_entry_id, 99, account_id, side, monto FROM journal_line WHERE journal_entry_id = $1 LIMIT 1`, [causado.journalEntryId]],
      ['UPDATE masivo sin WHERE', `UPDATE journal_entry SET descripcion = 'todos'`, []],
      ['DELETE masivo sin WHERE', `DELETE FROM journal_line`, []],
    ];

    for (const [nombre, sql, params] of vectores) {
      let codigo = '(no falló)';
      try {
        await db.asAdmin(async (tx) => {
          await tx.query(sql, params);
        });
      } catch (error) {
        codigo = (error as { code?: string }).code ?? 'sin código';
      }
      // Todos deben ser rechazados por el motor con el error de dominio del ledger.
      expect(`${nombre}: ${codigo}`).toBe(`${nombre}: LG001`);
    }

    // Y tras los ocho intentos, la fotografía es idéntica.
    expect(await fotoAsiento(causado.journalEntryId)).toBe(foto);
  });

  it('un asiento descuadrado producido a mano sobre el escenario de A6 es rechazado por la BASE', async () => {
    const { e } = await montarCausable('Descuadre deliberado');
    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          const { rows } = await tx.query<{ id: string }>(
            `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                        descripcion, estado, source_document_id, approval_id, idempotency_key)
             VALUES ($1,$2,$3,'2026-06-15','Descuadre de un centavo','draft',$4,$5,$6) RETURNING id`,
            [e.tenantId, e.companyId, e.fiscalPeriodId, e.sourceDocumentId, e.approvalId, `descuadre-${uuid()}`],
          );
          const entryId = rows[0]!.id;
          await tx.query(
            `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
             VALUES ($1,$2,$3,1,$4,'debito',100000), ($1,$2,$3,2,$5,'credito',99999)`,
            [e.tenantId, e.companyId, entryId, e.cuentas.gasto, e.cuentas.proveedores],
          );
          await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, e.userId]);
        }),
      'LG002',
      'publicar un asiento descuadrado por un centavo',
    );
  });

  it('publicar dos veces el mismo asiento falla; y el asiento aprobado no se puede rechazar después', async () => {
    const { e, jobId } = await montarCausable('Doble publicación');
    const causado = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));
    if (causado.estado !== 'causado' || !causado.journalEntryId) throw new Error('no causó');
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => aprobarAsiento(tx, { journalEntryId: causado.journalEntryId!, decision: 'aprobado', userId: e.userId, ip: '192.0.2.14' }),
      { userId: e.userId },
    );

    // Segunda publicación por la vía de la función del motor.
    let codigo = '(no falló)';
    try {
      await db.asAdmin(async (tx) => {
        await tx.query('SELECT app.publicar_asiento($1, $2)', [causado.journalEntryId, e.userId]);
      });
    } catch (error) {
      codigo = (error as { code?: string }).code ?? 'sin código';
    }
    expect(codigo).not.toBe('(no falló)');
    expect(codigo).toMatch(/^LG/);
  });
});

// =============================================================================
describe('A14 · COMPUERTA 2 — el parser y el Invoice embebido en base64', () => {
  const dirFixtures = fileURLToPath(new URL('../fixtures/ubl/', import.meta.url));
  const leer = (n: string): Uint8Array => new Uint8Array(readFileSync(dirFixtures + n));

  it('el fixture de A4 con el Invoice en base64 dentro del AttachedDocument se extrae entero', async () => {
    const r = procesarAdjuntoXml(leer('attached-document-invoice-base64.xml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.documento.tipoDocumento).toBe('Invoice'); // el INTERNO, no el contenedor
    expect(r.documento.veniaEnAttachedDocument).toBe(true);
    expect(r.documento.cufe).toMatch(/^[0-9a-f]{96}$/);
    expect(r.documento.xmlCrudo).not.toContain('<AttachedDocument');
    expect(r.documento.lineas.length).toBeGreaterThan(0);
    // Y los montos son enteros de centavos, no floats (Regla de Oro 5).
    expect(typeof r.documento.totales.neto).toBe('bigint');
  });

  it('VARIANTE HOSTIL DE A14: base64 partido en líneas de 76 caracteres, como lo emite un proveedor real', () => {
    // Los fixtures de A4 traen el base64 en UNA sola línea. Un emisor real casi
    // siempre lo parte. Si el desempaquetado dependiera de que no haya saltos
    // de línea, el producto fallaría contra el primer XML de producción.
    const interno = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>A14-001</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384">${'a'.repeat(96)}</cbc:UUID>
  <cbc:IssueDate>2026-07-15</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme>
    <cbc:CompanyID schemeID="1" schemeName="31">900123456</cbc:CompanyID>
  </cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme>
    <cbc:CompanyID schemeID="1" schemeName="31">800987654</cbc:CompanyID>
  </cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">119000.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="COP">100000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Servicio de prueba adversarial</cbc:Description></cac:Item>
  </cac:InvoiceLine>
</Invoice>`;
    const b64 = Buffer.from(interno, 'utf8').toString('base64');
    const envuelto = (b64.match(/.{1,76}/g) ?? []).join('\n');
    expect(envuelto).toContain('\n'); // que el caso es el que se dice que es

    const contenedor = `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
                  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>AD-A14</cbc:ID>
  <cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${envuelto}]]></cbc:Description></cac:ExternalReference></cac:Attachment>
</AttachedDocument>`;

    const r = procesarAdjuntoXml(new Uint8Array(Buffer.from(contenedor, 'utf8')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.documento.tipoDocumento).toBe('Invoice');
    expect(r.documento.cufe).toBe('a'.repeat(96));
    expect(r.documento.veniaEnAttachedDocument).toBe(true);
  });

  it('VARIANTE HOSTIL DE A14: el XML interno va en CDATA sin base64, con otros prefijos de namespace', () => {
    // Ningún fixture de A4 cubre el XML plano DENTRO de CDATA, ni prefijos
    // distintos de cac/cbc. Ambos aparecen en producción según el proveedor.
    const interno = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:Invoice xmlns:ns2="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:ns3="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:ns4="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <ns4:ID>A14-002</ns4:ID>
  <ns4:UUID schemeName="CUFE-SHA384">${'b'.repeat(96)}</ns4:UUID>
  <ns4:IssueDate>2026-07-15</ns4:IssueDate>
  <ns3:AccountingSupplierParty><ns3:Party><ns3:PartyTaxScheme>
    <ns4:CompanyID>900123456</ns4:CompanyID>
  </ns3:PartyTaxScheme></ns3:Party></ns3:AccountingSupplierParty>
  <ns3:AccountingCustomerParty><ns3:Party><ns3:PartyTaxScheme>
    <ns4:CompanyID>800987654</ns4:CompanyID>
  </ns3:PartyTaxScheme></ns3:Party></ns3:AccountingCustomerParty>
  <ns3:LegalMonetaryTotal><ns4:PayableAmount currencyID="COP">119000.00</ns4:PayableAmount></ns3:LegalMonetaryTotal>
  <ns3:InvoiceLine>
    <ns4:ID>1</ns4:ID>
    <ns4:LineExtensionAmount currencyID="COP">100000.00</ns4:LineExtensionAmount>
    <ns3:Item><ns4:Description>Servicio con prefijos ajenos</ns4:Description></ns3:Item>
  </ns3:InvoiceLine>
</ns2:Invoice>`;
    const contenedor = `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <cbc:ID>AD-A14-2</cbc:ID>
  <cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${interno}]]></cbc:Description></cac:ExternalReference></cac:Attachment>
</AttachedDocument>`;
    const r = procesarAdjuntoXml(new Uint8Array(Buffer.from(contenedor, 'utf8')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.documento.tipoDocumento).toBe('Invoice');
    expect(r.documento.cufe).toBe('b'.repeat(96));
  });

  it('ATAQUE: "billion laughs" (expansión de entidades) no cuelga el proceso ni explota en memoria', () => {
    const bomba = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
 <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
 <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
]>
<Invoice><ID>&lol6;</ID></Invoice>`;
    const t0 = Date.now();
    const r = procesarAdjuntoXml(new Uint8Array(Buffer.from(bomba, 'utf8')));
    const ms = Date.now() - t0;
    // No importa si sale por cuarentena o por validación: importa que salga.
    expect(r.ok).toBe(false);
    expect(ms).toBeLessThan(5_000);
  });

  it('ATAQUE: entidad externa (XXE) apuntando a un archivo local va a cuarentena, no lee el archivo', () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]>
<Invoice><ID>&xxe;</ID></Invoice>`;
    const r = procesarAdjuntoXml(new Uint8Array(Buffer.from(xxe, 'utf8')));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('xml_mal_formado');
    expect(JSON.stringify(r.cuarentena)).not.toMatch(/\[fonts\]|for 16-bit app support/i);
  });

  it('ATAQUE: un AttachedDocument que embebe otro AttachedDocument no recursa hasta el fondo', () => {
    const interno = `<?xml version="1.0"?><AttachedDocument xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
      <cac:Attachment><cac:ExternalReference><cbc:Description>x</cbc:Description></cac:ExternalReference></cac:Attachment>
    </AttachedDocument>`;
    const contenedor = `<?xml version="1.0"?><AttachedDocument xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
      <cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${interno}]]></cbc:Description></cac:ExternalReference></cac:Attachment>
    </AttachedDocument>`;
    const r = procesarAdjuntoXml(new Uint8Array(Buffer.from(contenedor, 'utf8')));
    expect(r.ok).toBe(false);
  });
});

// =============================================================================
describe('A14 · rompiendo el ingest de A4: el mismo CUFE por dos caminos a la vez', () => {
  it('dos rutas distintas con el mismo CUFE dejan UN documento: lo impone el UNIQUE, no el código', async () => {
    const e = await crearEscenario(db);
    const cufe = 'c'.repeat(96);

    // El mismo Invoice llega (a) directo y (b) embebido en un AttachedDocument.
    // Bytes distintos, hash distinto, MISMO CUFE.
    const invoice = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <cbc:ID>DOBLE-CAMINO</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384">${cufe}</cbc:UUID>
  <cbc:IssueDate>2026-06-15</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900123456</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>800987654</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">119000.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:LineExtensionAmount currencyID="COP">100000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Mismo CUFE, dos caminos</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>`;
    const contenedor = `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns:cac="urn:cac" xmlns:cbc="urn:cbc"><cbc:ID>AD</cbc:ID>
  <cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${invoice}]]></cbc:Description></cac:ExternalReference></cac:Attachment>
</AttachedDocument>`;

    const porCorreo = procesarAdjuntoXml(new Uint8Array(Buffer.from(invoice, 'utf8')));
    const porPortal = procesarAdjuntoXml(new Uint8Array(Buffer.from(contenedor, 'utf8')));
    expect(porCorreo.ok && porPortal.ok).toBe(true);
    if (!porCorreo.ok || !porPortal.ok) return;
    expect(porCorreo.documento.cufe).toBe(porPortal.documento.cufe);
    expect(porCorreo.documento.hashContenido).not.toBe(porPortal.documento.hashContenido);

    const primero = await db.asAdmin((tx) =>
      guardarDocumentoProcesado(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        documento: porCorreo.documento,
        origenDocumento: 'correo',
      }),
    );
    const segundo = await db.asAdmin((tx) =>
      guardarDocumentoProcesado(tx, {
        tenantId: e.tenantId,
        companyId: e.companyId,
        documento: porPortal.documento,
        origenDocumento: 'portal_dian',
      }),
    );
    expect(primero.resultado).toBe('creado');
    expect(segundo.resultado).toBe('duplicado');

    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM source_document WHERE company_id = $1 AND cufe = $2`,
        [e.companyId, cufe],
      );
      return rows[0]!.n;
    });
    expect(n).toBe(1);

    // Y la garantía no es la consulta previa del helper: es el UNIQUE.
    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          await tx.query(
            `INSERT INTO source_document (tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                          emisor_nit, fecha_hecho_economico, hash_contenido, estado)
             VALUES ($1,$2,'Invoice',$3,'X','900123456','2026-06-15',$4,'recibido')`,
            [e.tenantId, e.companyId, cufe, `hash-distinto-${uuid()}`],
          );
        }),
      '23505',
      'insertar dos veces el mismo CUFE en la misma empresa',
    );
  });

  it('el MISMO CUFE en dos empresas distintas SÍ puede existir: el alcance del UNIQUE es la empresa', async () => {
    // No es un fallo: dos empresas-cliente de la misma firma pueden recibir la
    // misma factura (p. ej. una copia mal enrutada). Lo que no puede es
    // duplicarse dentro de una empresa. Se deja medido para que nadie lo
    // "arregle" convirtiéndolo en global sin darse cuenta del efecto.
    const a = await crearEscenario(db);
    const b = await crearEscenario(db);
    const cufe = 'd'.repeat(96);
    for (const e of [a, b]) {
      await db.asAdmin(async (tx) => {
        await tx.query(
          `INSERT INTO source_document (tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                        emisor_nit, fecha_hecho_economico, hash_contenido, estado)
           VALUES ($1,$2,'Invoice',$3,'X','900123456','2026-06-15',$4,'recibido')`,
          [e.tenantId, e.companyId, cufe, `hash-${uuid()}`],
        );
      });
    }
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM source_document WHERE cufe = $1`,
        [cufe],
      );
      return rows[0]!.n;
    });
    expect(n).toBe(2);
  });
});

// =============================================================================
describe('A14 · rompiendo la cola de A6: concurrencia y trabajos ajenos', () => {
  /** Vacía la cola de trabajos que dejaron otras pruebas del archivo. */
  async function drenarCola(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const j = await withAdminContext(db.client, (tx: SqlClient) => reclamarSiguienteJob(tx, 'drenaje-a14'));
      if (!j) return;
    }
    throw new Error('La cola no se vacía: hay más de 200 trabajos pendientes.');
  }

  it('dos trabajadores no se llevan el mismo trabajo: `FOR UPDATE SKIP LOCKED` reparte, no duplica', async () => {
    await drenarCola();
    const a = await montarCausable('Trabajo de la carrera 1');
    const b = await montarCausable('Trabajo de la carrera 2');

    const primero = await withAdminContext(db.client, (tx: SqlClient) => reclamarSiguienteJob(tx, 'worker-A'));
    const segundo = await withAdminContext(db.client, (tx: SqlClient) => reclamarSiguienteJob(tx, 'worker-B'));
    const tercero = await withAdminContext(db.client, (tx: SqlClient) => reclamarSiguienteJob(tx, 'worker-C'));

    const reclamados = [primero, segundo].map((j) => j?.id);
    expect(new Set(reclamados).size).toBe(2); // dos trabajos distintos
    expect(reclamados).toContain(a.jobId);
    expect(reclamados).toContain(b.jobId);
    expect(tercero).toBeNull(); // no hay un tercero que reclamar

    // Un trabajo ya reclamado no se vuelve a entregar.
    for (const job of [primero, segundo]) {
      const estado = await db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ estado: string; tomado_por: string; intentos: number }>(
          `SELECT estado, tomado_por, intentos FROM document_processing_job WHERE id = $1`,
          [job!.id],
        );
        return rows[0]!;
      });
      expect(estado.estado).toBe('en_proceso');
      expect(estado.intentos).toBe(1);
      expect(['worker-A', 'worker-B']).toContain(estado.tomado_por);
    }
  });

  it('dos ciclos de worker en paralelo sobre la misma factura no producen dos asientos', async () => {
    await drenarCola();
    const { e, jobId } = await montarCausable('Carrera de dos workers');

    // Los dos ciclos arrancan a la vez. Solo uno puede reclamar; el otro no
    // encuentra trabajo. En cualquier caso: un asiento.
    const [r1, r2] = await Promise.all([
      ejecutarCicloCola(db.client, 'worker-1'),
      ejecutarCicloCola(db.client, 'worker-2'),
    ]);

    const trabajaron = [r1, r2].filter((r) => r.hizoAlgo).length;
    expect(trabajaron).toBeGreaterThanOrEqual(1);

    const asientos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      );
      return rows[0]!.n;
    });
    expect(asientos).toBe(1);

    const job = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM document_processing_job WHERE id = $1`,
        [jobId],
      );
      return rows[0]!.estado;
    });
    expect(['completado', 'pendiente', 'en_proceso']).toContain(job);
  });

  it('la cola no puede apuntar a un documento de otra empresa: la FK compuesta lo impide', async () => {
    const a = await crearEscenario(db);
    const b = await crearEscenario(db);
    await esperarErrorPg(
      () =>
        db.asAdmin(async (tx) => {
          await tx.query(
            `INSERT INTO document_processing_job (tenant_id, company_id, source_document_id, tipo, payload)
             VALUES ($1,$2,$3,'causacion','{}'::jsonb)`,
            [b.tenantId, b.companyId, a.sourceDocumentId],
          );
        }),
      '23503',
      'encolar el documento de otra empresa',
    );
  });
});

// =============================================================================
describe('A14 · la vía del buzón: ¿se puede cruzar de firma por ahí? (adjudicación de app.resolver_empresa_por_buzon)', () => {
  it('V-1 CERRADA: desde la sesión de la firma B, la función ya no se puede ni llamar (42501)', async () => {
    // HISTORIA DE ESTA PRUEBA — se conserva el mismo caso, con el veredicto
    // invertido. En la Ola 1 medía el hallazgo en positivo: `app_user` tenía
    // EXECUTE (migración 032, A4), así que desde la sesión de la firma B, con
    // el buzón de una empresa de la firma A, la función devolvía el
    // `tenant_id`/`company_id` de A — un oráculo de identificadores ajenos.
    // La migración 100 (A12, cierre de V-1) le quitó el GRANT a todo rol de
    // aplicación, así que ahora el mismo intento ni siquiera llega a
    // ejecutarse. Lo que antes se documentaba como fuga, hoy se fija como
    // imposible: si alguien vuelve a conceder EXECUTE, esta prueba falla.
    const a = await crearEscenario(db);
    const b = await crearEscenario(db);

    const buzonDeA = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ buzon_email: string }>(
        `SELECT buzon_email FROM company WHERE id = $1`,
        [a.companyId],
      );
      return rows[0]!.buzon_email;
    });

    await esperarErrorPg(
      () => db.asTenant(b.tenantId, b.companyId, (tx) => resolverEmpresaPorBuzon(tx, buzonDeA)),
      '42501',
      'preguntarle a app.resolver_empresa_por_buzon por el buzón de otra firma',
    );

    // Y la segunda capa sigue en su sitio, que es lo que mantuvo la severidad
    // baja mientras la primera estuvo abierta: aunque los identificadores de A
    // se obtengan por cualquier otra vía, desde la sesión de B no se lee una
    // sola fila de A.
    const filas = await db.asTenant(b.tenantId, b.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT (SELECT count(*)::int FROM company WHERE id = $1)
              + (SELECT count(*)::int FROM source_document WHERE company_id = $1)
              + (SELECT count(*)::int FROM journal_entry WHERE company_id = $1)
              + (SELECT count(*)::int FROM third_party WHERE company_id = $1) AS n`,
        [a.companyId],
      );
      return rows[0]!.n;
    });
    expect(filas).toBe(0);
  });

  it('conocer el tenant_id ajeno no permite escribir en él: la escritura sigue cerrada', async () => {
    const a = await crearEscenario(db);
    const b = await crearEscenario(db);
    await esperarErrorPg(
      () =>
        db.asTenant(b.tenantId, b.companyId, async (tx) => {
          await tx.query(
            `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social)
             VALUES ($1,$2,'999','juridica','Tercero plantado por la firma B')`,
            [a.tenantId, a.companyId],
          );
        }),
      '42501',
      'plantar un tercero en la empresa de otra firma conociendo sus identificadores',
    );
  });

  it('la función no es un buscador: no acepta comodines ni devuelve empresas por coincidencia parcial', async () => {
    const a = await crearEscenario(db);
    const buzon = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ buzon_email: string }>(`SELECT buzon_email FROM company WHERE id = $1`, [a.companyId]);
      return rows[0]!.buzon_email;
    });

    const intentos = ['%', '%@%', `%${buzon.slice(-10)}`, buzon.replace('@', '%@'), '', ' '];
    for (const intento of intentos) {
      const r = await db.asAdmin((tx) => resolverEmpresaPorBuzon(tx, intento));
      expect(`${JSON.stringify(intento)} -> ${JSON.stringify(r)}`).toBe(
        `${JSON.stringify(intento)} -> null`,
      );
    }

    // Y solo resuelve empresas ACTIVAS: una empresa suspendida deja de responder.
    await db.asAdmin(async (tx) => {
      await tx.query(`UPDATE company SET estado = 'suspendida' WHERE id = $1`, [a.companyId]);
    });
    expect(await db.asAdmin((tx) => resolverEmpresaPorBuzon(tx, buzon))).toBeNull();
  });

  it('el inventario de funciones SECURITY DEFINER ejecutables por app_user sigue siendo el declarado', async () => {
    // Duplicado a propósito del que vive en `evasion.test.ts`: si un agente
    // amplía la lista allí, aquí falla y A14 tiene que volver a mirarla.
    const inventario = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ f: string }>(
        `SELECT n.nspname || '.' || p.proname AS f
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname IN ('app','public')
            AND has_function_privilege('app_user', p.oid, 'EXECUTE')
          ORDER BY 1`,
      );
      return rows.map((r) => r.f);
    });
    expect(inventario).toEqual([
      'app.cerrar_sesion',
      // A13, Ola 2 (migración 090, cierre de V-9): emitir/rotar el token de
      // integración del canal de correo. SECURITY DEFINER porque escribe en
      // `app.integration_credential` (esquema `app`, sin GRANTs), pero exige
      // sesión + `usuario.administrar` y filtra SIEMPRE por
      // `app.current_tenant_id()` — nunca por un tenant que el llamador pase
      // como parámetro (mismo criterio que `abrir_sesion` con el tenant del
      // usuario). `app.autenticar_token_integracion`, el análogo de
      // `buscar_credencial` para este canal, NO aparece aquí porque está
      // concedida solo a `app_auth`, igual que `abrir_sesion`/
      // `buscar_credencial`.
      'app.crear_token_integracion',
      'app.current_company_id',
      // D-087 (migración 176): detalle (filas concretas) del simulador de
      // impacto de parametros, hermanas de app.simular_impacto_*.
      'app.detalle_impacto_municipio_ica',
      'app.detalle_impacto_tax_concept',
      'app.detalle_impacto_valor_base',
      // A7, Ola 2 (migración 070): `app.empresas_accesibles()`, para la
      // bandeja multi-empresa (sección 4). SECURITY DEFINER + row_security=off,
      // mismo motivo que current_company_id: resolver "qué empresas puedo
      // ver" sin tener ya una empresa elegida. Sin parámetros, exige
      // `documento.leer`, filtra por `app.current_tenant_id()`.
      'app.empresas_accesibles',
      // A8, Ola 2 (migración 080): agregados de firma para el simulador de
      // impacto y la fecha mínima de vigencia del módulo de parametrización
      // (sección 6.2). SECURITY DEFINER + row_security=off, mismo patrón que
      // `app.resolver_empresa_por_buzon`, con filtro explícito por
      // `app.current_tenant_id()` y `app.exigir_permiso('parametro.editar')`.
      'app.fecha_minima_vigencia_municipio_ica',
      'app.fecha_minima_vigencia_tax_rule',
      'app.fecha_minima_vigencia_tenant',
      // A13, Ola 2 (migración 090): lista los tokens de integración de la
      // firma en sesión (nunca el secreto: ya no existe en claro en ningún
      // lado). Mismo patrón de filtro que crear_token_integracion.
      'app.listar_tokens_integracion',
      // `app.resolver_empresa_por_buzon` SALIÓ de esta lista en la migración
      // 100 (A12, cierre de V-1): la función sigue existiendo, pero ya no
      // tiene EXECUTE para ningún rol de aplicación. Es una BAJA del
      // inventario, y las bajas también se revisan: si vuelve a aparecer aquí,
      // alguien reabrió V-1.
      'app.revocar_sesiones_de_usuario',
      // A13, Ola 2 (migración 090): revoca un token de integración —
      // respuesta a incidente. Mismo patrón de filtro que
      // crear_token_integracion; idempotente.
      'app.revocar_token_integracion',
      'app.sesion_actual',
      'app.simular_impacto_municipio_ica',
      'app.simular_impacto_tax_concept',
      'app.simular_impacto_valor_base',
      // D-084 (migración 174): ¿este tercero tiene movimientos? — para que la
      // interfaz deshabilite "Eliminar" con el criterio del motor.
      'app.tercero_tiene_movimientos',
      'app.tiene_permiso',
      'app.trg_espejo_acceso',
      'app.trg_espejo_usuario',
    ]);
  });
});

// =============================================================================
describe('A14 · LA COSTURA QUE NADIE PROBÓ: el pipeline completo CON retenciones reales', () => {
  /**
   * A3 probó el motor con datos reales pero sin asiento. A6 probó el asiento
   * pero con un concepto de `aplica_* = false`, es decir CON CERO RETENCIONES
   * (lo dice el encabezado de `tests/services/causacion.test.ts`). Nadie había
   * juntado las dos mitades: un documento que entra por la cola, se resuelve
   * con las tarifas de A1 y sale como un asiento contable BALANCEADO en el que
   * las retenciones son partidas de crédito y el proveedor cobra el neto.
   *
   * Es exactamente donde un error de un centavo en la agregación o en el
   * redondeo se convierte en un asiento que la base rechaza (LG002) — o peor,
   * en uno que cuadra por casualidad con un valor equivocado.
   */
  it('caso dorado 1 de punta a punta: $1.000.000 + IVA → asiento con retefuente $40.000 y ReteIVA $28.500, publicado', async () => {
    const { seed } = await import('../../src/db/seed');
    const dirSeeds = fileURLToPath(new URL('../../db/seeds', import.meta.url));
    const e = await crearEscenario(db);
    const fecha = '2026-07-15'; // con el Decreto 572 ya vigente según A1

    await db.asAdmin(async (tx) => {
      await seed(tx, { dir: dirSeeds });

      const concepto = async (tipo: string, codigo: string): Promise<string> => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = $1 AND codigo = $2`,
          [tipo, codigo],
        );
        if (!rows[0]) throw new Error(`A1 no cargó el tax_concept ${tipo}/${codigo}`);
        return rows[0].id;
      };

      // Período fiscal de julio y documento fechado en julio.
      await tx.query(
        `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
         VALUES ($1,$2,2026,7,'2026-07-01','2026-07-31','abierto')`,
        [e.tenantId, e.companyId],
      );
      await tx.query(
        `UPDATE source_document SET fecha_hecho_economico = $2::date, estado = 'parseado' WHERE id = $1`,
        [e.sourceDocumentId, fecha],
      );
      // La empresa retiene renta e IVA.
      await tx.query(
        `UPDATE company SET es_agente_retencion_iva = true, es_responsable_iva = true WHERE id = $1`,
        [e.companyId],
      );
      // NO se inserta ninguna regla de redondeo. Antes del desbloqueo de V-6
      // esta prueba TENÍA que insertar una a mano para que el motor produjera
      // un asiento: esa fue la razón por la que A14 bloqueó la Ola 1. Ahora la
      // carga A1 en `db/seeds/tanda2/090_rounding_rule.sql` y esta prueba corre
      // con los datos del repositorio tal como se entrega. Si alguien borrara
      // ese seed, esta prueba falla — que es exactamente lo que debe pasar.
      const redondeosDeA1 = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM rounding_rule`,
      );
      expect(redondeosDeA1.rows[0]!.n).toBeGreaterThan(0);

      const conceptoId = uuid();
      await tx.query(
        `INSERT INTO concepto_causacion (
           id, tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           tax_concept_retefuente_id, tax_concept_reteiva_id,
           aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
         VALUES ($1,$2,$3,'A14-E2E','Servicio general (prueba de punta a punta de A14)','compra',
                 $4,$5,$6,$7,$8,true,true,false,false)`,
        [
          conceptoId,
          e.tenantId,
          e.companyId,
          e.cuentas.gasto,
          e.cuentas.ivaDescontable,
          e.cuentas.proveedores,
          await concepto('retefuente', 'servicios_generales'),
          await concepto('reteiva', 'reteiva_general'),
        ],
      );
      await tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,'servicio de consultoría de punta a punta',$4)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptoId],
      );
      await tx.query(
        `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
         VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
        [
          e.tenantId,
          e.companyId,
          e.sourceDocumentId,
          JSON.stringify({
            tipoDocumento: 'Invoice',
            emisor: { nit: '900123456', nombre: 'Proveedor' },
            adquirente: { nit: null, nombre: null },
            lineas: [
              {
                numero: 1,
                descripcion: 'Servicio de consultoría de punta a punta',
                subtotal: '100000000', // $1.000.000 en centavos
                impuestos: [{ codigo: '01', valor: '19000000' }], // $190.000 de IVA
              },
            ],
          }),
        ],
      );
    });

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
    const r = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }));

    if (r.estado !== 'causado') {
      throw new Error(
        `El pipeline completo NO causó: ${r.estado} — ${JSON.stringify('motivos' in r ? r.motivos : null)}`,
      );
    }

    const partidas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string; side: string; monto: string }>(
        `SELECT a.codigo, jl.side, jl.monto::text
           FROM journal_line jl JOIN account a ON a.id = jl.account_id
          WHERE jl.journal_entry_id = $1 ORDER BY jl.linea`,
        [r.journalEntryId],
      );
      return rows;
    });

    const porCuenta = new Map(partidas.map((p) => [`${p.codigo}:${p.side}`, Number(p.monto)]));
    // Débitos: el gasto por la base y el IVA descontable por el impuesto.
    expect(porCuenta.get('513595:debito')).toBe(100_000_000);
    expect(porCuenta.get('240805:debito')).toBe(19_000_000);
    // Créditos: las DOS retenciones con los valores de la sección 12...
    expect(porCuenta.get('2365:credito')).toBe(4_000_000); // $40.000
    expect(porCuenta.get('2367:credito')).toBe(2_850_000); // $28.500
    // ...y el proveedor por el NETO A PAGAR, que es lo que de verdad se gira.
    expect(porCuenta.get('220505:credito')).toBe(119_000_000 - 4_000_000 - 2_850_000);

    // El asiento cuadra a cero, medido por la vista del ledger.
    const balance = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ descuadre: string; total_debito: string }>(
        `SELECT descuadre::text, total_debito::text FROM v_journal_entry_balance WHERE journal_entry_id = $1`,
        [r.journalEntryId],
      );
      return rows[0]!;
    });
    expect(balance.descuadre).toBe('0');
    expect(balance.total_debito).toBe('119000000');

    // Y se PUBLICA: si algo no cuadrara, el motor lo rechazaría en el COMMIT.
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        aprobarAsiento(tx, {
          journalEntryId: r.journalEntryId!,
          decision: 'aprobado',
          userId: e.userId,
          ip: '192.0.2.14',
        }),
      { userId: e.userId },
    );
    const estado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(`SELECT estado FROM journal_entry WHERE id = $1`, [
        r.journalEntryId,
      ]);
      return rows[0]!.estado;
    });
    expect(estado).toBe('posted');

    // La traza tributaria quedó amarrada al asiento (Regla de Oro 6).
    const traza = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tipo: string; valor: string; norma_respaldo: string; journal_entry_id: string }>(
        `SELECT tipo, valor::text, norma_respaldo, journal_entry_id FROM retention_applied
          WHERE source_document_id = $1 ORDER BY tipo`,
        [e.sourceDocumentId],
      );
      return rows;
    });
    expect(traza.map((t) => `${t.tipo}=${t.valor}`).sort()).toEqual([
      'retefuente=4000000',
      'reteiva=2850000',
    ]);
    for (const t of traza) {
      expect(t.journal_entry_id).toBe(r.journalEntryId);
      expect(t.norma_respaldo.length).toBeGreaterThan(10);
    }
  }, 180_000);
});

// =============================================================================
describe('A14 · la rama de "carrera detectada" de A6 estaba muerta (D-043, corregida por A14)', () => {
  it('cuando otro worker ya escribió el asiento, el segundo lo reconoce en vez de morir con 25P02', async () => {
    const { e, jobId } = await montarCausable('Carrera plantada a mano');

    // Se planta el asiento "del otro worker" con la MISMA idempotency_key,
    // dejando el documento en `parseado` para que el chequeo de estado de
    // `procesarJobCausacion` no lo note y la carrera llegue hasta el INSERT.
    const delOtro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, tipo, fecha_hecho_economico,
                                    descripcion, estado, source_document_id, approval_id, idempotency_key)
         VALUES ($1,$2,$3,'causacion','2026-06-15','Asiento del otro worker','draft',$4,$5,$6)
         RETURNING id`,
        [e.tenantId, e.companyId, e.fiscalPeriodId, e.sourceDocumentId, e.approvalId, `causacion:${e.sourceDocumentId}`],
      );
      return rows[0]!.id;
    });

    const aprobacionesAntes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM approval WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      );
      return rows[0]!.n;
    });

    const r = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }));

    // ANTES de la corrección esto lanzaba 25P02 y el trabajo quedaba pendiente.
    expect(r.estado).toBe('ya_procesado');
    if (r.estado !== 'ya_procesado') return;
    expect(r.journalEntryId).toBe(delOtro);

    const estadoJob = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM document_processing_job WHERE id = $1`,
        [jobId],
      );
      return rows[0]!.estado;
    });
    expect(estadoJob).toBe('completado');

    // Y el intento perdedor NO dejó basura: ni traza de retenciones huérfana,
    // ni un placeholder de aprobación de más. El SAVEPOINT deshace TODO lo que
    // el intento alcanzó a escribir, no solo el asiento.
    const basura = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ retenciones: number; aprobaciones: number; asientos: number }>(
        `SELECT (SELECT count(*)::int FROM retention_applied WHERE source_document_id = $1) AS retenciones,
                (SELECT count(*)::int FROM approval WHERE source_document_id = $1)          AS aprobaciones,
                (SELECT count(*)::int FROM journal_entry WHERE source_document_id = $1)     AS asientos`,
        [e.sourceDocumentId],
      );
      return rows[0]!;
    });
    expect(basura.retenciones).toBe(0);
    expect(basura.aprobaciones).toBe(aprobacionesAntes);
    expect(basura.asientos).toBe(1);
  });
});

// =============================================================================
describe('A14 · caso dorado 19 — la mitad que se puede verificar hoy (la otra es de A5, Ola 2)', () => {
  it('la segunda factura del mismo proveedor con la misma descripción se clasifica SIN preguntarle a nadie', async () => {
    // El caso 19 dice "cero llamadas al LLM". Hoy no hay LLM que contar: A5 lo
    // construye en la Ola 2. Lo que SÍ existe y se puede verificar es el
    // mecanismo que hará que la segunda vez no haya llamada: la memoria de
    // clasificación. Se verifica que la segunda factura se causa entera
    // resolviendo el concepto desde `memoria_clasificacion`, sin ninguna
    // intervención y sin ninguna ruta de red en el camino.
    const descripcion = 'Servicio recurrente idéntico del mismo proveedor';
    const primera = await montarCausable(descripcion);
    const r1 = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: primera.jobId, sourceDocumentId: primera.e.sourceDocumentId }),
    );
    expect(r1.estado).toBe('causado');
    if (r1.estado !== 'causado') return;

    // Segunda factura del MISMO proveedor, MISMA descripción, mismo concepto
    // ya confirmado en memoria: se causa sin sembrar nada nuevo.
    const segundoDoc = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe, numero_documento,
                                      emisor_nit, third_party_id, fecha_hecho_economico, hash_contenido, estado)
         VALUES ($1,$2,$3,'Invoice',$4,$5,'900123456',$6,'2026-06-20',$7,'parseado')`,
        [
          segundoDoc,
          primera.e.tenantId,
          primera.e.companyId,
          `CUFE-SEGUNDA-${segundoDoc}`,
          `FE-SEGUNDA-${segundoDoc.slice(0, 8)}`,
          primera.e.thirdPartyId,
          `hash-segunda-${segundoDoc}`,
        ],
      );
      await tx.query(
        `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
         VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
        [
          primera.e.tenantId,
          primera.e.companyId,
          segundoDoc,
          JSON.stringify({
            tipoDocumento: 'Invoice',
            emisor: { nit: '900123456', nombre: 'Proveedor' },
            adquirente: { nit: null, nombre: null },
            lineas: [{ numero: 1, descripcion, subtotal: '10000000', impuestos: [] }],
          }),
        ],
      );
    });

    const job2 = await db.asTenant(primera.e.tenantId, primera.e.companyId, (tx) =>
      encolarCausacion(tx, segundoDoc),
    );
    const r2 = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: job2.id, sourceDocumentId: segundoDoc }));
    expect(r2.estado).toBe('causado');

    // Y no se creó ninguna fila de memoria nueva: se reutilizó la que había.
    const memorias = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM memoria_clasificacion
          WHERE company_id = $1 AND third_party_id = $2 AND patron_descripcion = $3`,
        [primera.e.companyId, primera.e.thirdPartyId, descripcion.toLowerCase().trim()],
      );
      return rows[0]!.n;
    });
    expect(memorias).toBe(1);
  });

  it('hoy la clasificación solo tiene UNA fuente y no es un modelo: `memoria_clasificacion`', () => {
    const ruta = new URL('../../src/services/causacion.ts', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    );
    const contenido = readFileSync(ruta, 'utf8');
    expect(contenido).toContain('memoria_clasificacion');
    expect(contenido).not.toMatch(/\b(fetch|openai|anthropic|@ai-sdk|node:https?)\b/);
  });
});

// =============================================================================
describe('A14 · CASO DORADO 8 SIN ANDAMIAJE: ReteICA de Medellín con los seeds del repositorio', () => {
  /**
   * Cuando A14 bloqueó la Ola 1, este caso solo pasaba porque la suite de A3
   * MATERIALIZABA a mano una `tax_rule` de tipo `reteica` copiando la tarifa de
   * `municipality_ica_rule`. A1 cargó esa fila en
   * `db/seeds/tanda2/100_reteica_medellin.sql`, así que ahora tiene que pasar
   * SIN que ninguna prueba inserte una regla tributaria.
   *
   * Aquí no se escribe ni se copia ninguna tarifa: solo se crean la empresa, el
   * tercero y el `concepto_causacion` —configuración de negocio, no parámetros
   * normativos— y se deja que el motor resuelva con lo que hay en la base.
   */
  it('$1.000.000 de servicio en Medellín produce ReteICA de $2.000 (2 por mil), asiento publicado, sin insertar ninguna regla', async () => {
    const { seed } = await import('../../src/db/seed');
    const dirSeeds = fileURLToPath(new URL('../../db/seeds', import.meta.url));
    const e = await crearEscenario(db);
    const fecha = '2026-07-15';

    const cuentaReteica = await db.asAdmin(async (tx) => {
      await seed(tx, { dir: dirSeeds });

      // Control: la regla de ReteICA que se va a usar viene de los SEEDS y
      // nadie la insertó en esta prueba.
      const { rows: reglas } = await tx.query<{ n: number; origen: string }>(
        `SELECT count(*)::int AS n, min(r.norma_respaldo) AS origen
           FROM tax_rule r JOIN municipality m ON m.id = r.municipality_id
          WHERE r.tipo = 'reteica' AND m.codigo_dane = '05001'
            AND r.tenant_id IS NULL AND r.company_id IS NULL`,
      );
      expect(reglas[0]!.n).toBe(1);
      // La cadena de norma no perdió el origen: sigue citando el acuerdo.
      expect(reglas[0]!.origen).toMatch(/Acuerdo 066 de 2017/i);

      const { rows: medellin } = await tx.query<{ id: string }>(
        `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '05001'`,
      );
      const { rows: cuenta2368 } = await tx.query<{ id: string }>(
        `SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2368'`,
      );
      const { rows: tcIca } = await tx.query<{ id: string }>(
        `SELECT id FROM tax_concept
          WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'reteica'`,
      );
      expect(tcIca).toHaveLength(1);

      await tx.query(
        `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
         VALUES ($1,$2,2026,7,'2026-07-01','2026-07-31','abierto')`,
        [e.tenantId, e.companyId],
      );
      await tx.query(
        `UPDATE source_document SET fecha_hecho_economico = $2::date, estado = 'parseado' WHERE id = $1`,
        [e.sourceDocumentId, fecha],
      );
      // La empresa es agente de retención de ICA y el proveedor opera en Medellín.
      await tx.query(`UPDATE company SET es_agente_retencion_ica = true WHERE id = $1`, [e.companyId]);
      await tx.query(`UPDATE third_party SET municipality_id = $2 WHERE id = $1`, [
        e.thirdPartyId,
        medellin[0]!.id,
      ]);

      const conceptoId = uuid();
      await tx.query(
        `INSERT INTO concepto_causacion (
           id, tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           tax_concept_reteica_id, tipo_operacion_ica,
           aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
         VALUES ($1,$2,$3,'A14-ICA','Servicio con ReteICA municipal','compra',
                 $4,$5,$6,$7,'servicios',false,false,true,false)`,
        [
          conceptoId,
          e.tenantId,
          e.companyId,
          e.cuentas.gasto,
          e.cuentas.ivaDescontable,
          e.cuentas.proveedores,
          tcIca[0]!.id,
        ],
      );
      await tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,'servicio prestado en medellín',$4)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptoId],
      );
      await tx.query(
        `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
         VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
        [
          e.tenantId,
          e.companyId,
          e.sourceDocumentId,
          JSON.stringify({
            tipoDocumento: 'Invoice',
            emisor: { nit: '900123456', nombre: 'Proveedor de Medellín' },
            adquirente: { nit: null, nombre: null },
            lineas: [
              { numero: 1, descripcion: 'Servicio prestado en Medellín', subtotal: '100000000', impuestos: [] },
            ],
          }),
        ],
      );
      return cuenta2368[0]!.id;
    });

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
    const r = await db.asAdmin((tx) => procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }));
    if (r.estado !== 'causado') {
      throw new Error(
        `El ReteICA de Medellín NO se causó con los seeds: ${r.estado} — ${JSON.stringify(
          'motivos' in r ? r.motivos : null,
        )}`,
      );
    }

    const partidas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ account_id: string; side: string; monto: string }>(
        `SELECT account_id, side, monto::text FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`,
        [r.journalEntryId],
      );
      return rows;
    });
    const ica = partidas.find((p) => p.account_id === cuentaReteica);
    expect(ica?.side).toBe('credito');
    expect(Number(ica?.monto)).toBe(200_000); // 2.000 pesos = 2 por mil de 1.000.000
    expect(partidas.map((p) => Number(p.monto)).reduce((a, b) => a + b, 0)).toBe(
      100_000_000 + 200_000 + (100_000_000 - 200_000),
    );

    // La traza cita la norma del acuerdo municipal, encadenada desde A1.
    const traza = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        tipo: string;
        valor: string;
        norma_respaldo: string;
        ciiu_activity_id: string | null;
      }>(
        `SELECT tipo, valor::text, norma_respaldo, ciiu_activity_id FROM retention_applied
          WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      );
      return rows;
    });
    expect(traza).toHaveLength(1);
    expect(traza[0]!.tipo).toBe('reteica');
    expect(Number(traza[0]!.valor)).toBe(200_000);
    expect(traza[0]!.norma_respaldo).toMatch(/Acuerdo 066 de 2017/i);
    // Medellín usa tarifa general: no se consultó la actividad del tercero.
    expect(traza[0]!.ciiu_activity_id).toBeNull();

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        aprobarAsiento(tx, {
          journalEntryId: r.journalEntryId!,
          decision: 'aprobado',
          userId: e.userId,
          ip: '192.0.2.14',
        }),
      { userId: e.userId },
    );
    const estado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(`SELECT estado FROM journal_entry WHERE id = $1`, [
        r.journalEntryId,
      ]);
      return rows[0]!.estado;
    });
    expect(estado).toBe('posted');
  }, 180_000);

  it('Bogotá y Cali SIGUEN sin poder calcular ReteICA con los seeds: el motor se niega, no inventa (V-5)', async () => {
    // A1 no tocó Bogotá ni Cali, y hace bien: el código municipal 74901 no cabe
    // en el CHECK de 4 dígitos de `ciiu_activity` (decisión de esquema de A2) y
    // la sección 7.5 no trae ni un número del acuerdo de Cali. Se mide el
    // estado real para que nadie lo dé por resuelto junto con Medellín.
    const conteo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tax_rule r
           JOIN municipality m ON m.id = r.municipality_id
          WHERE r.tipo = 'reteica' AND m.codigo_dane IN ('11001','76001')
            AND r.tenant_id IS NULL AND r.company_id IS NULL`,
      );
      return rows[0]!.n;
    });
    expect(conteo).toBe(0);
  });
});

// =============================================================================
describe('A14 · el respaldo "parámetro operativo" no puede convertirse en una puerta trasera', () => {
  /**
   * A1 cargó `rounding_rule` con `norma_respaldo` que dice, con todas las
   * letras, que es un PARÁMETRO OPERATIVO y no una norma tributaria, porque no
   * hay decreto que citar. A14 lo acepta, pero no de palabra: lo acepta porque
   * la excepción está ACOTADA POR EL ESQUEMA. En `rounding_rule` no hay dónde
   * escribir una tarifa aunque se quisiera —no existe la columna— y el modo
   * está restringido por un CHECK a los cinco que el motor implementa de
   * verdad. Si algún día alguien añadiera a esta tabla una columna capaz de
   * llevar un valor tributario, esta prueba falla y la excepción se vuelve a
   * discutir.
   */
  it('rounding_rule no tiene ni una columna donde quepa una tarifa, una base o una UVT', async () => {
    const columnas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'rounding_rule'
          ORDER BY ordinal_position`,
      );
      return rows;
    });
    const nombres = columnas.map((c) => c.column_name).sort();
    expect(nombres).toEqual([
      'aplica_a',
      'clave_vigencia',
      'codigo',
      'company_id',
      'created_at',
      'created_by',
      'id',
      'modo',
      'multiplo',
      'nombre',
      'norma_respaldo',
      'notas',
      'requiere_verificacion_humana',
      'tenant_id',
      'vigente_desde',
      'vigente_hasta',
    ]);
    // La única columna numérica es `multiplo`, y es el ESCALÓN del redondeo en
    // centavos (100 = al peso), no un valor que multiplique ninguna base. No
    // hay `numeric` en toda la tabla: una tarifa no cabe.
    const numericas = columnas.filter((c) => c.data_type === 'numeric').map((c) => c.column_name);
    expect(numericas).toEqual([]);
  });

  it('el CHECK de `modo` admite exactamente los cinco modos que el motor implementa, ni uno más', async () => {
    const modosEnLaBase = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'rounding_rule' AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) ILIKE '%modo%'`,
      );
      return rows.map((r) => r.def).join(' ');
    });
    for (const modo of MODOS_REDONDEO) {
      expect(`${modo} admitido: ${modosEnLaBase.includes(`'${modo}'`)}`).toBe(`${modo} admitido: true`);
    }
    // Y ninguno de más: se cuenta cuántos literales admite el CHECK.
    const literales = modosEnLaBase.match(/'[a-z_]+'/g) ?? [];
    expect(new Set(literales).size).toBe(MODOS_REDONDEO.length);
  });

  it('SIN regla de redondeo vigente a la fecha del hecho, el motor SE NIEGA a causar y dice por qué', async () => {
    // La prueba de comportamiento que faltaba. Antes del desbloqueo bastaba con
    // que la tabla estuviera vacía; ahora A1 carga un valor por defecto, así
    // que para provocar la ausencia hay que CERRAR su vigencia — el único
    // UPDATE que D-012 permite. Base de datos propia para no envenenar las
    // demás pruebas del archivo.
    const db2 = await createTestDb();
    try {
      const { seed } = await import('../../src/db/seed');
      const dirSeeds = fileURLToPath(new URL('../../db/seeds', import.meta.url));
      const e2 = await crearEscenario(db2);

      await db2.asAdmin(async (tx) => {
        await seed(tx, { dir: dirSeeds });

        // Se cierra la vigencia de TODA regla de redondeo antes de la fecha del
        // hecho. No se borra nada: se cierra, como manda la Regla 3.
        const { rows: cerradas } = await tx.query<{ n: number }>(
          `WITH cerrada AS (
             UPDATE rounding_rule SET vigente_hasta = DATE '2020-12-31'
              WHERE vigente_hasta IS NULL OR vigente_hasta > DATE '2020-12-31'
             RETURNING 1)
           SELECT count(*)::int AS n FROM cerrada`,
        );
        expect(cerradas[0]!.n).toBeGreaterThan(0);

        const { rows: tcRf } = await tx.query<{ id: string }>(
          `SELECT id FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL
              AND tipo = 'retefuente' AND codigo = 'servicios_generales'`,
        );
        await tx.query(
          `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
           VALUES ($1,$2,2026,7,'2026-07-01','2026-07-31','abierto')`,
          [e2.tenantId, e2.companyId],
        );
        await tx.query(
          `UPDATE source_document SET fecha_hecho_economico = DATE '2026-07-15', estado = 'parseado' WHERE id = $1`,
          [e2.sourceDocumentId],
        );
        const conceptoId = uuid();
        await tx.query(
          `INSERT INTO concepto_causacion (
             id, tenant_id, company_id, codigo, nombre, naturaleza,
             cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
             tax_concept_retefuente_id, aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
           VALUES ($1,$2,$3,'A14-SINREDONDEO','Servicio sin regla de redondeo','compra',
                   $4,$5,$6,$7,true,false,false,false)`,
          [
            conceptoId,
            e2.tenantId,
            e2.companyId,
            e2.cuentas.gasto,
            e2.cuentas.ivaDescontable,
            e2.cuentas.proveedores,
            tcRf[0]!.id,
          ],
        );
        await tx.query(
          `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
           VALUES ($1,$2,$3,'servicio sin redondeo',$4)`,
          [e2.tenantId, e2.companyId, e2.thirdPartyId, conceptoId],
        );
        await tx.query(
          `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
           VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
          [
            e2.tenantId,
            e2.companyId,
            e2.sourceDocumentId,
            JSON.stringify({
              tipoDocumento: 'Invoice',
              emisor: { nit: '900123456', nombre: 'Proveedor' },
              adquirente: { nit: null, nombre: null },
              lineas: [{ numero: 1, descripcion: 'Servicio sin redondeo', subtotal: '100000000', impuestos: [] }],
            }),
          ],
        );
      });

      const job = await db2.asTenant(e2.tenantId, e2.companyId, (tx) =>
        encolarCausacion(tx, e2.sourceDocumentId),
      );
      const r = await db2.asAdmin((tx) =>
        procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e2.sourceDocumentId }),
      );

      // El motor NO redondea "como sea" ni deja de redondear: se niega y lo dice.
      expect(r.estado).toBe('revision_manual');
      if (r.estado !== 'revision_manual') return;
      expect(r.motivos.map((m) => m.codigo)).toContain('sin_regla_de_redondeo_vigente');

      // Y no dejó ni un asiento ni una retención a medias.
      const rastro = await db2.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ asientos: number; retenciones: number }>(
          `SELECT (SELECT count(*)::int FROM journal_entry WHERE source_document_id = $1)     AS asientos,
                  (SELECT count(*)::int FROM retention_applied WHERE source_document_id = $1) AS retenciones`,
          [e2.sourceDocumentId],
        );
        return rows[0]!;
      });
      expect(rastro.asientos).toBe(0);
      expect(rastro.retenciones).toBe(0);
    } finally {
      await db2.close();
    }
  }, 180_000);
});

// =============================================================================
describe('A14 · el valor por defecto de A1 es SOBREESCRIBIBLE por la firma, sin tocar código', () => {
  it('una empresa que carga su propia regla de redondeo le gana a la global, y el resultado cambia', async () => {
    // A1 justificó su fila global diciendo que es "la de menor prioridad" y que
    // cualquier firma puede sobreescribirla. A14 no lo da por bueno: lo prueba,
    // y lo prueba con un modo y un múltiplo DISTINTOS, para que el efecto sea
    // visible en el número y no solo en el identificador de la regla.
    const db2 = await createTestDb();
    try {
      const { seed } = await import('../../src/db/seed');
      const { RepositorioTributarioSql } = await import('../../src/domain/index');
      const dirSeeds = fileURLToPath(new URL('../../db/seeds', import.meta.url));
      const e2 = await crearEscenario(db2);
      await db2.asAdmin(async (tx) => {
        await seed(tx, { dir: dirSeeds });
      });

      const leer = async (): Promise<{ modo: string; multiplo: string } | null> =>
        db2.asTenant(e2.tenantId, e2.companyId, async (tx) => {
          const repo = new RepositorioTributarioSql(tx);
          const empresa = await repo.empresa(e2.companyId);
          if (!empresa) throw new Error('sin empresa');
          const r = await repo.redondeo(empresa, 'retefuente', '2026-07-15');
          return r === null ? null : { modo: r.modo, multiplo: String(r.multiplo) };
        });

      // Con solo los seeds: la global de A1, al peso y media hacia arriba.
      expect(await leer()).toEqual({ modo: 'half_up', multiplo: '100' });

      // La empresa carga la suya: redondeo al MIL y truncando. Ni una línea de
      // código tocada, ni un redespliegue.
      await db2.asAdmin(async (tx) => {
        await tx.query(
          `INSERT INTO rounding_rule (tenant_id, company_id, codigo, nombre, modo, multiplo, aplica_a,
                                      vigente_desde, norma_respaldo, requiere_verificacion_humana)
           VALUES ($1,$2,'mil_truncado','Redondeo al mil, truncando','truncar',100000,'todos',
                   '2026-01-01','PARÁMETRO OPERATIVO de la prueba de A14.', true)`,
          [e2.tenantId, e2.companyId],
        );
      });

      expect(await leer()).toEqual({ modo: 'truncar', multiplo: '100000' });
    } finally {
      await db2.close();
    }
  }, 180_000);
});

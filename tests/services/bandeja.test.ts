/**
 * A7 — Bandeja de causación multi-empresa (Ola 2, sección 4).
 *
 * Tres cosas se prueban aquí, con el pipeline REAL (worker + motor de A3 +
 * datos de A1), no con dobles:
 *
 *  1. `listarEmpresasAccesibles`: la lista de las empresas de una sesión sin
 *     tener que "probar" ninguna que no le pertenezca.
 *  2. V-7 (AIU por línea) de punta a punta: un documento con un concepto
 *     `base_es_aiu` cae en revisión manual porque el parser no discrimina el
 *     AIU (esto ya lo probaba el motor de A3 en solitario); lo nuevo es que
 *     un humano lo captura en la bandeja, pide reproceso, y el SEGUNDO
 *     intento causa con el AIU como base — con la MISMA regla y vigencia
 *     reales de A1 (Decreto 572 de 2025).
 *  3. V-8 (municipio de la operación) de punta a punta: el municipio por
 *     defecto del tercero no tiene ReteICA parametrizado (cae en revisión
 *     manual); un humano corrige el municipio a Medellín (la única tarifa de
 *     ICA real que carga A1, V-4) y el reproceso causa con esa tarifa.
 *
 * El caso dorado 10 y el caso dorado 11 ya estaban probados CONTRA EL MOTOR
 * (`tests/golden/casos-dorados.test.ts`); esto los cierra CONTRA EL CANAL
 * REAL, que es exactamente lo que V-7 y V-8 dejaron pendiente en el registro
 * de vulnerabilidades de la Ola 1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createTestDb, uuid, type TestDb } from '../helpers/db.js';
import { crearEscenario, type Escenario } from '../helpers/fixtures.js';
import { PermisoInsuficienteError } from '../../src/auth/permisos.js';
import { procesarJobCausacion } from '../../src/services/causacion.js';
import { encolarCausacion } from '../../src/services/cola.js';
import { consultarEstadoDocumento } from '../../src/services/consulta.js';
import {
  guardarCorreccionAiu,
  guardarCorreccionMunicipio,
  listarEmpresasAccesibles,
  listarPendientesRevision,
  reprocesarDocumento,
} from '../../src/services/bandeja.js';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

async function sembrarExtraccion(
  e: Escenario,
  lineas: { descripcion: string; baseGravable: number; valorIva: number }[],
  fecha: string,
): Promise<void> {
  await db.asAdmin(async (tx) => {
    await tx.query(`UPDATE source_document SET estado = 'parseado', fecha_hecho_economico = $2::date WHERE id = $1`, [
      e.sourceDocumentId,
      fecha,
    ]);
    await tx.query(
      `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
       VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        JSON.stringify({
          tipoDocumento: 'Invoice',
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

// =============================================================================
describe('listarEmpresasAccesibles — insumo de la bandeja multi-empresa', () => {
  it('lista solo las empresas con acceso vigente del usuario, nunca una tercera', async () => {
    const e1 = await crearEscenario(db);
    const empresaDos = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id, buzon_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [empresaDos, e1.tenantId, '800999888', 'Segunda empresa cliente', e1.municipalityId, e1.ciiuId, `empresa2-${empresaDos}@inbox.ejemplo.co`],
      ),
    );
    // Una tercera empresa de la MISMA firma, a la que el usuario NUNCA recibe acceso.
    const empresaAjena = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id, buzon_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [empresaAjena, e1.tenantId, '800999777', 'Empresa sin acceso', e1.municipalityId, e1.ciiuId, `empresa3-${empresaAjena}@inbox.ejemplo.co`],
      ),
    );

    // El mismo usuario recibe acceso también a la segunda empresa.
    await db.asTenant(e1.tenantId, empresaDos, async () => {}, { userId: e1.userId, rolCodigo: 'contador' });

    const empresas = await db.asTenant(e1.tenantId, e1.companyId, (tx) => listarEmpresasAccesibles(tx), {
      userId: e1.userId,
    });

    const ids = empresas.map((x) => x.companyId).sort();
    expect(ids).toEqual([e1.companyId, empresaDos].sort());
    expect(ids).not.toContain(empresaAjena);
    // Viene ordenado por razón social, y trae el rol de negocio de esa empresa.
    const dos = empresas.find((x) => x.companyId === empresaDos);
    expect(dos?.rolCodigo).toBe('contador');
  });

  it('no cruza de una firma a otra', async () => {
    const alfa = await crearEscenario(db);
    const beta = await crearEscenario(db);

    const empresasDeAlfa = await db.asTenant(alfa.tenantId, alfa.companyId, (tx) => listarEmpresasAccesibles(tx), {
      userId: alfa.userId,
    });
    expect(empresasDeAlfa.map((x) => x.companyId)).toEqual([alfa.companyId]);
    expect(empresasDeAlfa.map((x) => x.companyId)).not.toContain(beta.companyId);
  });
});

// =============================================================================
describe('V-7 — AIU por línea, de punta a punta (caso dorado 11 por el canal real)', () => {
  async function montarConceptoAiu(e: Escenario, dirSeeds: string): Promise<string> {
    return db.asAdmin(async (tx) => {
      const { seed } = await import('../../src/db/seed.js');
      await seed(tx, { dir: dirSeeds });

      const { rows: tc } = await tx.query<{ id: string }>(
        `SELECT id FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL
          AND tipo = 'retefuente' AND codigo = 'vigilancia_aseo'`,
      );
      if (!tc[0]) throw new Error('A1 no cargó el tax_concept retefuente/vigilancia_aseo');

      await tx.query(
        `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
         VALUES ($1,$2,2026,7,'2026-07-01','2026-07-31','abierto')`,
        [e.tenantId, e.companyId],
      );

      const conceptoId = uuid();
      await tx.query(
        `INSERT INTO concepto_causacion (
           id, tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           tax_concept_retefuente_id, aplica_retefuente, aplica_reteiva, aplica_reteica,
           aplica_autorretencion, base_es_aiu, porcentaje_aiu_minimo)
         VALUES ($1,$2,$3,'A7-AIU','Vigilancia (prueba V-7 de A7)','compra',
                 $4,$5,$6,$7,true,false,false,false,true,0)`,
        [conceptoId, e.tenantId, e.companyId, e.cuentas.gasto, e.cuentas.ivaDescontable, e.cuentas.proveedores, tc[0].id],
      );
      await tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,'servicio de vigilancia de prueba v-7',$4)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptoId],
      );
      return conceptoId;
    });
  }

  it('sin AIU discriminado va a revisión manual; corregido y reencolado, causa sobre el AIU', async () => {
    const dirSeeds = fileURLToPath(new URL('../../db/seeds', import.meta.url));
    const e = await crearEscenario(db);
    await montarConceptoAiu(e, dirSeeds);
    await sembrarExtraccion(
      e,
      [{ descripcion: 'Servicio de vigilancia de prueba V-7', baseGravable: 5_000_000_00, valorIva: 0 }],
      '2026-07-15',
    );

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
    const primero = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(primero.estado).toBe('revision_manual');
    if (primero.estado !== 'revision_manual') return;
    expect(primero.motivos.map((m) => m.codigo)).toContain('concepto_aiu_sin_aiu_declarado');

    // El documento sigue sin causar: ni un journal_entry, sigue 'parseado'.
    const { rows: sinAsiento } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(`SELECT count(*)::text AS total FROM journal_entry WHERE source_document_id = $1`, [
        e.sourceDocumentId,
      ]),
    );
    expect(sinAsiento[0]?.total).toBe('0');

    // La bandeja de revisión lo muestra, con las líneas del documento y la señal de "necesita AIU".
    const pendientes = await db.asTenant(e.tenantId, e.companyId, (tx) => listarPendientesRevision(tx), {
      userId: e.userId,
    });
    const enRevision = pendientes.find((d) => d.sourceDocumentId === e.sourceDocumentId);
    expect(enRevision).toBeDefined();
    expect(enRevision?.requiereAiu).toBe(true);
    expect(enRevision?.lineas).toHaveLength(1);
    expect(enRevision?.lineas[0]?.baseGravable).toBe(5_000_000_00);

    // Un auxiliar de causación NO puede capturar la corrección (no tiene
    // documento.reprocesar). Sin `userId` explícito a propósito: el harness
    // crea un usuario técnico PROPIO de ese rol (D-004 del harness), para que
    // el permiso `contador` que `crearEscenario` ya le dio a `e.userId` no se
    // cuele por reutilizar la misma identidad.
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          guardarCorreccionAiu(tx, {
            sourceDocumentId: e.sourceDocumentId,
            lineaNumero: 1,
            valorAiuCentavos: 500_000_00,
            motivo: 'intento sin permiso',
          }),
        { rolCodigo: 'auxiliar_causacion' },
      ),
    ).rejects.toThrow(PermisoInsuficienteError);

    // El contador sí: captura el AIU real ($500.000) y pide el reproceso.
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        guardarCorreccionAiu(tx, {
          sourceDocumentId: e.sourceDocumentId,
          lineaNumero: 1,
          valorAiuCentavos: 500_000_00,
          motivo: 'AIU tomado de la representación gráfica de la factura, no discriminado por el parser (V-7).',
        }),
      { userId: e.userId, rolCodigo: 'contador' },
    );
    await db.asTenant(e.tenantId, e.companyId, (tx) => reprocesarDocumento(tx, e.sourceDocumentId), {
      userId: e.userId,
      rolCodigo: 'contador',
    });

    const segundo = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(segundo.estado).toBe('causado');
    if (segundo.estado !== 'causado') return;

    // Base, tarifa, norma y vigencia — visibles, sobre el AIU y no sobre el total.
    const estado = await db.asTenant(e.tenantId, e.companyId, (tx) => consultarEstadoDocumento(tx, e.sourceDocumentId), {
      userId: e.userId,
    });
    const retefuente = estado?.retenciones.find((r) => r.tipo === 'retefuente');
    expect(retefuente).toBeDefined();
    expect(retefuente?.base).toBe('50000000'); // el AIU ($500.000), NO el total ($5.000.000)
    expect(retefuente?.tarifa).toBe('0.020000'); // 2% de vigilancia y aseo
    expect(retefuente?.valor).toBe('1000000'); // $10.000
    expect(retefuente?.normaRespaldo).toContain('Decreto 572');
    expect(retefuente?.vigenteDesde).toBe('2026-07-01');
    expect(retefuente?.vigenteHasta).toBeNull();

    // La partida del asiento también queda visible con su cuenta.
    expect(estado?.asiento?.partidas.length).toBeGreaterThan(0);
  });
});

// =============================================================================
describe('V-8 — municipio de la operación, de punta a punta (caso dorado 10 por el canal real)', () => {
  it('el municipio del tercero no tiene ReteICA; corregido a Medellín, causa con la tarifa real de A1', async () => {
    const dirSeeds = fileURLToPath(new URL('../../db/seeds', import.meta.url));
    const e = await crearEscenario(db);

    const medellinId = await db.asAdmin(async (tx) => {
      const { seed } = await import('../../src/db/seed.js');
      await seed(tx, { dir: dirSeeds });

      await tx.query(`UPDATE company SET es_agente_retencion_ica = true WHERE id = $1`, [e.companyId]);

      const { rows: tc } = await tx.query<{ id: string }>(
        `SELECT id FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL
          AND tipo = 'reteica' AND codigo = 'reteica_tarifa_general_municipio'`,
      );
      if (!tc[0]) throw new Error('A1 no cargó el tax_concept reteica/reteica_tarifa_general_municipio');

      const conceptoId = uuid();
      await tx.query(
        `INSERT INTO concepto_causacion (
           id, tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           tax_concept_reteica_id, aplica_retefuente, aplica_reteiva, aplica_reteica,
           aplica_autorretencion, tipo_operacion_ica)
         VALUES ($1,$2,$3,'A7-ICA','Servicio con ICA (prueba V-8 de A7)','compra',
                 $4,$5,$6,$7,false,false,true,false,'servicios')`,
        [conceptoId, e.tenantId, e.companyId, e.cuentas.gasto, e.cuentas.ivaDescontable, e.cuentas.proveedores, tc[0].id],
      );
      await tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,'servicio con ica de prueba v-8',$4)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptoId],
      );

      await tx.query(
        `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
         VALUES ($1,$2,2026,7,'2026-07-01','2026-07-31','abierto')`,
        [e.tenantId, e.companyId],
      );

      const { rows: mun } = await tx.query<{ id: string }>(
        `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '05001'`,
      );
      if (!mun[0]) throw new Error('A1 no cargó el municipio global de Medellín (05001)');
      return mun[0].id;
    });

    await sembrarExtraccion(
      e,
      [{ descripcion: 'Servicio con ICA de prueba V-8', baseGravable: 1_000_000_00, valorIva: 0 }],
      '2026-07-15',
    );

    const job = await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));
    const primero = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    // El municipio POR DEFECTO es el del tercero (fixture, sin ReteICA parametrizado): revisión manual.
    expect(primero.estado).toBe('revision_manual');
    if (primero.estado !== 'revision_manual') return;
    expect(primero.motivos.map((m) => m.codigo)).toContain('municipio_sin_parametros_de_reteica');

    const pendientes = await db.asTenant(e.tenantId, e.companyId, (tx) => listarPendientesRevision(tx), {
      userId: e.userId,
    });
    expect(pendientes.some((d) => d.sourceDocumentId === e.sourceDocumentId)).toBe(true);

    // El contador corrige: la operación se prestó en Medellín, no en el domicilio del proveedor.
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        guardarCorreccionMunicipio(tx, {
          sourceDocumentId: e.sourceDocumentId,
          municipioOperacionId: medellinId,
          motivo: 'El servicio se prestó en Medellín; el tercero solo tiene domicilio en otro municipio (V-8).',
        }),
      { userId: e.userId, rolCodigo: 'contador' },
    );
    await db.asTenant(e.tenantId, e.companyId, (tx) => reprocesarDocumento(tx, e.sourceDocumentId), {
      userId: e.userId,
      rolCodigo: 'contador',
    });

    const segundo = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: e.sourceDocumentId }),
    );
    expect(segundo.estado).toBe('causado');
    if (segundo.estado !== 'causado') return;

    const estado = await db.asTenant(e.tenantId, e.companyId, (tx) => consultarEstadoDocumento(tx, e.sourceDocumentId), {
      userId: e.userId,
    });
    const ica = estado?.retenciones.find((r) => r.tipo === 'reteica');
    expect(ica).toBeDefined();
    expect(ica?.municipioNombre).not.toBe('Municipio de prueba'); // no es el municipio del tercero
    expect(ica?.tarifa).toBe('0.002000'); // 2‰ de Medellín (Acuerdo 066 de 2017)
    expect(ica?.valor).toBe('200000'); // $1.000.000 * 0.2%
    expect(ica?.normaRespaldo).toContain('Acuerdo 066 de 2017');
    expect(ica?.vigenteDesde).toBeTruthy();
  });
});

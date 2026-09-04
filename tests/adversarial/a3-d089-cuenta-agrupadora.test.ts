/**
 * A3 · D-089 — LA CUENTA DESTINO DE UNA RETENCIÓN TIENE QUE SER UNA HOJA.
 *
 * Con el PUC completo del Decreto 2650 (D-089/A1), `2365` «RETENCIÓN EN LA
 * FUENTE» es una cuenta de AGRUPACIÓN: cuelgan de ella `236515` honorarios,
 * `236525` servicios, `236530` arrendamientos, `236535` rendimientos
 * financieros, `236540` compras… Las dieciocho reglas de retefuente de A1
 * apuntaban su `account_id` a la agrupadora. Esta suite prueba las dos mitades
 * del arreglo:
 *
 *  (a) EL MOTOR NO SE ROMPE, EXPLICA. Una regla cuya cuenta destino no admite
 *      partidas —agrupadora o inactiva— manda el documento a revisión manual
 *      con un motivo legible, ANTES de que se escriba nada. Sin esto, el
 *      documento moría en el `INSERT` de la partida con el LG004 crudo del
 *      trigger de la migración 179: un error de base de datos en la cara del
 *      contador, que no nombra ni la regla ni el remedio.
 *
 *  (b) EL DINERO NO SE MOVIÓ NI UN CENTAVO. Reapuntar las reglas a su
 *      subcuenta cambia el `account_id` de la partida de crédito y NADA MÁS:
 *      ni el valor, ni la base, ni la tarifa, ni la norma de respaldo. Se
 *      prueba en diferencial, resolviendo cada una de las reglas globales de
 *      retefuente DOS VECES en la misma base: contra el PUC de hoy (subcuenta
 *      236x) y contra un espejo que reproduce el destino anterior a D-089.
 *
 * NINGÚN VALOR TRIBUTARIO SE ESCRIBE AQUÍ (Regla de Oro 2). Las reglas espejo
 * COPIAN columna por columna la fila de A1 —tarifa, base mínima, comparador,
 * vigencia, norma— y solo le cambian la cuenta. Los montos que aparecen son
 * los del ESCENARIO (cuánto vale la factura), no parámetros de la norma; y
 * ninguna aserción afirma un número de retención: afirma que los dos caminos
 * dan EL MISMO número, sea cual sea.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MOTIVO,
  RepositorioTributarioSql,
  resolverRetenciones,
  type ResultadoResolucion,
} from '../../src/domain/index';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario } from '../helpers/fixtures';
import { procesarJobCausacion } from '../../src/services/causacion';
import { encolarCausacion } from '../../src/services/cola';
import { crearTercero, montarEscenario, pesos, type EscenarioDorado } from '../golden/_escenario';

/** Con el Decreto 572 ya vigente según los datos de A1, igual que la suite dorada. */
const FECHA = '2026-07-15';

/**
 * Base del escenario, deliberadamente MUY por encima de cualquier base mínima
 * de la sección 7.2, para que ninguna regla se quede sin practicar por umbral
 * y las dieciocho entren de verdad al comparativo. Es el tamaño de la factura
 * inventada, no un parámetro normativo.
 */
const BASE = pesos(50_000_000);
const AIU = pesos(10_000_000);

let e: EscenarioDorado;

beforeAll(async () => {
  e = await montarEscenario();
}, 180_000);

afterAll(async () => {
  await e.db.close();
});

interface ReglaGlobal {
  id: string;
  tax_concept_id: string;
  concepto: string;
  aplica_a: 'declarante' | 'no_declarante' | 'ambos';
  tipo_persona: 'natural' | 'juridica' | 'ambos';
  cuenta: string;
}

async function reglasGlobalesDeRetefuente(): Promise<ReglaGlobal[]> {
  const { rows } = await e.db.asAdmin((tx) =>
    tx.query<ReglaGlobal>(
      `SELECT r.id, r.tax_concept_id, tc.codigo AS concepto, r.aplica_a, r.tipo_persona,
              a.codigo AS cuenta
         FROM tax_rule r
         JOIN tax_concept tc ON tc.id = r.tax_concept_id
         JOIN account a      ON a.id  = r.account_id
        WHERE r.tenant_id IS NULL AND r.company_id IS NULL AND r.tipo = 'retefuente'
        ORDER BY tc.codigo, r.aplica_a, r.tipo_persona`,
    ),
  );
  return rows;
}

/** Concepto de causación de la firma que dispara SOLO la retefuente indicada. */
async function conceptoParaRetefuente(taxConceptId: string, etiqueta: string): Promise<string> {
  const id = uuid();
  await e.db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO concepto_causacion (
         id, tenant_id, company_id, codigo, nombre, naturaleza,
         tax_concept_retefuente_id, aplica_retefuente, aplica_reteiva, aplica_reteica,
         aplica_autorretencion, base_es_aiu)
       VALUES ($1,$2,$3,$4,$5,'compra',$6,true,false,false,false,false)`,
      [id, e.tenantId, e.companyId, `D089-${etiqueta}-${id.slice(0, 8)}`, `Concepto D-089 ${etiqueta}`, taxConceptId],
    ),
  );
  return id;
}

async function resolver(terceroId: string, conceptoId: string): Promise<ResultadoResolucion> {
  return e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
    resolverRetenciones(new RepositorioTributarioSql(tx), {
      companyId: e.companyId,
      terceroId,
      conceptoId,
      municipioOperacionId: null,
      baseGravable: BASE,
      valorIva: 0,
      valorAiu: AIU,
      fechaHechoEconomico: FECHA,
    }),
  );
}

// =============================================================================
// (a) UNA REGLA QUE APUNTA A UNA AGRUPADORA SE RECHAZA CON UN MOTIVO LEGIBLE
// =============================================================================
describe('A3 · D-089 (a) — regla de retención con cuenta destino no imputable', () => {
  it('el seed dejó `2365` como cuenta de AGRUPACIÓN y ninguna regla la referencia', async () => {
    const { rows } = await e.db.asAdmin((tx) =>
      tx.query<{ permite_movimiento: boolean; hijas: string; reglas: string }>(
        `SELECT a.permite_movimiento,
                (SELECT count(*) FROM account h WHERE h.parent_id = a.id)::text  AS hijas,
                (SELECT count(*) FROM tax_rule r WHERE r.account_id = a.id)::text AS reglas
           FROM account a
          WHERE a.tenant_id IS NULL AND a.company_id IS NULL AND a.codigo = '2365'`,
      ),
    );
    expect(rows[0]?.permite_movimiento).toBe(false);
    expect(Number(rows[0]?.hijas)).toBeGreaterThan(0);
    expect(rows[0]?.reglas).toBe('0');
  });

  it('las 18 reglas globales de retefuente acreditan una SUBCUENTA 236x, nunca la agrupadora', async () => {
    const reglas = await reglasGlobalesDeRetefuente();
    expect(reglas.length).toBe(18);
    for (const r of reglas) {
      expect(r.cuenta, `regla de ${r.concepto}`).toMatch(/^2365\d\d$/);
    }
    // Y el mapeo es el documentado en los seeds, concepto por concepto.
    const porConcepto = new Map(reglas.map((r) => [r.concepto, r.cuenta]));
    expect(porConcepto.get('servicios_generales')).toBe('236525');
    expect(porConcepto.get('compras_generales')).toBe('236540');
    expect(porConcepto.get('honorarios_pj')).toBe('236515');
    expect(porConcepto.get('honorarios_pn')).toBe('236515');
    expect(porConcepto.get('arrendamiento_muebles')).toBe('236530');
    expect(porConcepto.get('arrendamiento_inmuebles')).toBe('236530');
    expect(porConcepto.get('transporte_carga')).toBe('236525');
    expect(porConcepto.get('transporte_pasajeros')).toBe('236525');
    expect(porConcepto.get('servicios_temporales')).toBe('236525');
    expect(porConcepto.get('vigilancia_aseo')).toBe('236525');
    expect(porConcepto.get('productos_agricolas')).toBe('236540');
    expect(porConcepto.get('combustibles')).toBe('236540');
    expect(porConcepto.get('rendimientos_financieros_generales')).toBe('236535');
    expect(porConcepto.get('rendimientos_titulos_renta_fija')).toBe('236535');
    expect(porConcepto.get('servicios_integrales_salud')).toBe('236525');
    expect(porConcepto.get('hoteles_restaurantes')).toBe('236525');
  });

  it('una regla de la firma que apunta a la agrupadora `2365` NO liquida: motivo legible, cero retenciones', async () => {
    const [id2365, taxConceptId] = await e.db.asAdmin(async (tx) => {
      const { rows: cta } = await tx.query<{ id: string }>(
        `SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2365'`,
      );
      const { rows: tc } = await tx.query<{ id: string }>(
        `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
         VALUES ($1, NULL, 'retefuente', 'd089_agrupadora', 'Concepto de prueba D-089 (agrupadora)')
         RETURNING id`,
        [e.tenantId],
      );
      return [cta[0]!.id, tc[0]!.id] as const;
    });

    // La tarifa se COPIA de una regla real de A1: aquí no se escribe ninguna.
    await e.db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               comparador_base_minima, aplica_sobre, aplica_a, tipo_persona,
                               account_id, vigente_desde, vigente_hasta, norma_respaldo)
         SELECT $1, NULL, $2, 'retefuente', r.tarifa, r.base_minima_uvt, r.comparador_base_minima,
                r.aplica_sobre, 'ambos', 'ambos', $3, r.vigente_desde, r.vigente_hasta,
                r.norma_respaldo || ' [ESCENARIO DE PRUEBA A3/D-089: cuenta destino agrupadora]'
           FROM tax_rule r
           JOIN tax_concept tc ON tc.id = r.tax_concept_id
          WHERE r.tenant_id IS NULL AND r.company_id IS NULL AND r.tipo = 'retefuente'
            AND tc.codigo = 'servicios_generales' AND r.aplica_a = 'declarante'`,
        [e.tenantId, taxConceptId, id2365],
      ),
    );

    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const concepto = await conceptoParaRetefuente(taxConceptId, 'agrupadora');
    const r = await resolver(tercero, concepto);

    // No se liquidó nada…
    expect(r.retenciones).toHaveLength(0);
    expect(r.agregados).toHaveLength(0);
    // …y el motivo dice qué pasó, con la cuenta y el remedio.
    expect(r.requiereRevisionManual).toBe(true);
    const m = r.motivosRevision.find((x) => x.codigo === MOTIVO.REGLA_CUENTA_NO_IMPUTABLE);
    expect(m, JSON.stringify(r.motivosRevision)).toBeDefined();
    expect(m!.detalle).toContain('2365');
    expect(m!.detalle).toContain('no admite partidas');
    expect(m!.detalle).toMatch(/subcuenta/i);
  });

  it('lo mismo si la cuenta es hoja pero está INACTIVA: se distingue del caso «sin cuenta»', async () => {
    const [cuentaInactiva, taxConceptId] = await e.db.asAdmin(async (tx) => {
      const { rows: cta } = await tx.query<{ id: string }>(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza,
                              permite_movimiento, activo)
         VALUES ($1, NULL, '236599', 'Retención retirada del plan (prueba D-089)', 4, 'credito', true, false)
         RETURNING id`,
        [e.tenantId],
      );
      const { rows: tc } = await tx.query<{ id: string }>(
        `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
         VALUES ($1, NULL, 'retefuente', 'd089_inactiva', 'Concepto de prueba D-089 (cuenta inactiva)')
         RETURNING id`,
        [e.tenantId],
      );
      return [cta[0]!.id, tc[0]!.id] as const;
    });

    await e.db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               comparador_base_minima, aplica_sobre, aplica_a, tipo_persona,
                               account_id, vigente_desde, vigente_hasta, norma_respaldo)
         SELECT $1, NULL, $2, 'retefuente', r.tarifa, r.base_minima_uvt, r.comparador_base_minima,
                r.aplica_sobre, 'ambos', 'ambos', $3, r.vigente_desde, r.vigente_hasta,
                r.norma_respaldo || ' [ESCENARIO DE PRUEBA A3/D-089: cuenta destino inactiva]'
           FROM tax_rule r
           JOIN tax_concept tc ON tc.id = r.tax_concept_id
          WHERE r.tenant_id IS NULL AND r.company_id IS NULL AND r.tipo = 'retefuente'
            AND tc.codigo = 'servicios_generales' AND r.aplica_a = 'declarante'`,
        [e.tenantId, taxConceptId, cuentaInactiva],
      ),
    );

    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const concepto = await conceptoParaRetefuente(taxConceptId, 'inactiva');
    const r = await resolver(tercero, concepto);

    expect(r.retenciones).toHaveLength(0);
    const codigos = r.motivosRevision.map((x) => x.codigo);
    expect(codigos).toContain(MOTIVO.REGLA_CUENTA_NO_IMPUTABLE);
    // No se confunde con «la regla no tiene cuenta»: es otro hecho y otro remedio.
    expect(codigos).not.toContain(MOTIVO.REGLA_SIN_CUENTA);
  });
});

// =============================================================================
// (b) EL ASIENTO ES EL MISMO CENTAVO A CENTAVO: SOLO CAMBIA LA CUENTA
// =============================================================================
describe('A3 · D-089 (b) — reapuntar a la subcuenta no mueve ni un centavo', () => {
  it('las 18 reglas de retefuente dan el MISMO valor, base, tarifa y norma que contra la cuenta anterior', async () => {
    const reglas = await reglasGlobalesDeRetefuente();
    expect(reglas.length).toBe(18);

    // 1. Resolución con el PUC de HOY: cada regla acredita su subcuenta 236x.
    interface Medida {
      valor: number;
      base: number;
      tarifa: string;
      norma: string;
      accountId: string;
      aplicada: boolean;
    }
    const antes = new Map<string, Medida>();
    const contexto = new Map<string, { tercero: string; concepto: string }>();

    for (const regla of reglas) {
      const tercero = await crearTercero(e, {
        tipoPersona: regla.tipo_persona === 'ambos' ? 'juridica' : regla.tipo_persona,
        declarante: regla.aplica_a !== 'no_declarante',
      });
      const concepto = await conceptoParaRetefuente(regla.tax_concept_id, 'dif');
      contexto.set(regla.id, { tercero, concepto });

      const r = await resolver(tercero, concepto);
      const x = r.retenciones.find((y) => y.tipo === 'retefuente');
      expect(x, `sin evaluación de retefuente para ${regla.concepto} (${JSON.stringify(r.motivosRevision)})`).toBeDefined();
      antes.set(regla.id, {
        valor: x!.valor,
        base: x!.base,
        tarifa: x!.tarifa,
        norma: x!.normaRespaldo,
        accountId: x!.accountId,
        aplicada: x!.aplicada,
      });
      expect(x!.aplicada, `la regla de ${regla.concepto} no llegó a practicarse`).toBe(true);
      expect(x!.valor).toBeGreaterThan(0);
    }

    // 2. El destino ANTERIOR a D-089: una sola cuenta `2365` imputable. Se crea
    //    en el alcance de la firma para no tocar el catálogo global ni pelear
    //    con el guardia PU003 de la migración 179.
    const cuentaLegado = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1, NULL, '2365', 'RETENCIÓN EN LA FUENTE (destino anterior a D-089)', 3, 'credito', true)
         RETURNING id`,
        [e.tenantId],
      );
      return rows[0]!.id;
    });

    // 3. Espejo de cada regla en el alcance de la EMPRESA —que gana por
    //    precedencia— copiando TODAS las columnas salvo la cuenta. Ni un valor
    //    tributario se escribe: se copian de la fila de A1.
    for (const regla of reglas) {
      await e.db.asAdmin((tx) =>
        tx.query(
          `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa,
                                 base_minima_uvt, base_minima_valor, comparador_base_minima,
                                 aplica_sobre, aplica_a, tipo_persona, municipality_id,
                                 ciiu_activity_id, rango_desde_uvt, rango_hasta_uvt,
                                 uvt_adicionales, gravada, account_id, vigente_desde,
                                 vigente_hasta, norma_respaldo, notas)
           SELECT $1, $2, r.tax_concept_id, r.tipo, r.tarifa,
                  r.base_minima_uvt, r.base_minima_valor, r.comparador_base_minima,
                  r.aplica_sobre, r.aplica_a, r.tipo_persona, r.municipality_id,
                  r.ciiu_activity_id, r.rango_desde_uvt, r.rango_hasta_uvt,
                  r.uvt_adicionales, r.gravada, $3, r.vigente_desde,
                  r.vigente_hasta, r.norma_respaldo, r.notas
             FROM tax_rule r WHERE r.id = $4`,
          [e.tenantId, e.companyId, cuentaLegado, regla.id],
        ),
      );
    }

    // 4. Misma factura, mismo tercero, mismo concepto, misma fecha. Solo cambió
    //    a qué cuenta apunta la regla que gana.
    for (const regla of reglas) {
      const { tercero, concepto } = contexto.get(regla.id)!;
      const r = await resolver(tercero, concepto);
      const x = r.retenciones.find((y) => y.tipo === 'retefuente');
      expect(x, `sin evaluación con la regla espejo de ${regla.concepto}`).toBeDefined();
      const a = antes.get(regla.id)!;

      // Lo único que cambia:
      expect(x!.accountId, `${regla.concepto}: la regla espejo debe apuntar a la cuenta anterior`).toBe(cuentaLegado);
      expect(a.accountId).not.toBe(cuentaLegado);

      // Todo lo demás, idéntico. Centavo a centavo.
      expect(x!.valor, `${regla.concepto}: el VALOR de la retención cambió`).toBe(a.valor);
      expect(x!.base, `${regla.concepto}: la BASE cambió`).toBe(a.base);
      expect(x!.tarifa, `${regla.concepto}: la TARIFA cambió`).toBe(a.tarifa);
      expect(x!.normaRespaldo, `${regla.concepto}: la NORMA cambió`).toBe(a.norma);
      expect(x!.aplicada).toBe(a.aplicada);
    }
  }, 300_000);
});

// =============================================================================
// (c) LA RED DEL SERVICIO: NI SIQUIERA POR LAS CUENTAS DEL CONCEPTO
// =============================================================================
//
// El motor solo ve las cuentas de las REGLAS. Las del `concepto_causacion`
// (gasto, IVA descontable, contrapartida) las pone A6 al armar el asiento, y
// hasta D-089 nadie comprobaba que fueran imputables: el documento moría en el
// `INSERT` con el LG004 del trigger 179, abortando el trabajo del worker.
describe('A3 · D-089 (c) — el servicio manda a revisión manual, no revienta', () => {
  let db2: TestDb;

  beforeAll(async () => {
    db2 = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db2?.close();
  });

  it('un concepto cuya cuenta de gasto es una AGRUPADORA acaba en revisión manual con motivo legible', async () => {
    const esc = await crearEscenario(db2);

    // `e.cuentas.claseGasto` es la clase 5 del PUC del escenario:
    // `permite_movimiento = false`. Es la cuenta agrupadora más obvia que hay.
    const conceptoId = uuid();
    await db2.asAdmin((tx) =>
      tx.query(
        `INSERT INTO concepto_causacion (
           id, tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
         VALUES ($1,$2,$3,$4,'Concepto con cuenta de gasto agrupadora','compra',$5,$6,$7,
                 false,false,false,false)`,
        [
          conceptoId,
          esc.tenantId,
          esc.companyId,
          `D089-AGR-${conceptoId.slice(0, 8)}`,
          esc.cuentas.claseGasto,
          esc.cuentas.ivaDescontable,
          esc.cuentas.proveedores,
        ],
      ),
    );

    const descripcion = 'Servicio con cuenta de gasto mal configurada';
    await db2.asAdmin((tx) =>
      tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [esc.tenantId, esc.companyId, esc.thirdPartyId, descripcion.toLowerCase().trim(), conceptoId],
      ),
    );
    await db2.asAdmin(async (tx) => {
      await tx.query(`UPDATE source_document SET estado = 'parseado' WHERE id = $1`, [esc.sourceDocumentId]);
      await tx.query(
        `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
         VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
        [
          esc.tenantId,
          esc.companyId,
          esc.sourceDocumentId,
          JSON.stringify({
            tipoDocumento: 'Invoice',
            emisor: { nit: '900123456', nombre: 'Proveedor de prueba' },
            adquirente: { nit: null, nombre: null },
            lineas: [{ numero: 1, descripcion, subtotal: '10000000', impuestos: [{ codigo: '01', valor: '1900000' }] }],
          }),
        ],
      );
    });
    const job = await db2.asTenant(esc.tenantId, esc.companyId, (tx) =>
      encolarCausacion(tx, esc.sourceDocumentId),
    );

    // No lanza: devuelve revisión manual.
    const resultado = await db2.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: job.id, sourceDocumentId: esc.sourceDocumentId }),
    );
    expect(resultado.estado).toBe('revision_manual');
    if (resultado.estado !== 'revision_manual') return;
    const motivo = resultado.motivos.find((m) => m.codigo === 'cuenta_no_imputable');
    expect(motivo, JSON.stringify(resultado.motivos)).toBeDefined();
    expect(motivo!.detalle).toContain('agrupación');

    // Y no quedó ni un asiento, ni una partida, ni una fila de traza huérfana.
    const { rows } = await db2.asAdmin((tx) =>
      tx.query<{ asientos: string; retenciones: string }>(
        `SELECT (SELECT count(*) FROM journal_entry WHERE source_document_id = $1)::text     AS asientos,
                (SELECT count(*) FROM retention_applied WHERE source_document_id = $1)::text AS retenciones`,
        [esc.sourceDocumentId],
      ),
    );
    expect(rows[0]).toMatchObject({ asientos: '0', retenciones: '0' });
  }, 120_000);
});


// =============================================================================
// (d) LA MIGRACIÓN 180 REPARA UNA BASE QUE YA ESTABA SEMBRADA, SIN REESCRIBIR
//     EL PASADO
// =============================================================================
//
// Los seeds arreglan la base NUEVA, pero son `INSERT ... WHERE NOT EXISTS`:
// jamás van a tocar las filas de `tax_rule` que ya existen en la Neon. Para esa
// base está la migración 180. Como las migraciones corren ANTES que los seeds,
// en una base limpia la 180 es un no-op y no se probaría sola: aquí se
// reconstruye a mano el estado anterior a D-089 y se aplica el archivo tal cual
// está en disco.
//
// PARA FABRICAR EL ESTADO ANTERIOR hay que desactivar un momento el guardia
// append-only de `tax_rule`, porque ese guardia es justamente el que impide
// hacer lo que el pasado ya tenía hecho. Se desactiva para MONTAR el escenario
// y se vuelve a activar ANTES de correr la migración: lo que se prueba es que
// la migración funciona con el guardia PUESTO.
describe('A3 · D-089 (d) — migración 180 sobre una base ya sembrada', () => {
  let db3: TestDb;

  beforeAll(async () => {
    db3 = await createTestDb();
    const { seed } = await import('../../src/db/seed');
    await db3.asAdmin((tx) => seed(tx));
  }, 240_000);

  afterAll(async () => {
    await db3?.close();
  });

  async function sqlMigracion(): Promise<string> {
    return readFile(
      fileURLToPath(new URL('../../db/migrations/180_a3_d089_retefuente_subcuentas.sql', import.meta.url)),
      'utf8',
    );
  }

  async function vigencias(): Promise<
    { concepto: string; cuenta: string; desde: string; hasta: string | null }[]
  > {
    const { rows } = await db3.asAdmin((tx) =>
      tx.query<{ concepto: string; cuenta: string; desde: string; hasta: string | null }>(
        `SELECT tc.codigo AS concepto, a.codigo AS cuenta,
                r.vigente_desde::text AS desde, r.vigente_hasta::text AS hasta
           FROM tax_rule r
           JOIN tax_concept tc ON tc.id = r.tax_concept_id
           JOIN account a      ON a.id  = r.account_id
          WHERE r.tenant_id IS NULL AND r.company_id IS NULL AND r.tipo = 'retefuente'
          ORDER BY tc.codigo, r.vigente_desde`,
      ),
    );
    return rows;
  }

  async function permite2365(): Promise<boolean> {
    const { rows } = await db3.asAdmin((tx) =>
      tx.query<{ p: boolean }>(
        `SELECT permite_movimiento AS p FROM account
          WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2365'`,
      ),
    );
    return rows[0]!.p;
  }

  it('cierra la vigencia vieja y abre la gemela contra la subcuenta, sin tocar tarifa ni base', async () => {
    // 1. Estado anterior a D-089: `2365` imputable y las dieciocho vigencias
    //    globales de retefuente apuntándole. Se fabrica con el guardia quitado.
    await db3.asAdmin(async (tx) => {
      await tx.exec('ALTER TABLE tax_rule DISABLE TRIGGER tax_rule_vigencia_append_only');
      await tx.query(
        `UPDATE account SET permite_movimiento = true
          WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2365'`,
      );
      await tx.query(
        `UPDATE tax_rule SET account_id = (SELECT id FROM account
                                            WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2365')
          WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente'`,
      );
      await tx.exec('ALTER TABLE tax_rule ENABLE TRIGGER tax_rule_vigencia_append_only');
    });

    const antes = await vigencias();
    expect(antes).toHaveLength(18);
    expect(antes.every((f) => f.cuenta === '2365')).toBe(true);
    expect(antes.every((f) => f.hasta === null)).toBe(true);

    // Foto de los valores tributarios, para exigir después que no se movieron.
    const fotoValores = async (): Promise<string[]> => {
      const { rows } = await db3.asAdmin((tx) =>
        tx.query<{ f: string }>(
          `SELECT concat_ws('|', tc.codigo, r.tarifa::text, coalesce(r.base_minima_uvt::text,'-'),
                            r.comparador_base_minima, r.aplica_sobre, r.aplica_a, r.tipo_persona,
                            r.norma_respaldo) AS f
             FROM tax_rule r JOIN tax_concept tc ON tc.id = r.tax_concept_id
            WHERE r.tenant_id IS NULL AND r.company_id IS NULL AND r.tipo = 'retefuente'
              AND r.vigente_hasta IS NULL
            ORDER BY f`,
        ),
      );
      return rows.map((x) => x.f);
    };
    const valoresAntes = await fotoValores();

    // 2. Se aplica la migración tal cual, con el guardia append-only PUESTO.
    const sql = await sqlMigracion();
    await db3.asAdmin((tx) => tx.exec(sql));

    const despues = await vigencias();
    // Dieciocho cerradas contra 2365 + dieciocho abiertas contra la subcuenta.
    expect(despues).toHaveLength(36);
    const cerradas = despues.filter((f) => f.hasta !== null);
    const abiertas = despues.filter((f) => f.hasta === null);
    expect(cerradas).toHaveLength(18);
    expect(abiertas).toHaveLength(18);
    expect(cerradas.every((f) => f.cuenta === '2365')).toBe(true);
    for (const f of abiertas) expect(f.cuenta, f.concepto).toMatch(/^2365\d\d$/);

    const mapa = new Map(abiertas.map((f) => [f.concepto, f.cuenta]));
    expect(mapa.get('honorarios_pj')).toBe('236515');
    expect(mapa.get('compras_generales')).toBe('236540');
    expect(mapa.get('rendimientos_financieros_generales')).toBe('236535');
    expect(mapa.get('servicios_temporales')).toBe('236525');
    expect(mapa.get('arrendamiento_inmuebles')).toBe('236530');

    // 3. NI UN VALOR TRIBUTARIO CAMBIÓ: la vigencia nueva repite tarifa, base
    //    mínima, comparador, discriminadores y norma de la que cierra.
    expect(await fotoValores()).toEqual(valoresAntes);

    // 4. La vigencia vieja quedó cerrada el día ANTERIOR al de la nueva: sin
    //    solape y sin hueco. El motor resuelve por fecha del hecho económico y
    //    cualquier día cae en exactamente una.
    const { rows: corte } = await db3.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM tax_rule cerrada
           JOIN tax_rule abierta
             ON abierta.clave_vigencia = cerrada.clave_vigencia
            AND abierta.vigente_hasta IS NULL
          WHERE cerrada.tenant_id IS NULL AND cerrada.company_id IS NULL
            AND cerrada.tipo = 'retefuente' AND cerrada.vigente_hasta IS NOT NULL
            AND abierta.vigente_desde = cerrada.vigente_hasta + 1`,
      ),
    );
    expect(corte[0]!.n).toBe('18');

    // 5. `2365` sigue imputable A PROPÓSITO: una vigencia cerrada la cita, y el
    //    reproceso de una factura de aquella época tiene que poder volver a
    //    imputar ahí. Desimputarla sería reinterpretar el pasado.
    expect(await permite2365()).toBe(true);

    // 6. Idempotente: correrla otra vez no abre una tercera vigencia.
    await db3.asAdmin((tx) => tx.exec(sql));
    expect(await vigencias()).toHaveLength(36);
    expect(await permite2365()).toBe(true);
  }, 240_000);
});

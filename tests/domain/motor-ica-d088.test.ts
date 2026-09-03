/**
 * A3 — D-088: el MOTOR de la parametrización de ICA por municipio.
 *
 * Dos conductas nuevas, y ninguna de las dos cambia lo que ya funcionaba:
 *
 *  1. `tax_rule.gravada = false` — actividad declarada NO gravada en ese
 *     municipio: el motor no retiene, sin importar la tarifa. `true` y `NULL`
 *     (todas las reglas anteriores a D-088) siguen exactamente igual.
 *
 *  2. `municipality_ica_rule.tipo_medicion_base_minima = 'por_periodo'` — la
 *     base mínima no se compara contra la factura sino contra el ACUMULADO del
 *     tercero en el municipio durante la ventana del periodo.
 *
 * AQUÍ NO SE ESCRIBE NI UN VALOR TRIBUTARIO (Regla de Oro 2). La base mínima de
 * Medellín, su tarifa general y la UVT del año son las que cargó A1 en
 * `db/seeds/`; esta suite las LEE y calcula los montos del escenario como
 * fracciones del umbral, para que la prueba siga siendo válida el día que A1
 * actualice el dato. Lo único que la suite escribe son parámetros de ESCENARIO,
 * marcados como tales en su `norma_respaldo`: que Medellín mida por periodo y
 * que la ventana sea de dos meses, y una actividad no gravada de ejemplo con la
 * tarifa en cero que el propio CHECK `tax_rule_gravada_ck` obliga.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RepositorioTributarioSql,
  aplicarAcumuladosIca,
  resolverFactura,
  ventanaPeriodoIca,
  type ResultadoResolucion,
  type RetencionResuelta,
} from '../../src/domain/index';
import { uuid } from '../helpers/db';
import {
  crearDocumento,
  crearTercero,
  montarEscenario,
  pesos,
  registrarActividad,
  type EscenarioDorado,
} from '../golden/_escenario';

/** Ventana de dos meses: con el anclaje al año calendario, jul-ago de 2026. */
const PERIODO_MESES = 2;

let e: EscenarioDorado;
/** Base mínima de servicios de Medellín en centavos, LEÍDA de los datos de A1. */
let umbralMedellin: number;
/** Identidad de ReteICA del escenario, para colgar de ella las reglas nuevas. */
let taxConceptReteica: string;

beforeAll(async () => {
  e = await montarEscenario();

  await e.db.asAdmin(async (tx) => {
    // Medellín, medido POR PERIODO. La fila es de alcance de EMPRESA y copia
    // con un SELECT las bases mínimas y la tarifa de la fila global de A1: no
    // se escribe ningún número normativo, solo el CÓMO se mide.
    await tx.query(
      `INSERT INTO municipality_ica_rule (
         tenant_id, company_id, municipality_id, practica_reteica,
         base_minima_servicios_uvt, base_minima_compras_uvt,
         base_minima_servicios_valor, base_minima_compras_valor,
         usa_tarifa_de_actividad, tarifa_general, periodicidad, regla_desempate_actividad,
         tipo_medicion_base_minima, periodo_meses,
         vigente_desde, norma_respaldo, requiere_verificacion_humana, notas)
       SELECT $1, $2, r.municipality_id, r.practica_reteica,
              r.base_minima_servicios_uvt, r.base_minima_compras_uvt,
              r.base_minima_servicios_valor, r.base_minima_compras_valor,
              r.usa_tarifa_de_actividad, r.tarifa_general, r.periodicidad,
              r.regla_desempate_actividad,
              'por_periodo', $4, r.vigente_desde,
              r.norma_respaldo,
              true,
              'PARÁMETRO DE ESCENARIO de la suite de D-088: misma base mínima y misma tarifa que la fila global de A1, medidas por periodo de dos meses, para ejercitar el acumulador. No es un dato normativo de Medellín.'
         FROM municipality_ica_rule r
        WHERE r.municipality_id = $3 AND r.tenant_id IS NULL AND r.company_id IS NULL`,
      [e.tenantId, e.companyId, e.municipios.medellin, PERIODO_MESES],
    );

    // El umbral, calculado por la base con los datos de A1 (UVT del año × las
    // UVT de la regla). La suite no sabe cuántos pesos son y no le hace falta.
    const { rows } = await tx.query<{ v: string }>(
      `SELECT (r.base_minima_servicios_uvt * u.valor)::bigint::text AS v
         FROM municipality_ica_rule r, uvt_value u
        WHERE r.municipality_id = $1 AND r.tenant_id IS NULL AND r.company_id IS NULL
          AND u.tenant_id IS NULL AND u.company_id IS NULL
          AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, DATE '2026-07-15')`,
      [e.municipios.medellin],
    );
    if (!rows[0]) throw new Error('A1 no dejó base mínima de servicios ni UVT para Medellín.');
    umbralMedellin = Number(rows[0].v);

    const { rows: tc } = await tx.query<{ id: string }>(
      `SELECT tax_concept_reteica_id AS id FROM concepto_causacion WHERE id = $1`,
      [e.conceptos.serviciosIca],
    );
    taxConceptReteica = tc[0]!.id!;
  });
}, 240_000);

afterAll(async () => {
  await e.db.close();
});

/** Fracción del umbral, redondeada a pesos enteros. Nunca un valor tributario. */
function fraccionDelUmbral(factor: number): number {
  return Math.round((umbralMedellin * factor) / 100) * 100;
}

/**
 * Resuelve una factura y aplica los efectos del acumulador, que es lo que hace
 * `causarFactura` cuando el asiento queda escrito.
 */
async function causar(
  terceroId: string,
  municipioId: string,
  fecha: string,
  baseGravable: number,
  sourceDocumentId: string,
): Promise<ResultadoResolucion> {
  return e.db.asTenant(e.tenantId, e.companyId, async (tx) => {
    const resultado = await resolverFactura(new RepositorioTributarioSql(tx), {
      companyId: e.companyId,
      terceroId,
      municipioOperacionId: municipioId,
      fechaHechoEconomico: fecha,
      sourceDocumentId,
      lineas: [{ conceptoId: e.conceptos.serviciosIca, baseGravable, valorIva: 0 }],
    });
    await aplicarAcumuladosIca(
      tx,
      { tenantId: e.tenantId, companyId: e.companyId },
      resultado.acumuladosIca,
    );
    return resultado;
  });
}

/** Igual, pero SIN persistir: es el dry-run. Lee el acumulado y no lo mueve. */
async function simular(
  terceroId: string,
  municipioId: string,
  fecha: string,
  baseGravable: number,
  sourceDocumentId: string | null,
): Promise<ResultadoResolucion> {
  return e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
    resolverFactura(new RepositorioTributarioSql(tx), {
      companyId: e.companyId,
      terceroId,
      municipioOperacionId: municipioId,
      fechaHechoEconomico: fecha,
      sourceDocumentId,
      lineas: [{ conceptoId: e.conceptos.serviciosIca, baseGravable, valorIva: 0 }],
    }),
  );
}

interface FilaAcumuladorPrueba {
  periodo_inicio: string;
  periodo_fin: string;
  base_acumulada_centavos: string;
  documentos_contados: unknown;
}

async function acumuladores(terceroId: string): Promise<FilaAcumuladorPrueba[]> {
  return e.db.asAdmin(async (tx) => {
    const { rows } = await tx.query<FilaAcumuladorPrueba>(
      `SELECT periodo_inicio::text, periodo_fin::text, base_acumulada_centavos::text,
              documentos_contados
         FROM reteica_periodo_acumulado
        WHERE third_party_id = $1
        ORDER BY periodo_inicio`,
      [terceroId],
    );
    return rows;
  });
}

function ica(r: ResultadoResolucion): RetencionResuelta {
  const encontradas = r.retenciones.filter((x) => x.tipo === 'reteica');
  if (encontradas.length !== 1) {
    throw new Error(
      `Se esperaba una sola evaluación de ReteICA y llegaron ${encontradas.length}. ` +
        `Motivos: ${JSON.stringify(r.motivosRevision)}`,
    );
  }
  return encontradas[0]!;
}

// =============================================================================
describe('D-088 · ventana de acumulación (anclaje al año calendario)', () => {
  it('el primer periodo del año arranca el 1 de enero y los demás se encadenan', () => {
    expect(ventanaPeriodoIca('2026-01-15', 2)).toEqual({ inicio: '2026-01-01', fin: '2026-02-28' });
    expect(ventanaPeriodoIca('2026-02-28', 2)).toEqual({ inicio: '2026-01-01', fin: '2026-02-28' });
    expect(ventanaPeriodoIca('2026-03-01', 2)).toEqual({ inicio: '2026-03-01', fin: '2026-04-30' });
    expect(ventanaPeriodoIca('2026-07-15', 2)).toEqual({ inicio: '2026-07-01', fin: '2026-08-31' });
    expect(ventanaPeriodoIca('2026-09-01', 2)).toEqual({ inicio: '2026-09-01', fin: '2026-10-31' });
  });

  it('el año bisiesto lo resuelve el calendario, no una tabla escrita a mano', () => {
    expect(ventanaPeriodoIca('2028-02-10', 2)).toEqual({ inicio: '2028-01-01', fin: '2028-02-29' });
  });

  it('mensual y anual son los dos extremos de la misma regla', () => {
    expect(ventanaPeriodoIca('2026-05-20', 1)).toEqual({ inicio: '2026-05-01', fin: '2026-05-31' });
    expect(ventanaPeriodoIca('2026-05-20', 12)).toEqual({ inicio: '2026-01-01', fin: '2026-12-31' });
  });

  it('si la ventana no divide a 12, el último periodo se recorta al 31 de diciembre', () => {
    // periodo_meses = 5: ene-may, jun-oct, nov-dic (recortado). Nunca invade
    // enero del año siguiente: la ventana no cruza el cambio de año.
    expect(ventanaPeriodoIca('2026-01-02', 5)).toEqual({ inicio: '2026-01-01', fin: '2026-05-31' });
    expect(ventanaPeriodoIca('2026-07-02', 5)).toEqual({ inicio: '2026-06-01', fin: '2026-10-31' });
    expect(ventanaPeriodoIca('2026-12-31', 5)).toEqual({ inicio: '2026-11-01', fin: '2026-12-31' });
  });

  it('una ventana imposible no se inventa: devuelve null', () => {
    expect(ventanaPeriodoIca('2026-07-15', 0)).toBeNull();
    expect(ventanaPeriodoIca('2026-07-15', 13)).toBeNull();
    expect(ventanaPeriodoIca('2026-07-15', 2.5)).toBeNull();
  });
});

// =============================================================================
describe('D-088 · TAREA 1: actividad no gravada', () => {
  it('gravada = false no retiene, aunque la regla exista y la base supere el mínimo', async () => {
    const ciiuNoGravada = uuid();
    const tercero = await crearTercero(e, { municipioId: e.municipios.cali });
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
         VALUES ($1, $2, '0113', 'Actividad NO gravada de ICA (escenario D-088)')`,
        [ciiuNoGravada, e.tenantId],
      );
      // Tarifa CERO: no es un valor tributario elegido por la suite, es lo que
      // el CHECK `tax_rule_gravada_ck` obliga a que valga una actividad no
      // gravada, justamente para que leer el flag y leer la tarifa no puedan
      // dar resultados opuestos.
      await tx.query(
        `INSERT INTO tax_rule (
           tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a,
           tipo_persona, municipality_id, ciiu_activity_id, account_id, gravada,
           vigente_desde, norma_respaldo, requiere_verificacion_humana, notas)
         VALUES ($1, NULL, $2, 'reteica', 0, 'base_gravable', 'ambos', 'ambos', $3, $4, $5, false,
                 DATE '2026-01-01',
                 'PARÁMETRO DE ESCENARIO de la suite de D-088: actividad declarada no gravada.',
                 true, 'No es un dato normativo de Cali.')`,
        [e.tenantId, taxConceptReteica, e.municipios.cali, ciiuNoGravada, e.cuentas.reteica],
      );
    });
    await registrarActividad(e, tercero, e.municipios.cali, ciiuNoGravada, true);

    const r = await simular(tercero, e.municipios.cali, '2026-07-15', pesos(50_000_000), null);

    // No es revisión manual: no hay nada que decidir, es una decisión ya tomada
    // por el municipio y cargada como parámetro.
    expect(r.requiereRevisionManual).toBe(false);
    const evaluacion = ica(r);
    expect(evaluacion.aplicada).toBe(false);
    expect(evaluacion.valor).toBe(0);
    expect(evaluacion.motivoNoAplica).toContain('NO GRAVADA');
    expect(evaluacion.motivoNoAplica).toContain(e.municipios.cali);
    expect(evaluacion.ciiuActivityId).toBe(ciiuNoGravada);
    // La traza queda: qué regla se evaluó y con qué vigencia (Regla de Oro 6).
    expect(evaluacion.regla.vigenteDesde).toBe('2026-01-01');
  });

  it('gravada = true retiene igual que antes de D-088', async () => {
    const ciiuGravada = uuid();
    const tercero = await crearTercero(e, { municipioId: e.municipios.cali });
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
         VALUES ($1, $2, '0114', 'Actividad gravada de ICA (escenario D-088)')`,
        [ciiuGravada, e.tenantId],
      );
      // La tarifa NO se escribe: se copia de la tarifa general de Medellín que
      // cargó A1, igual que hace el montaje de los casos dorados.
      await tx.query(
        `INSERT INTO tax_rule (
           tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a,
           tipo_persona, municipality_id, ciiu_activity_id, account_id, gravada,
           vigente_desde, norma_respaldo, requiere_verificacion_humana, notas)
         SELECT $1, NULL, $2, 'reteica', mir.tarifa_general, 'base_gravable', 'ambos', 'ambos',
                $3, $4, $5, true, DATE '2026-01-01',
                'Tarifa copiada de municipality_ica_rule (' || mir.norma_respaldo || ')',
                true, 'PARÁMETRO DE ESCENARIO de la suite de D-088.'
           FROM municipality_ica_rule mir
           JOIN municipality m ON m.id = mir.municipality_id
          WHERE m.codigo_dane = '05001' AND mir.tarifa_general IS NOT NULL
            AND mir.tenant_id IS NULL AND mir.company_id IS NULL`,
        [e.tenantId, taxConceptReteica, e.municipios.cali, ciiuGravada, e.cuentas.reteica],
      );
    });
    await registrarActividad(e, tercero, e.municipios.cali, ciiuGravada, true);

    const r = await simular(tercero, e.municipios.cali, '2026-07-15', pesos(1_000_000), null);
    const evaluacion = ica(r);
    expect(evaluacion.aplicada).toBe(true);
    expect(evaluacion.valor).toBeGreaterThan(0);
    expect(evaluacion.motivoNoAplica).toBeNull();
  });

  it('gravada = NULL (toda regla anterior a D-088) no cambia de conducta', async () => {
    // `reglaIcaMedellin` la creó el montaje de los casos dorados sin tocar
    // `gravada`: es exactamente el estado de las filas ya cargadas en producción.
    const gravada = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ gravada: boolean | null }>(
        `SELECT gravada FROM tax_rule WHERE id = $1`,
        [e.reglaIcaMedellin],
      );
      return rows[0]!.gravada;
    });
    expect(gravada).toBeNull();

    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const r = await simular(tercero, e.municipios.medellin, '2026-07-15', pesos(50_000_000), null);
    const evaluacion = ica(r);
    expect(evaluacion.regla.taxRuleId).toBe(e.reglaIcaMedellin);
    expect(evaluacion.aplicada).toBe(true);
    expect(evaluacion.valor).toBeGreaterThan(0);
  });
});

// =============================================================================
describe('D-088 · TAREA 2: base mínima medida por periodo', () => {
  it('tres facturas: la que cruza el acumulado retiene, la anterior no, y no hay ajuste hacia atrás', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const cuota = fraccionDelUmbral(0.6);

    const doc1 = await crearDocumento(e, tercero, '2026-07-05');
    const r1 = await causar(tercero, e.municipios.medellin, '2026-07-05', cuota, doc1);
    const ica1 = ica(r1);
    // 0,6 del umbral: no lo alcanza. No retiene, PERO suma al acumulador.
    expect(ica1.aplicada).toBe(false);
    expect(ica1.motivoNoAplica).toContain('El acumulado del periodo');
    expect(ica1.nota).toContain('POR PERIODO');

    const doc2 = await crearDocumento(e, tercero, '2026-07-20');
    const r2 = await causar(tercero, e.municipios.medellin, '2026-07-20', cuota, doc2);
    const ica2 = ica(r2);
    // 1,2 del umbral acumulado: cruza. Retiene sobre la base de ESTA factura.
    expect(ica2.aplicada).toBe(true);
    expect(ica2.base).toBe(cuota);
    expect(ica2.valor).toBeGreaterThan(0);

    const doc3 = await crearDocumento(e, tercero, '2026-08-10');
    const r3 = await causar(tercero, e.municipios.medellin, '2026-08-10', cuota, doc3);
    expect(ica(r3).aplicada).toBe(true);

    // ASUNCIÓN B, explícita: lo causado antes del cruce NO se ajusta. La
    // primera factura sigue sin retención y nadie la tocó.
    expect(ica1.valor).toBe(0);

    const filas = await acumuladores(tercero);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.periodo_inicio).toBe('2026-07-01');
    expect(filas[0]!.periodo_fin).toBe('2026-08-31');
    expect(Number(filas[0]!.base_acumulada_centavos)).toBe(cuota * 3);
    expect(filas[0]!.documentos_contados).toEqual([doc1, doc2, doc3]);
  });

  it('recausar el mismo documento no lo cuenta dos veces y da el mismo resultado', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const cuota = fraccionDelUmbral(0.6);

    const doc1 = await crearDocumento(e, tercero, '2026-07-05');
    await causar(tercero, e.municipios.medellin, '2026-07-05', cuota, doc1);
    const doc2 = await crearDocumento(e, tercero, '2026-07-20');
    const primera = await causar(tercero, e.municipios.medellin, '2026-07-20', cuota, doc2);

    const antes = await acumuladores(tercero);
    expect(Number(antes[0]!.base_acumulada_centavos)).toBe(cuota * 2);

    // Reproceso del MISMO documento: el acumulado ya lo incluye.
    const segunda = await causar(tercero, e.municipios.medellin, '2026-07-20', cuota, doc2);
    const tercera = await causar(tercero, e.municipios.medellin, '2026-07-20', cuota, doc2);

    const despues = await acumuladores(tercero);
    expect(Number(despues[0]!.base_acumulada_centavos)).toBe(cuota * 2);
    expect(despues[0]!.documentos_contados).toEqual([doc1, doc2]);

    // Determinismo (caso dorado 18): la huella no se mueve al reprocesar.
    expect(segunda.huella).toBe(primera.huella);
    expect(tercera.huella).toBe(primera.huella);
    expect(ica(segunda).aplicada).toBe(true);
    expect(ica(segunda).valor).toBe(ica(primera).valor);
    expect(ica(segunda).nota).toContain('YA estaba contado');
  });

  it('cruzar el límite del periodo: el acumulador arranca de cero, no arrastra', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const cuota = fraccionDelUmbral(0.6);

    // Último día del periodo jul-ago.
    const docA = await crearDocumento(e, tercero, '2026-08-31');
    const rA = await causar(tercero, e.municipios.medellin, '2026-08-31', cuota, docA);
    expect(ica(rA).aplicada).toBe(false);

    // Primer día del periodo siguiente: si el acumulador arrastrara, 1,2 del
    // umbral cruzaría y esta factura retendría. No debe.
    const docB = await crearDocumento(e, tercero, '2026-09-01');
    const rB = await causar(tercero, e.municipios.medellin, '2026-09-01', cuota, docB);
    expect(ica(rB).aplicada).toBe(false);
    expect(ica(rB).nota).toContain('2026-09-01 a 2026-10-31');

    // Y dentro del periodo nuevo el umbral se vuelve a cruzar desde cero.
    const docC = await crearDocumento(e, tercero, '2026-10-15');
    const rC = await causar(tercero, e.municipios.medellin, '2026-10-15', cuota, docC);
    expect(ica(rC).aplicada).toBe(true);

    const filas = await acumuladores(tercero);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => [f.periodo_inicio, f.periodo_fin])).toEqual([
      ['2026-07-01', '2026-08-31'],
      ['2026-09-01', '2026-10-31'],
    ]);
    expect(Number(filas[0]!.base_acumulada_centavos)).toBe(cuota);
    expect(Number(filas[1]!.base_acumulada_centavos)).toBe(cuota * 2);
  });

  it('el acumulado de OTRO tercero no empuja el de este', async () => {
    const unTercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const otro = await crearTercero(e, { municipioId: e.municipios.medellin });
    const cuota = fraccionDelUmbral(0.9);

    const d1 = await crearDocumento(e, unTercero, '2026-07-05');
    await causar(unTercero, e.municipios.medellin, '2026-07-05', cuota, d1);
    const d2 = await crearDocumento(e, otro, '2026-07-06');
    const r = await causar(otro, e.municipios.medellin, '2026-07-06', cuota, d2);
    expect(ica(r).aplicada).toBe(false);
  });

  it('en dry-run el motor LEE el acumulador y no lo mueve', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const cuota = fraccionDelUmbral(0.6);

    const doc1 = await crearDocumento(e, tercero, '2026-07-05');
    await causar(tercero, e.municipios.medellin, '2026-07-05', cuota, doc1);

    // Previsualización de una segunda factura: cruza, y lo dice — pero no
    // escribe. El acumulador sigue con una sola factura dentro.
    const doc2 = await crearDocumento(e, tercero, '2026-07-20');
    const previa = await simular(tercero, e.municipios.medellin, '2026-07-20', cuota, doc2);
    expect(ica(previa).aplicada).toBe(true);
    expect(previa.acumuladosIca).toHaveLength(1);

    const filas = await acumuladores(tercero);
    expect(Number(filas[0]!.base_acumulada_centavos)).toBe(cuota);
    expect(filas[0]!.documentos_contados).toEqual([doc1]);
  });

  it('sin documento no hay efectos que persistir, pero el cálculo sigue siendo correcto', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const r = await simular(
      tercero,
      e.municipios.medellin,
      '2026-07-05',
      fraccionDelUmbral(1.5),
      null,
    );
    expect(ica(r).aplicada).toBe(true);
    expect(r.acumuladosIca).toEqual([]);
  });

  it('medición por periodo sin ventana declarada: revisión manual, no un umbral inventado', async () => {
    // Otra empresa de la misma firma, con una regla mal parametrizada. No se
    // puede violar el CHECK cruzado de la base, así que la ventana se retira
    // por el único camino legítimo: una regla nueva sin `periodo_meses`, que
    // es lo que produce la carga masiva cuando falta la columna del Excel.
    const companyId = uuid();
    const terceroId = uuid();
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                              es_agente_retencion_renta, es_agente_retencion_iva,
                              es_agente_retencion_ica, es_responsable_iva, buzon_email)
         VALUES ($1,$2,'NIT-D088','Empresa sin ventana de ICA',$3,$4,true,true,true,true,
                 'd088@inbox.pruebas.local')`,
        [companyId, e.tenantId, e.municipios.medellin, e.ciiuGlobal],
      );
      await tx.query(
        `INSERT INTO municipality_ica_rule (
           tenant_id, company_id, municipality_id, practica_reteica,
           base_minima_servicios_uvt, usa_tarifa_de_actividad, tarifa_general,
           tipo_medicion_base_minima, periodo_meses, vigente_desde, norma_respaldo,
           requiere_verificacion_humana, notas)
         SELECT $1, $2, r.municipality_id, r.practica_reteica, r.base_minima_servicios_uvt,
                r.usa_tarifa_de_actividad, r.tarifa_general, 'por_periodo', NULL, r.vigente_desde,
                r.norma_respaldo, true,
                'PARÁMETRO DE ESCENARIO de la suite de D-088: regla incompleta a propósito.'
           FROM municipality_ica_rule r
          WHERE r.municipality_id = $3 AND r.tenant_id IS NULL AND r.company_id IS NULL`,
        [e.tenantId, companyId, e.municipios.medellin],
      );
      await tx.query(
        `INSERT INTO third_party (id, tenant_id, company_id, tipo_documento, numero_documento,
                                  tipo_persona, razon_social, municipality_id, es_del_exterior, pais)
         VALUES ($1,$2,$3,'NIT','TP-D088-SINVENTANA','juridica','Proveedor sin ventana',$4,false,'CO')`,
        [terceroId, e.tenantId, companyId, e.municipios.medellin],
      );
      await tx.query(
        `INSERT INTO third_party_fiscal_attribute
           (tenant_id, company_id, third_party_id, es_declarante_renta, es_responsable_iva,
            es_regimen_simple, es_autorretenedor_renta, regimen_tributario, es_gran_contribuyente,
            es_agente_retencion_renta, es_agente_retencion_iva, es_agente_retencion_ica,
            es_autorretenedor_ica, vigente_desde, norma_respaldo, fuente)
         VALUES ($1,$2,$3,true,true,false,false,'ordinario',false,false,false,false,false,
                 DATE '2015-01-01','RUT (escenario D-088)','rut')`,
        [e.tenantId, companyId, terceroId],
      );
      // La empresa nueva necesita su propia regla de redondeo y su concepto.
      await tx.query(
        `INSERT INTO rounding_rule (tenant_id, company_id, codigo, nombre, modo, multiplo,
                                    aplica_a, vigente_desde, norma_respaldo, notas,
                                    requiere_verificacion_humana)
         VALUES ($1,$2,'peso_half_up_d088','Redondeo al peso','half_up',100,'todos',
                 DATE '2000-01-01','PARÁMETRO OPERATIVO DE PRUEBA de la suite de D-088.',
                 'No es una norma tributaria.', true)`,
        [e.tenantId, companyId],
      );
    });

    const conceptoId = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO concepto_causacion (
           tenant_id, company_id, codigo, nombre, naturaleza, cuenta_contrapartida_id,
           aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion,
           base_es_aiu, tipo_operacion_ica, tax_concept_reteica_id)
         SELECT $1, $2, 'SRV-ICA-D088', 'Servicio con ReteICA', 'compra', a.id,
                false, false, true, false, false, 'servicios', $3
           FROM account a
          WHERE a.tenant_id IS NULL AND a.company_id IS NULL AND a.codigo = '2205'
         RETURNING id`,
        [e.tenantId, companyId, taxConceptReteica],
      );
      return rows[0]!.id;
    });

    const r = await e.db.asTenant(e.tenantId, companyId, async (tx) =>
      resolverFactura(new RepositorioTributarioSql(tx), {
        companyId,
        terceroId,
        municipioOperacionId: e.municipios.medellin,
        fechaHechoEconomico: '2026-07-15',
        lineas: [{ conceptoId, baseGravable: pesos(10_000_000), valorIva: 0 }],
      }),
    );
    expect(r.requiereRevisionManual).toBe(true);
    expect(r.motivosRevision.map((m) => m.codigo)).toContain(
      'municipio_mide_por_periodo_sin_periodo_meses',
    );
    expect(r.retenciones).toEqual([]);
  });
});

// =============================================================================
describe('D-088 · no regresión: la medición por factura sigue intacta', () => {
  it('Cali sigue midiendo la factura individual y no abre acumulador', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, tercero, e.municipios.cali, e.ciiuSecundaria, true);

    const doc = await crearDocumento(e, tercero, '2026-07-15');
    const r = await causar(tercero, e.municipios.cali, '2026-07-15', pesos(200_000), doc);
    const evaluacion = ica(r);
    expect(evaluacion.aplicada).toBe(true);
    expect(evaluacion.regla.taxRuleId).toBe(e.reglaIcaCali);
    expect(evaluacion.nota ?? '').not.toContain('POR PERIODO');
    expect(r.acumuladosIca).toEqual([]);
    expect(await acumuladores(tercero)).toEqual([]);
  });
});

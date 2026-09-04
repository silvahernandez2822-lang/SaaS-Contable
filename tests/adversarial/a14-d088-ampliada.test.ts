/**
 * A14 — COMPUERTA AMPLIADA DE D-088 (parametrización de ICA por municipio).
 *
 * Arsenal propio. No reutiliza ni una aserción de A2, A1, A3 ni A8: lo que
 * ellos reportaron se vuelve a medir desde cero, y donde ellos midieron una
 * vía se miden TODAS las vías (D-047).
 *
 * Lo que se persigue aquí, como contador hostil y como atacante:
 *
 *  1. `gravada = false` NO retiene JAMÁS, aunque alguien haya conseguido dejar
 *     una tarifa cargada, aunque el tercero traiga un override de tarifa en
 *     `third_party_activity`, y aunque la base sea cien veces el umbral. Se
 *     ataca por las tres capas: CHECK de la base, guard de servicio y motor.
 *     `gravada = NULL` y `gravada = true` conservan la conducta anterior.
 *
 *  2. El acumulador por periodo no cuenta doble, no arrastra al cambiar de
 *     periodo, no se mueve en un dry-run, no se mueve si la transacción vuelve
 *     al SAVEPOINT y no se ve desde otra firma ni desde otra empresa.
 *
 *  3. El catálogo maestro CIIU no quedó duplicado ni pisado por el seed 110.
 *
 *  4. RLS de verdad (Regla de Oro 7), no filtros de aplicación.
 *
 *  5. Reglas de Oro 1, 2, 3 y 5 sobre TODO lo que D-088 añadió.
 *
 * REGLA DE ORO 2 DENTRO DE ESTA SUITE: no se escribe ni una tarifa, ni una base
 * mínima, ni una UVT. Los montos del escenario se calculan como FRACCIONES del
 * umbral que la propia base devuelve, y las tarifas se copian con un SELECT de
 * las filas de A1. Lo único literal es la tarifa CERO que el propio
 * `tax_rule_gravada_ck` obliga en una actividad no gravada.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RepositorioTributarioSql,
  aplicarAcumuladosIca,
  resolverFactura,
  ventanaPeriodoIca,
  type ResultadoResolucion,
  type RetencionResuelta,
} from '../../src/domain/index';
import { esperarErrorPg, uuid } from '../helpers/db';
import { isPostgresError, SQLSTATE } from '../../src/db/types';
import {
  crearTercero,
  montarEscenario,
  registrarActividad,
  type EscenarioDorado,
} from '../golden/_escenario';
import {
  editarTarifaTaxRule,
  VigenciaInvalidaError,
} from '../../src/services/parametrizacion';
import { crearOReemplazarTaxRule } from '../../src/services/catalogos';
import { PERMISOS } from '../../src/auth/permisos';

/** Ventana de dos meses. Es un parámetro de ESCENARIO, no un dato normativo. */
const PERIODO_MESES = 2;
/** Fecha dentro del último periodo del año con ventana de dos meses. */
const EN_PERIODO = '2026-07-15';

let e: EscenarioDorado;
/** Base mínima de servicios de Cali en centavos, LEÍDA de los datos de A1. */
let umbral: number;
let taxConceptReteica: string;
/** Actividad marcada NO GRAVADA en Cali por el escenario. */
let ciiuNoGravada: string;
/** `tax_rule` de esa actividad no gravada. */
let reglaNoGravada: string;

beforeAll(async () => {
  e = await montarEscenario();

  await e.db.asAdmin(async (tx) => {
    // Cali, medido POR PERIODO. La fila es de alcance de EMPRESA y COPIA con un
    // SELECT las bases mínimas y la tarifa de la fila global de A1: aquí no se
    // escribe ningún número normativo, solo el CÓMO se mide.
    await tx.query(
      `INSERT INTO municipality_ica_rule (
         tenant_id, company_id, municipality_id, practica_reteica,
         base_minima_servicios_uvt, base_minima_compras_uvt,
         base_minima_servicios_valor, base_minima_compras_valor,
         usa_tarifa_de_actividad, tarifa_general, periodicidad, regla_desempate_actividad,
         tipo_medicion_base_minima, periodo_meses,
         vigente_desde, norma_respaldo, requiere_verificacion_humana, notas)
       SELECT $1, $2, r.municipality_id, true,
              r.base_minima_servicios_uvt, r.base_minima_compras_uvt,
              r.base_minima_servicios_valor, r.base_minima_compras_valor,
              true, NULL, r.periodicidad, r.regla_desempate_actividad,
              'por_periodo', $4, r.vigente_desde,
              r.norma_respaldo, true,
              'PARÁMETRO DE ESCENARIO de la compuerta ampliada de D-088 (A14): mismas bases mínimas que la fila global de A1, medidas por periodo. No es un dato normativo de Cali.'
         FROM municipality_ica_rule r
        WHERE r.municipality_id = $3 AND r.tenant_id IS NULL AND r.company_id IS NULL`,
      [e.tenantId, e.companyId, e.municipios.cali, PERIODO_MESES],
    );

    const { rows } = await tx.query<{ v: string }>(
      `SELECT (r.base_minima_servicios_uvt * u.valor)::bigint::text AS v
         FROM municipality_ica_rule r, uvt_value u
        WHERE r.municipality_id = $1 AND r.tenant_id IS NULL AND r.company_id IS NULL
          AND u.tenant_id IS NULL AND u.company_id IS NULL
          AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, DATE '2026-07-15')`,
      [e.municipios.cali],
    );
    if (!rows[0]) throw new Error('A1 no dejó base mínima de servicios ni UVT para Cali.');
    umbral = Number(rows[0].v);

    const { rows: tc } = await tx.query<{ id: string }>(
      `SELECT tax_concept_reteica_id AS id FROM concepto_causacion WHERE id = $1`,
      [e.conceptos.serviciosIca],
    );
    taxConceptReteica = tc[0]!.id!;

    // Actividad declarada NO GRAVADA en Cali. Tarifa cero: no es una elección
    // de la suite, es lo que el CHECK `tax_rule_gravada_ck` obliga.
    ciiuNoGravada = uuid();
    reglaNoGravada = uuid();
    await tx.query(
      `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
       VALUES ($1, $2, '0113', 'Actividad NO gravada (escenario de la compuerta de A14)')`,
      [ciiuNoGravada, e.tenantId],
    );
    await tx.query(
      `INSERT INTO tax_rule (
         id, tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a,
         tipo_persona, municipality_id, ciiu_activity_id, account_id, gravada,
         vigente_desde, norma_respaldo, requiere_verificacion_humana, notas)
       VALUES ($1, $2, NULL, $3, 'reteica', 0, 'base_gravable', 'ambos', 'ambos', $4, $5, $6, false,
               DATE '2020-01-01',
               'PARÁMETRO DE ESCENARIO de la compuerta de A14: actividad declarada no gravada.',
               true, 'No es un dato normativo de Cali.')`,
      [reglaNoGravada, e.tenantId, taxConceptReteica, e.municipios.cali, ciiuNoGravada, e.cuentas.reteica],
    );
  });
}, 300_000);

afterAll(async () => {
  await e.db.close();
});

/**
 * Múltiplo del umbral, en centavos redondeados a pesos enteros. `factor = 0.6`
 * es el 60 % de la base mínima. Nunca es un valor tributario: la suite no sabe
 * —ni le hace falta— cuántos pesos son.
 */
function fraccion(factor: number): number {
  return Math.round((umbral * factor) / 100) * 100;
}

async function resolver(
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

/** Resuelve Y persiste los efectos, que es lo que hace `causarFactura`. */
async function causar(
  terceroId: string,
  municipioId: string,
  fecha: string,
  baseGravable: number,
  sourceDocumentId: string,
): Promise<ResultadoResolucion> {
  return e.db.asTenant(e.tenantId, e.companyId, async (tx) => {
    const r = await resolverFactura(new RepositorioTributarioSql(tx), {
      companyId: e.companyId,
      terceroId,
      municipioOperacionId: municipioId,
      fechaHechoEconomico: fecha,
      sourceDocumentId,
      lineas: [{ conceptoId: e.conceptos.serviciosIca, baseGravable, valorIva: 0 }],
    });
    await aplicarAcumuladosIca(tx, { tenantId: e.tenantId, companyId: e.companyId }, r.acumuladosIca);
    return r;
  });
}

function ica(r: ResultadoResolucion): RetencionResuelta {
  const xs = r.retenciones.filter((x) => x.tipo === 'reteica');
  if (xs.length !== 1) {
    throw new Error(
      `Se esperaba UNA evaluación de ReteICA y llegaron ${xs.length}. ` +
        `Motivos: ${JSON.stringify(r.motivosRevision)}`,
    );
  }
  return xs[0]!;
}

interface FilaAcumulador {
  periodo_inicio: string;
  periodo_fin: string;
  base_acumulada_centavos: string;
  documentos_contados: unknown;
}

async function acumuladores(terceroId: string): Promise<FilaAcumulador[]> {
  return e.db.asAdmin(async (tx) => {
    const { rows } = await tx.query<FilaAcumulador>(
      `SELECT periodo_inicio::text, periodo_fin::text, base_acumulada_centavos::text,
              documentos_contados
         FROM reteica_periodo_acumulado WHERE third_party_id = $1 ORDER BY periodo_inicio`,
      [terceroId],
    );
    return rows;
  });
}

function rutaSeed(relativa: string): string {
  return fileURLToPath(new URL(`../../db/seeds/${relativa}`, import.meta.url));
}

/** `('CODIGO', 'Nombre', ...)` de un seed de `ciiu_activity` → [codigo, nombre]. */
function filasDeSeed(relativa: string): Array<[string, string]> {
  const sql = readFileSync(rutaSeed(relativa), 'utf8');
  const salida: Array<[string, string]> = [];
  const re = /\(\s*'(\d{4})'\s*,\s*'((?:[^']|'')*)'\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) salida.push([m[1]!, m[2]!.replace(/''/g, "'")]);
  return salida;
}

/** Un tercero que ejerce en Cali la actividad GRAVADA del escenario dorado. */
async function terceroGravado(): Promise<string> {
  const t = await crearTercero(e, { municipioId: e.municipios.cali });
  await registrarActividad(e, t, e.municipios.cali, e.ciiuSecundaria, true);
  return t;
}

// =============================================================================
describe('A14 · D-088 · «gravada = false» no retiene POR NINGUNA VÍA', () => {
  it('la BASE rechaza el INSERT de una regla no gravada con tarifa distinta de cero', async () => {
    await esperarErrorPg(
      () =>
        e.db.asAdmin((tx) =>
          tx.query(
            `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa,
               aplica_sobre, aplica_a, tipo_persona, municipality_id, ciiu_activity_id,
               account_id, gravada, vigente_desde, norma_respaldo)
             VALUES ($1, NULL, $2, 'reteica', 0.010000, 'base_gravable', 'ambos', 'ambos',
                     $3, $4, $5, false, DATE '2026-01-01', 'ataque de A14')`,
            [e.tenantId, taxConceptReteica, e.municipios.cali, ciiuNoGravada, e.cuentas.reteica],
          ),
        ),
      SQLSTATE.CHECK_VIOLATION,
      'INSERT de tax_rule no gravada con tarifa positiva',
    );
  });

  it('tampoco se puede llegar por UPDATE: ni ponerle tarifa a la no gravada, ni desgravar la que tiene tarifa', async () => {
    // El intento de subirle la tarifa a una regla no gravada muere DOS veces:
    // primero en el trigger de vigencia append-only (Regla de Oro 3), y si
    // alguien lo desactivara, en el CHECK. Se comprueba que no pase, sea cual
    // sea el guardia que dispare primero.
    for (const [que, sql, params] of [
      ['tarifa positiva sobre regla no gravada', 'UPDATE tax_rule SET tarifa = 0.010000 WHERE id = $1', [reglaNoGravada]],
      ['desgravar una regla con tarifa positiva', 'UPDATE tax_rule SET gravada = false WHERE id = $1', [e.reglaIcaCali]],
    ] as const) {
      const codigo = await e.db
        .asAdmin((tx) => tx.query(sql, [...params]))
        .then(() => 'MUTO')
        .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
      expect(codigo, que).not.toBe('MUTO');
    }
    // Y la regla no gravada sigue con tarifa cero.
    const tarifa = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ t: string; g: boolean | null }>(
        'SELECT tarifa::text AS t, gravada AS g FROM tax_rule WHERE id = $1',
        [reglaNoGravada],
      );
      return rows[0]!;
    });
    expect(Number(tarifa.t)).toBe(0);
    expect(tarifa.g).toBe(false);
  });

  it('el motor no retiene aunque el TERCERO traiga un override de tarifa y la base sea 100× el umbral', async () => {
    const t = await crearTercero(e, { municipioId: e.municipios.cali });
    // El override del tercero es la única vía por la que una tarifa entra al
    // cálculo sin pasar por `tax_rule.tarifa`. Se copia de la regla gravada de
    // A1 con un SELECT: la suite no escribe la tarifa.
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO third_party_activity
           (tenant_id, company_id, third_party_id, municipality_id, ciiu_activity_id,
            es_principal, tarifa_ica_override, vigente_desde, norma_respaldo)
         SELECT $1, $2, $3, $4, $5, true, tr.tarifa, DATE '2015-01-01',
                'Actividad declarada en el RUT (escenario de la compuerta de A14)'
           FROM tax_rule tr WHERE tr.id = $6`,
        [e.tenantId, e.companyId, t, e.municipios.cali, ciiuNoGravada, e.reglaIcaCali],
      );
    });

    const r = await resolver(t, e.municipios.cali, EN_PERIODO, fraccion(100), null);

    // No es revisión manual: es una decisión normativa ya tomada y cargada.
    expect(r.requiereRevisionManual).toBe(false);
    const ev = ica(r);
    expect(ev.aplicada).toBe(false);
    expect(ev.valor).toBe(0);
    expect(ev.motivoNoAplica).toMatch(/NO GRAVADA/);
    // Regla de Oro 6: la traza conserva regla y vigencia aunque no se retenga.
    expect(ev.regla.taxRuleId).toBe(reglaNoGravada);
    expect(ev.normaRespaldo).toBeTruthy();
  });

  it('una actividad NO GRAVADA no suma al acumulador del periodo: no acerca a nadie a un umbral ajeno', async () => {
    const t = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, t, e.municipios.cali, ciiuNoGravada, true);
    const doc = uuid();
    await causar(t, e.municipios.cali, EN_PERIODO, fraccion(5), doc);
    expect(await acumuladores(t)).toEqual([]);
  });

  it('gravada = true retiene lo mismo que gravada = NULL: la conducta anterior a D-088 no cambia', async () => {
    // `gravada` no se puede cambiar con un UPDATE (Regla de Oro 3: el trigger
    // append-only de vigencias lo impide, y aquí queda comprobado de paso). Se
    // monta una actividad GEMELA con `gravada = true` y la MISMA tarifa —
    // copiada con un SELECT de la regla de A1, la suite no escribe tarifas— y
    // se compara centavo a centavo contra la de flag NULL.
    const ciiuGemelo = uuid();
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
         VALUES ($1, $2, '0114', 'Actividad gemela GRAVADA (escenario de A14)')`,
        [ciiuGemelo, e.tenantId],
      );
      await tx.query(
        `INSERT INTO tax_rule (
           tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a,
           tipo_persona, municipality_id, ciiu_activity_id, account_id, gravada,
           vigente_desde, norma_respaldo, requiere_verificacion_humana, notas)
         SELECT $1, NULL, tr.tax_concept_id, 'reteica', tr.tarifa, tr.aplica_sobre, tr.aplica_a,
                tr.tipo_persona, tr.municipality_id, $2, tr.account_id, true,
                tr.vigente_desde, tr.norma_respaldo, true,
                'PARÁMETRO DE ESCENARIO de A14: misma tarifa que la regla de A1, con gravada=true explícito.'
           FROM tax_rule tr WHERE tr.id = $3`,
        [e.tenantId, ciiuGemelo, e.reglaIcaCali],
      );
    });

    const conNull = await terceroGravado();
    const conTrue = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, conTrue, e.municipios.cali, ciiuGemelo, true);

    const evNulo = ica(await resolver(conNull, e.municipios.cali, EN_PERIODO, fraccion(3), null));
    const evTrue = ica(await resolver(conTrue, e.municipios.cali, EN_PERIODO, fraccion(3), null));

    expect(evNulo.aplicada).toBe(true);
    expect(evNulo.valor).toBeGreaterThan(0);
    expect(evTrue.aplicada).toBe(true);
    expect(evTrue.valor).toBe(evNulo.valor);
    expect(evTrue.base).toBe(evNulo.base);
    expect(evTrue.tarifa).toBe(evNulo.tarifa);
  });

  it('el guard de la CAPA DE SERVICIO rechaza gravada=false con tarifa, también cuando el flag se HEREDA', async () => {
    // (a) flag explícito en la entrada: lo caza el guard, sin viajar a la base.
    await expect(
      e.db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: reglaNoGravada,
            tarifa: '0.010000',
            gravada: false,
            vigenteDesde: '2027-01-01',
            normaRespaldo: 'ataque de A14',
          }),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);

    // (b) SIN flag en la entrada: se hereda `gravada = false` de la regla
    // anterior y la tarifa nueva es positiva. La combinación prohibida es
    // exactamente la misma y el motivo que ve el contador tiene que serlo
    // también, no un error crudo de PostgreSQL.
    await expect(
      e.db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: reglaNoGravada,
            tarifa: '0.010000',
            vigenteDesde: '2027-02-01',
            normaRespaldo: 'ataque de A14',
          }),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);

    // Y nada quedó escrito: la regla no gravada sigue viva y sin sucesora.
    const filas = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM tax_rule
          WHERE municipality_id = $1 AND ciiu_activity_id = $2`,
        [e.municipios.cali, ciiuNoGravada],
      );
      return Number(rows[0]!.n);
    });
    expect(filas).toBe(1);
  });

  it('el alta de una tarifa nueva rechaza igual la combinación prohibida', async () => {
    await expect(
      e.db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          crearOReemplazarTaxRule(tx, {
            tipo: 'reteica',
            conceptoCodigo: 'reteica_tarifa_general_municipio',
            tarifa: '0.010000',
            gravada: false,
            municipioDane: '76001',
            ciiuCodigo: '0113',
            vigenteDesde: '2027-01-01',
            normaRespaldo: 'ataque de A14',
          }),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);
  });
});

// =============================================================================
describe('A14 · D-088 · el acumulador por periodo', () => {
  it('no arrastra al cambiar de periodo: el periodo siguiente arranca de cero', async () => {
    const t = await terceroGravado();
    // Con ventana de dos meses anclada al año calendario: jul-ago y sep-oct.
    const finDePeriodo = ventanaPeriodoIca('2026-08-31', PERIODO_MESES)!;
    const siguiente = ventanaPeriodoIca('2026-09-01', PERIODO_MESES)!;
    expect(finDePeriodo.fin).toBe('2026-08-31');
    expect(siguiente.inicio).toBe('2026-09-01');

    const docA = uuid();
    const docB = uuid();
    // Justo por debajo del umbral en el último día del periodo N.
    const rA = await causar(t, e.municipios.cali, '2026-08-31', fraccion(0.6), docA);
    expect(ica(rA).aplicada).toBe(false);
    // La misma magnitud el primer día del periodo N+1: si el acumulador
    // arrastrara, las dos juntas cruzarían y esta retendría. No debe.
    const rB = await causar(t, e.municipios.cali, '2026-09-01', fraccion(0.6), docB);
    expect(ica(rB).aplicada).toBe(false);

    const filas = await acumuladores(t);
    expect(filas.map((f) => [f.periodo_inicio, f.periodo_fin])).toEqual([
      ['2026-07-01', '2026-08-31'],
      ['2026-09-01', '2026-10-31'],
    ]);
    // Cada ventana lleva SU base, no la suma.
    expect(Number(filas[0]!.base_acumulada_centavos)).toBe(fraccion(0.6));
    expect(Number(filas[1]!.base_acumulada_centavos)).toBe(fraccion(0.6));
  });

  it('recausar el MISMO documento diez veces no lo cuenta once: el `@>` jsonb lo sostiene', async () => {
    const t = await terceroGravado();
    const doc = uuid();
    const primera = await causar(t, e.municipios.cali, EN_PERIODO, fraccion(1.2), doc);
    const foto = JSON.stringify({
      aplicada: ica(primera).aplicada,
      valor: ica(primera).valor,
      base: ica(primera).base,
      tarifa: ica(primera).tarifa,
    });
    const acumuladoTrasLaPrimera = (await acumuladores(t))[0]!.base_acumulada_centavos;

    for (let i = 0; i < 10; i += 1) {
      const r = await causar(t, e.municipios.cali, EN_PERIODO, fraccion(1.2), doc);
      expect(
        JSON.stringify({
          aplicada: ica(r).aplicada,
          valor: ica(r).valor,
          base: ica(r).base,
          tarifa: ica(r).tarifa,
        }),
        `corrida ${i + 1} del reproceso`,
      ).toBe(foto);
    }

    const filas = await acumuladores(t);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.base_acumulada_centavos).toBe(acumuladoTrasLaPrimera);
    // La huella tampoco crece: un documento, una entrada.
    const lista = filas[0]!.documentos_contados as string[];
    expect(lista).toEqual([doc]);
  });

  it('el dry-run lee el acumulado y no escribe ni una fila', async () => {
    const t = await terceroGravado();
    const doc = uuid();
    await causar(t, e.municipios.cali, EN_PERIODO, fraccion(0.6), doc);
    const antes = await acumuladores(t);

    // Diez previsualizaciones de un documento nuevo, descartando los efectos.
    for (let i = 0; i < 10; i += 1) {
      const r = await resolver(t, e.municipios.cali, EN_PERIODO, fraccion(0.6), uuid());
      // El cálculo SÍ ve el acumulado previo: no es que ignore la tabla.
      expect(ica(r).nota ?? '').toMatch(/POR PERIODO/);
    }
    expect(await acumuladores(t)).toEqual(antes);
  });

  it('si la transacción vuelve al SAVEPOINT, el acumulador vuelve con ella', async () => {
    const t = await terceroGravado();
    const doc = uuid();
    await causar(t, e.municipios.cali, EN_PERIODO, fraccion(0.6), doc);
    const antes = await acumuladores(t);

    await e.db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const r = await resolverFactura(new RepositorioTributarioSql(tx), {
        companyId: e.companyId,
        terceroId: t,
        municipioOperacionId: e.municipios.cali,
        fechaHechoEconomico: EN_PERIODO,
        sourceDocumentId: uuid(),
        lineas: [{ conceptoId: e.conceptos.serviciosIca, baseGravable: fraccion(0.6), valorIva: 0 }],
      });
      await tx.exec('SAVEPOINT a14_carrera');
      await aplicarAcumuladosIca(tx, { tenantId: e.tenantId, companyId: e.companyId }, r.acumuladosIca);
      // Otro worker ganó la carrera: se deshace exactamente como en causacion.ts.
      await tx.exec('ROLLBACK TO SAVEPOINT a14_carrera');
    });

    expect(await acumuladores(t)).toEqual(antes);
  });

  it('aplicar dos veces los MISMOS efectos en transacciones distintas no suma dos veces', async () => {
    const t = await terceroGravado();
    const doc = uuid();
    const r = await resolver(t, e.municipios.cali, EN_PERIODO, fraccion(0.6), doc);
    for (let i = 0; i < 3; i += 1) {
      await e.db.asTenant(e.tenantId, e.companyId, (tx) =>
        aplicarAcumuladosIca(tx, { tenantId: e.tenantId, companyId: e.companyId }, r.acumuladosIca),
      );
    }
    const filas = await acumuladores(t);
    expect(filas).toHaveLength(1);
    expect(Number(filas[0]!.base_acumulada_centavos)).toBe(fraccion(0.6));
    expect(filas[0]!.documentos_contados).toEqual([doc]);
  });

  it('el acumulado de OTRO tercero no empuja a este por encima del umbral', async () => {
    const a = await terceroGravado();
    const b = await terceroGravado();
    await causar(a, e.municipios.cali, EN_PERIODO, fraccion(0.9), uuid());
    const r = await causar(b, e.municipios.cali, EN_PERIODO, fraccion(0.9), uuid());
    expect(ica(r).aplicada).toBe(false);
  });

  it('la base es BIGINT de centavos de punta a punta: ni un float (Regla de Oro 5)', async () => {
    const tipos = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'reteica_periodo_acumulado'
          ORDER BY column_name`,
      );
      return rows;
    });
    const numericas = tipos.filter((t) => /int|numeric|double|real/.test(t.data_type));
    expect(numericas).toEqual([{ column_name: 'base_acumulada_centavos', data_type: 'bigint' }]);
  });
});

// =============================================================================
describe('A14 · D-088 · aislamiento (Regla de Oro 7: RLS, no filtros)', () => {
  it('el acumulador de una firma es invisible desde otra firma y desde otra empresa', async () => {
    const t = await terceroGravado();
    const doc = uuid();
    await causar(t, e.municipios.cali, EN_PERIODO, fraccion(0.6), doc);
    expect(await acumuladores(t)).toHaveLength(1);

    // Otra firma con su empresa.
    const otroTenant = uuid();
    const otraCompany = uuid();
    // Otra empresa DE LA MISMA firma: el segundo nivel de la política.
    const hermana = uuid();
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO tenant (id, nit, razon_social, email_contacto)
         VALUES ($1, 'NIT-FIRMA-A14-D088', 'Firma ajena de A14', 'a14-d088@pruebas.local')`,
        [otroTenant],
      );
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, 'NIT-EMPRESA-A14-D088', 'Empresa de la firma ajena')`,
        [otraCompany, otroTenant],
      );
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, 'NIT-EMPRESA-HERMANA-D088', 'Otra empresa de la MISMA firma')`,
        [hermana, e.tenantId],
      );
    });

    const desdeOtraFirma = await e.db.asTenant(otroTenant, otraCompany, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM reteica_periodo_acumulado',
      );
      return Number(rows[0]!.n);
    });
    expect(desdeOtraFirma).toBe(0);

    const desdeLaHermana = await e.db.asTenant(e.tenantId, hermana, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM reteica_periodo_acumulado WHERE third_party_id = $1',
        [t],
      );
      return Number(rows[0]!.n);
    });
    expect(desdeLaHermana).toBe(0);

    // Y no se puede escribir cruzado: un acumulado de la empresa hermana
    // apuntando al tercero de la otra empresa muere en la FK compuesta.
    await esperarErrorPg(
      () =>
        e.db.asAdmin((tx) =>
          tx.query(
            `INSERT INTO reteica_periodo_acumulado
               (tenant_id, company_id, third_party_id, municipality_id, tipo_operacion_ica,
                periodo_inicio, periodo_fin, base_acumulada_centavos)
             VALUES ($1, $2, $3, $4, 'servicios', DATE '2026-07-01', DATE '2026-08-31', 1)`,
            [e.tenantId, hermana, t, e.municipios.cali],
          ),
        ),
      SQLSTATE.FOREIGN_KEY_VIOLATION,
      'acumulado de una empresa apuntando al tercero de otra',
    );
  });

  it('las filas nuevas de municipality_ica_rule y tax_rule de D-088 no se ven desde otra firma', async () => {
    const otroTenant = uuid();
    const otraCompany = uuid();
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO tenant (id, nit, razon_social, email_contacto)
         VALUES ($1, 'NIT-FIRMA-A14-D088-B', 'Segunda firma ajena', 'a14-d088b@pruebas.local')`,
        [otroTenant],
      );
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, 'NIT-EMPRESA-A14-D088-B', 'Empresa de la segunda firma ajena')`,
        [otraCompany, otroTenant],
      );
    });

    const visto = await e.db.asTenant(otroTenant, otraCompany, async (tx) => {
      const { rows: reglas } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM municipality_ica_rule
          WHERE tipo_medicion_base_minima = 'por_periodo'`,
      );
      const { rows: tarifas } = await tx.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM tax_rule WHERE gravada IS NOT NULL',
      );
      const { rows: ciiu } = await tx.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM ciiu_activity WHERE tenant_id IS NOT NULL',
      );
      return {
        reglasPorPeriodo: Number(reglas[0]!.n),
        tarifasConFlag: Number(tarifas[0]!.n),
        ciiuAjenos: Number(ciiu[0]!.n),
      };
    });
    // La regla por periodo y la tarifa no gravada son de la OTRA firma.
    expect(visto.reglasPorPeriodo).toBe(0);
    expect(visto.tarifasConFlag).toBe(0);
    // El CIIU de la firma A tampoco: el catálogo compartido es el de tenant NULL.
    expect(visto.ciiuAjenos).toBe(0);
  });

  it('el catálogo CIIU COMPARTIDO sí se ve desde cualquier firma, y no se puede escribir cruzado', async () => {
    const otroTenant = uuid();
    const otraCompany = uuid();
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO tenant (id, nit, razon_social, email_contacto)
         VALUES ($1, 'NIT-FIRMA-A14-D088-C', 'Tercera firma', 'a14-d088c@pruebas.local')`,
        [otroTenant],
      );
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, 'NIT-EMPRESA-A14-D088-C', 'Empresa de la tercera firma')`,
        [otraCompany, otroTenant],
      );
    });

    const compartidos = await e.db.asTenant(otroTenant, otraCompany, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM ciiu_activity WHERE tenant_id IS NULL',
      );
      return Number(rows[0]!.n);
    });
    expect(compartidos).toBeGreaterThan(400);

    // Escribir en el catálogo de OTRA firma: la política lo impide.
    const codigo = await e.db
      .asTenant(otroTenant, otraCompany, (tx) =>
        tx.query(
          `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
           VALUES ($1, $2, '9999', 'inyectada por A14')`,
          [uuid(), e.tenantId],
        ),
      )
      .then(() => 'ESCRIBIO')
      .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
    expect(codigo, 'INSERT de un CIIU en el catálogo de otra firma').not.toBe('ESCRIBIO');
  });
});

// =============================================================================
describe('A14 · D-088 · el catálogo maestro CIIU del seed 110', () => {
  it('no hay un solo código duplicado en el catálogo global', async () => {
    const dups = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string; n: string }>(
        `SELECT codigo, count(*)::int AS n FROM ciiu_activity
          WHERE tenant_id IS NULL AND company_id IS NULL
          GROUP BY codigo HAVING count(*) > 1`,
      );
      return rows;
    });
    expect(dups).toEqual([]);
  });

  it('el seed 110 NO reinsertó ni PISÓ un solo código que ya existiera', async () => {
    // Se leen los tres seeds y se comparan los literales: para los códigos que
    // aparecen tanto en un seed ANTERIOR como en el 110, el nombre que quedó en
    // la base tiene que ser el del seed anterior. Si el 110 los hubiera pisado
    // (o si el `NOT EXISTS` no funcionara), el nombre sería el suyo.
    const previos = new Map<string, string>([
      ...filasDeSeed('tanda1/020_ciiu_minimo.sql'),
      ...filasDeSeed('tanda2/030_ciiu_ampliado.sql'),
    ]);
    const delD088 = new Map(filasDeSeed('tanda2/110_ciiu_completo_d088.sql'));
    const solapados = [...previos.keys()].filter((c) => delD088.has(c));
    // Que haya solape es justamente lo que hace la prueba interesante: si no
    // hubiera, no estaría demostrando nada.
    expect(solapados.length).toBeGreaterThan(0);

    const enBase = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string; nombre: string }>(
        `SELECT codigo, nombre FROM ciiu_activity
          WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = ANY($1::text[])
          ORDER BY codigo`,
        [[...previos.keys()]],
      );
      return rows;
    });
    expect(enBase.map((r) => r.codigo).sort()).toEqual([...previos.keys()].sort());
    for (const fila of enBase) {
      expect(fila.nombre, `el catálogo conserva el nombre previo de ${fila.codigo}`).toBe(
        previos.get(fila.codigo),
      );
    }

    // Y el seed 110 no contiene UPDATE ni DELETE: es aditivo puro.
    const sql = readFileSync(rutaSeed('tanda2/110_ciiu_completo_d088.sql'), 'utf8');
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).not.toMatch(/^\s*DELETE\s/im);
    expect(sql).toMatch(/NOT EXISTS/i);
  });

  it('el catálogo global quedó con las 454 clases y todas de cuatro dígitos', async () => {
    const filas = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string; malos: string }>(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE codigo !~ '^[0-9]{4}$')::int AS malos
           FROM ciiu_activity WHERE tenant_id IS NULL AND company_id IS NULL`,
      );
      return rows[0]!;
    });
    expect(Number(filas.malos)).toBe(0);
    expect(Number(filas.n)).toBe(454);
  });
});

// =============================================================================
describe('A14 · D-088 · Reglas de Oro 1 y 3 — nada de esto abre el ledger', () => {
  it('el acumulador NO es fuente de verdad contable: no cuelga de ningún asiento', async () => {
    const columnas = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'reteica_periodo_acumulado'`,
      );
      return rows.map((r) => r.column_name);
    });
    // Ni referencia al ledger, ni vigencia: es estado derivado, no parámetro.
    expect(columnas).not.toContain('journal_entry_id');
    expect(columnas).not.toContain('vigente_desde');
    expect(columnas).not.toContain('vigente_hasta');
    expect(columnas).not.toContain('norma_respaldo');

    // Y ninguna tabla del ledger lo referencia.
    const fks = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n
           FROM information_schema.constraint_column_usage
          WHERE table_name = 'reteica_periodo_acumulado'
            AND constraint_name LIKE '%journal%'`,
      );
      return Number(rows[0]!.n);
    });
    expect(fks).toBe(0);
  });

  it('un asiento desbalanceado sigue muriendo en la base, con D-088 aplicado', async () => {
    const codigo = await e.db
      .asAdmin(async (tx) => {
        const { rows: periodo } = await tx.query<{ id: string }>(
          `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
           VALUES ($1, $2, 2026, 7, DATE '2026-07-01', DATE '2026-07-31', 'abierto')
           ON CONFLICT DO NOTHING RETURNING id`,
          [e.tenantId, e.companyId],
        );
        const periodoId =
          periodo[0]?.id ??
          (
            await tx.query<{ id: string }>(
              `SELECT id FROM fiscal_period WHERE company_id = $1 AND anio = 2026 AND mes = 7`,
              [e.companyId],
            )
          ).rows[0]!.id;
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO journal_entry (tenant_id, company_id, fiscal_period_id, fecha, descripcion, estado)
           VALUES ($1, $2, $3, DATE '2026-07-15', 'asiento desbalanceado de A14', 'borrador')
           RETURNING id`,
          [e.tenantId, e.companyId, periodoId],
        );
        const entryId = rows[0]!.id;
        await tx.query(
          `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, account_id, side, monto, orden)
           VALUES ($1,$2,$3,$4,'debito',100000,1)`,
          [e.tenantId, e.companyId, entryId, e.cuentas.reteica],
        );
        await tx.query(
          `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, account_id, side, monto, orden)
           VALUES ($1,$2,$3,$4,'credito',90000,2)`,
          [e.tenantId, e.companyId, entryId, e.cuentas.retefuente],
        );
        await tx.query(
          `UPDATE journal_entry SET estado = 'posted', posted_at = now() WHERE id = $1`,
          [entryId],
        );
      })
      .then(() => 'PUBLICO')
      .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
    expect(codigo, 'publicar un asiento desbalanceado').not.toBe('PUBLICO');
  });

  it('la resolución por VIGENCIA sigue mandando: cambiar el tipo de medición no altera el pasado', async () => {
    // La regla por periodo del escenario está vigente desde la fecha de A1.
    // Se abre una vigencia NUEVA que vuelve a medir por factura, y una fecha
    // anterior sigue resolviendo por periodo (Regla de Oro 3).
    await e.db.asAdmin(async (tx) => {
      // Se cierra la vigencia anterior (lo único que el trigger append-only
      // permite tocar) y se abre la nueva: exactamente el camino de la 6.2.3.
      await tx.query(
        `UPDATE municipality_ica_rule SET vigente_hasta = DATE '2026-12-31'
          WHERE company_id = $1 AND municipality_id = $2 AND vigente_hasta IS NULL`,
        [e.companyId, e.municipios.cali],
      );
      await tx.query(
        `INSERT INTO municipality_ica_rule (
           tenant_id, company_id, municipality_id, practica_reteica,
           base_minima_servicios_uvt, base_minima_compras_uvt,
           usa_tarifa_de_actividad, periodicidad, regla_desempate_actividad,
           tipo_medicion_base_minima, periodo_meses, vigente_desde, norma_respaldo,
           requiere_verificacion_humana, notas)
         SELECT r.tenant_id, r.company_id, r.municipality_id, r.practica_reteica,
                r.base_minima_servicios_uvt, r.base_minima_compras_uvt,
                r.usa_tarifa_de_actividad, r.periodicidad, r.regla_desempate_actividad,
                'por_factura', NULL, DATE '2027-01-01', r.norma_respaldo, true,
                'PARÁMETRO DE ESCENARIO de A14: vigencia nueva que vuelve a medir por factura.'
           FROM municipality_ica_rule r
          WHERE r.company_id = $1 AND r.municipality_id = $2
            AND r.vigente_hasta = DATE '2026-12-31'`,
        [e.companyId, e.municipios.cali],
      );
    });

    const t = await terceroGravado();
    // 2026 (vigencia vieja): mide por periodo → abre acumulador.
    const viejo = await causar(t, e.municipios.cali, EN_PERIODO, fraccion(0.6), uuid());
    expect(ica(viejo).nota ?? '').toMatch(/POR PERIODO/);
    // 2027 (vigencia nueva): mide por factura → ni menciona el acumulado.
    const nuevo = await causar(t, e.municipios.cali, '2027-03-10', fraccion(0.6), uuid());
    expect(ica(nuevo).nota ?? '').not.toMatch(/POR PERIODO/);
    // Y no abrió ninguna ventana de 2027.
    const filas = await acumuladores(t);
    expect(filas.every((f) => f.periodo_inicio.startsWith('2026'))).toBe(true);
  });
});

// =============================================================================
describe('A14 · D-088 · permisos del submódulo (nivel firma, no empresa)', () => {
  it('los dos códigos existen, están en parametrizacion y el espejo del código coincide', async () => {
    const filas = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string; modulo: string; accion_tipo: string }>(
        `SELECT codigo, modulo, accion_tipo FROM permission
          WHERE codigo LIKE 'parametro.ica.%' ORDER BY codigo`,
      );
      return rows;
    });
    expect(filas).toEqual([
      { codigo: 'parametro.ica.editar', modulo: 'parametrizacion', accion_tipo: 'editar' },
      { codigo: 'parametro.ica.leer', modulo: 'parametrizacion', accion_tipo: 'ver' },
    ]);
    expect(Object.values(PERMISOS)).toContain('parametro.ica.leer');
    expect(Object.values(PERMISOS)).toContain('parametro.ica.editar');
  });

  it('se conceden por ROL (nivel firma) y no llevan alcance de empresa', async () => {
    const asignaciones = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string; roles: string }>(
        `SELECT rp.permission_codigo AS codigo, count(*)::int AS roles
           FROM role_permission rp
          WHERE rp.permission_codigo LIKE 'parametro.ica.%'
          GROUP BY rp.permission_codigo ORDER BY 1`,
      );
      return rows;
    });
    expect(asignaciones.map((a) => a.codigo)).toEqual([
      'parametro.ica.editar',
      'parametro.ica.leer',
    ]);
    for (const a of asignaciones) expect(Number(a.roles)).toBeGreaterThan(0);

    // `role_permission` no tiene company_id: la concesión es de FIRMA. Si
    // alguien la acotara por empresa, esta prueba lo delataría.
    const columnas = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'role_permission'`,
      );
      return rows.map((r) => r.column_name);
    });
    expect(columnas).not.toContain('company_id');
  });

  it('quien tiene el grueso recibe el fino: la migración 178 no relaja el candado del motor', async () => {
    const huerfanos = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ role_id: string }>(
        `SELECT rp.role_id FROM role_permission rp
          WHERE rp.permission_codigo = 'parametro.editar'
            AND NOT EXISTS (
              SELECT 1 FROM role_permission x
               WHERE x.role_id = rp.role_id AND x.permission_codigo = 'parametro.ica.editar')`,
      );
      return rows;
    });
    expect(huerfanos).toEqual([]);

    // Y al revés: nadie tiene el fino sin el grueso (el fino restringe, no habilita).
    const colados = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ role_id: string }>(
        `SELECT rp.role_id FROM role_permission rp
          WHERE rp.permission_codigo = 'parametro.ica.editar'
            AND NOT EXISTS (
              SELECT 1 FROM role_permission x
               WHERE x.role_id = rp.role_id AND x.permission_codigo = 'parametro.editar')`,
      );
      return rows;
    });
    expect(colados).toEqual([]);
  });
});

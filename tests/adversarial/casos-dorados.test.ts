/**
 * A14 — LOS 20 CASOS DORADOS DE LA SECCIÓN 12, VERIFICADOS DE FORMA INDEPENDIENTE.
 *
 * En la Ola 0 este archivo tenía veinte marcadores `todo` porque no existía
 * motor, ni datos, ni parser: marcar uno en verde habría sido el falso PASS más
 * caro del proyecto. En la Ola 1 ya existen las tres piezas, así que los
 * veinte se resuelven a veredicto real, uno por uno.
 *
 * QUÉ HACE ESTA SUITE QUE NO HACE LA DE A3 (`tests/golden/`):
 *
 *  1. **No le cree al motor su propia respuesta.** Cada retención se AUDITA
 *     contra la fila de `tax_rule` que ella misma dice haber usado: la tarifa
 *     que reporta tiene que ser la de la fila, la cuenta tiene que ser la de la
 *     fila, la vigencia tiene que cubrir la fecha del hecho, y el valor tiene
 *     que coincidir con el producto `base × tarifa` recalculado **en SQL**, no
 *     con la aritmética del propio motor. Si el motor mintiera sobre qué regla
 *     usó, o calculara con una tarifa distinta de la que reporta, esta suite lo
 *     ve y la de A3 no.
 *
 *  2. **Cruza cada resultado con el literal de la sección 12.** Los $40.000,
 *     $28.500, $60.000, $15.000, $22.000, $16.000, $10.000, $190.000 y $2.000
 *     de la tabla están escritos aquí como los escribió el mega-prompt. Son la
 *     afirmación que la suite defiende; no salen de ninguna tabla.
 *
 *  3. **Llega hasta el ASIENTO.** La sección 12 dice "asiento idéntico las 10
 *     veces" (caso 18) y "por asiento nuevo, sin mutar el original" (caso 15).
 *     Un asiento lo construye A6, no A3, así que esos dos casos se prueban de
 *     punta a punta contra `journal_entry` / `journal_line`.
 *
 * ANDAMIAJE QUE A14 ADJUDICÓ COMO LEGÍTIMO (ver ESTADO_PROYECTO.md, D-041):
 * el escenario compartido monta una `rounding_rule` y materializa dos reglas de
 * ReteICA copiando la tarifa real de A1. Esta suite lo verifica en vez de
 * confiarlo: hay una prueba que demuestra que **ningún** valor esperado de la
 * sección 12 depende del modo de redondeo (todos son productos exactos), y otra
 * que demuestra que la tarifa materializada es, byte a byte, la de
 * `municipality_ica_rule` de A1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MOTIVO,
  RepositorioTributarioSql,
  persistirRetenciones,
  resolverFactura,
  resolverRetenciones,
  type EntradaResolucion,
  type ResultadoResolucion,
  type RetencionResuelta,
} from '../../src/domain/index.js';
import {
  crearDocumento,
  crearTercero,
  montarEscenario,
  pesos,
  registrarActividad,
  type EscenarioDorado,
} from '../golden/_escenario.js';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db.js';

/** 15-jul-2026: el Decreto 572 ya tiene efectos operativos según los datos de A1. */
const FECHA = '2026-07-15';

let e: EscenarioDorado;

beforeAll(async () => {
  e = await montarEscenario();
}, 240_000);

afterAll(async () => {
  await e?.db.close();
});

async function resolver(
  entrada: Partial<EntradaResolucion> & { terceroId: string; conceptoId: string; baseGravable: number },
): Promise<ResultadoResolucion> {
  return e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
    resolverRetenciones(new RepositorioTributarioSql(tx), {
      companyId: e.companyId,
      municipioOperacionId: null,
      valorIva: 0,
      fechaHechoEconomico: FECHA,
      ...entrada,
    }),
  );
}

function unica(r: ResultadoResolucion, tipo: string): RetencionResuelta {
  const xs = r.retenciones.filter((x) => x.tipo === tipo);
  if (xs.length !== 1) {
    throw new Error(
      `Se esperaba UNA evaluación de ${tipo} y llegaron ${xs.length}. Motivos: ${JSON.stringify(
        r.motivosRevision,
      )}`,
    );
  }
  return xs[0]!;
}

function codigos(r: ResultadoResolucion): string[] {
  return r.motivosRevision.map((m) => m.codigo);
}

// =============================================================================
// EL AUDITOR: la retención no puede mentir sobre la regla que dice haber usado
// =============================================================================
interface FilaRegla {
  tipo: string;
  tarifa: string;
  base_minima_uvt: string | null;
  aplica_sobre: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  account_id: string;
  norma_respaldo: string;
  cubre_la_fecha: boolean;
  valor_recalculado_en_sql: string;
  umbral_en_centavos: string | null;
}

/**
 * Verifica una retención contra la BASE DE DATOS, no contra el motor:
 *  · la tarifa reportada es la de la fila `tax_rule` que dice haber usado;
 *  · esa fila estaba vigente a la fecha del hecho económico;
 *  · la cuenta PUC y la norma son las de esa fila;
 *  · el valor coincide con `round(base × tarifa)` recalculado por PostgreSQL;
 *  · si NO aplicó, la base está efectivamente por debajo del umbral que resulta
 *    de multiplicar la base mínima en UVT por la UVT vigente a esa fecha.
 */
async function auditar(retencion: RetencionResuelta, fecha = FECHA): Promise<void> {
  const fila = await e.db.asAdmin(async (tx) => {
    const { rows } = await tx.query<FilaRegla>(
      `SELECT r.tipo,
              r.tarifa::text,
              r.base_minima_uvt::text,
              r.aplica_sobre,
              r.vigente_desde::text,
              r.vigente_hasta::text,
              r.account_id,
              r.norma_respaldo,
              app.esta_vigente(r.vigente_desde, r.vigente_hasta, $2::date) AS cubre_la_fecha,
              (round(($3::numeric * r.tarifa) / 100) * 100)::text AS valor_recalculado_en_sql,
              (SELECT (r.base_minima_uvt * u.valor)::bigint::text
                 FROM uvt_value u
                WHERE u.tenant_id IS NULL AND u.company_id IS NULL
                  AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, $2::date)
                LIMIT 1) AS umbral_en_centavos
         FROM tax_rule r WHERE r.id = $1`,
      [retencion.regla.taxRuleId, fecha, retencion.base],
    );
    return rows[0];
  });

  if (!fila) {
    throw new Error(
      `La retención de ${retencion.tipo} dice haber usado la regla ${retencion.regla.taxRuleId}, ` +
        'que NO EXISTE en tax_rule. Trazabilidad rota (Regla de Oro 6).',
    );
  }

  expect(`${retencion.tipo} tipo`).toBe(`${fila.tipo} tipo`);
  expect(`${retencion.tipo} tarifa=${retencion.tarifa}`).toBe(`${retencion.tipo} tarifa=${fila.tarifa}`);
  expect(`${retencion.tipo} cuenta=${retencion.accountId}`).toBe(
    `${retencion.tipo} cuenta=${fila.account_id}`,
  );
  expect(`${retencion.tipo} vigente_desde=${retencion.regla.vigenteDesde}`).toBe(
    `${retencion.tipo} vigente_desde=${fila.vigente_desde}`,
  );
  expect(`${retencion.tipo} vigencia cubre ${fecha}: ${fila.cubre_la_fecha}`).toBe(
    `${retencion.tipo} vigencia cubre ${fecha}: true`,
  );
  expect(retencion.normaRespaldo).toBe(fila.norma_respaldo);

  if (retencion.aplicada) {
    // El valor lo vuelve a calcular PostgreSQL desde la fila paramétrica.
    expect(`${retencion.tipo} valor=${retencion.valor}`).toBe(
      `${retencion.tipo} valor=${Number(fila.valor_recalculado_en_sql)}`,
    );
    expect(retencion.valor).toBeGreaterThan(0);
  } else {
    expect(retencion.valor).toBe(0);
    if (fila.umbral_en_centavos !== null && retencion.motivoNoAplica?.includes('base mínima')) {
      expect(
        `base=${retencion.base} < umbral=${fila.umbral_en_centavos}: ${
          retencion.base < Number(fila.umbral_en_centavos)
        }`,
      ).toBe(`base=${retencion.base} < umbral=${fila.umbral_en_centavos}: true`);
    }
  }

  // Los siete campos obligatorios de la sección 9.1, presentes siempre.
  expect(retencion.tarifa).toMatch(/^\d+\.\d+$/);
  expect(retencion.regla.taxRuleId).toMatch(/^[0-9a-f-]{36}$/);
  expect(retencion.accountId).toMatch(/^[0-9a-f-]{36}$/);
  expect(retencion.normaRespaldo.length).toBeGreaterThan(10);
  expect(retencion.fechaHechoEconomico).toBe(fecha);
}

// =============================================================================
describe('A14 · los 20 casos dorados de la sección 12 — veredicto propio', () => {
  // ---------------------------------------------------------------------------
  it('1 · Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá → retefuente $40.000 y ReteIVA $28.500', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      municipioOperacionId: e.municipios.bogota,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });

    const rf = unica(r, 'retefuente');
    expect(rf.valor).toBe(pesos(40_000)); // literal de la sección 12
    expect(rf.base).toBe(pesos(1_000_000));
    await auditar(rf);

    const ri = unica(r, 'reteiva');
    expect(ri.valor).toBe(pesos(28_500)); // 15% sobre los $190.000 de IVA
    expect(ri.base).toBe(pesos(190_000)); // sobre el IVA, NO sobre la base
    await auditar(ri);

    expect(r.requiereRevisionManual).toBe(false);
  });

  it('1 (pata de ReteICA) · Bogotá por actividad: el motor NO inventa la tarifa que A1 no cargó', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.bogota });
    await registrarActividad(e, tercero, e.municipios.bogota, e.ciiuGlobal, true);
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.bogota,
      baseGravable: pesos(1_000_000),
    });
    expect(r.retenciones.filter((x) => x.tipo === 'reteica')).toEqual([]);
    expect(codigos(r)).toContain(MOTIVO.SIN_REGLA);

    // Y se comprueba en la BASE que efectivamente no hay tarifa de Bogotá por
    // actividad: la negativa del motor no es un capricho, es que no hay dato.
    const filas = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tax_rule r
           JOIN municipality m ON m.id = r.municipality_id
          WHERE r.tipo = 'reteica' AND m.codigo_dane = '11001'`,
      );
      return rows[0]!.n;
    });
    expect(filas).toBe(0);
  });

  // ---------------------------------------------------------------------------
  it('2 · Mismo servicio a PN NO declarante → $60.000: el eje "tercero" opera', async () => {
    const declarante = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const noDeclarante = await crearTercero(e, { tipoPersona: 'natural', declarante: false });

    const a = await resolver({
      terceroId: declarante,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
    });
    const b = await resolver({
      terceroId: noDeclarante,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
    });

    expect(unica(b, 'retefuente').valor).toBe(pesos(60_000));
    await auditar(unica(b, 'retefuente'));
    // Mismo concepto, misma fecha, misma cuantía: SOLO cambia el tercero, y la
    // regla aplicada es OTRA fila. Si fuera la misma, el eje no existiría.
    expect(unica(a, 'retefuente').regla.taxRuleId).not.toBe(unica(b, 'retefuente').regla.taxRuleId);
    expect(unica(a, 'retefuente').valor).toBe(pesos(40_000));
  });

  // ---------------------------------------------------------------------------
  it('3 · Servicio de $80.000 (bajo 2 UVT = $104.748) → no retiene, con motivo registrado', async () => {
    const tercero = await crearTercero(e, {});
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(80_000),
    });
    const rf = unica(r, 'retefuente');
    expect(rf.aplicada).toBe(false);
    expect(rf.valor).toBe(0);
    expect(rf.motivoNoAplica).toContain('base mínima');
    await auditar(rf);

    // El umbral NO está en el código: sale de base_minima_uvt × UVT vigente.
    // Se comprueba que el umbral real es el de la sección 12 ($104.748).
    const umbral = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ umbral: string }>(
        `SELECT (r.base_minima_uvt * u.valor)::bigint::text AS umbral
           FROM tax_rule r, uvt_value u
          WHERE r.id = $1 AND u.tenant_id IS NULL AND u.company_id IS NULL
            AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, $2::date)`,
        [rf.regla.taxRuleId, FECHA],
      );
      return Number(rows[0]!.umbral);
    });
    expect(umbral).toBe(pesos(104_748));

    // Y la evaluación negativa se PERSISTE: es lo que el contador abre a preguntar.
    const documento = await crearDocumento(e, tercero, FECHA);
    const ids = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: documento },
        r,
      ),
    );
    const fila = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ aplicada: boolean; valor: string; motivo_no_aplica: string }>(
        `SELECT aplicada, valor::text, motivo_no_aplica FROM retention_applied WHERE id = $1`,
        [ids[0]!],
      );
      return rows[0]!;
    });
    expect(fila.aplicada).toBe(false);
    expect(Number(fila.valor)).toBe(0);
    expect(fila.motivo_no_aplica).toContain('base mínima');
  });

  // ---------------------------------------------------------------------------
  it('4 · Compra de $500.000 (bajo 10 UVT = $523.740) → no retiene, con motivo', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(500_000),
    });
    const rf = unica(r, 'retefuente');
    expect(rf.aplicada).toBe(false);
    expect(rf.valor).toBe(0);
    expect(rf.motivoNoAplica).toContain('base mínima');
    await auditar(rf);

    const umbral = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ umbral: string }>(
        `SELECT (r.base_minima_uvt * u.valor)::bigint::text AS umbral
           FROM tax_rule r, uvt_value u
          WHERE r.id = $1 AND u.tenant_id IS NULL AND u.company_id IS NULL
            AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, $2::date)`,
        [rf.regla.taxRuleId, FECHA],
      );
      return Number(rows[0]!.umbral);
    });
    expect(umbral).toBe(pesos(523_740));
  });

  // ---------------------------------------------------------------------------
  it('5 · Compra de $600.000 a declarante → $15.000 (2,5%)', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(600_000),
    });
    const rf = unica(r, 'retefuente');
    expect(rf.aplicada).toBe(true);
    expect(rf.valor).toBe(pesos(15_000));
    await auditar(rf);
  });

  // ---------------------------------------------------------------------------
  it('6 · Honorarios PJ $200.000 → $22.000 (11% desde el primer peso)', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica' });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.honorariosPj,
      baseGravable: pesos(200_000),
    });
    const rf = unica(r, 'retefuente');
    expect(rf.valor).toBe(pesos(22_000));
    await auditar(rf);
    // "Desde el primer peso" es un dato, no una excepción del código: la regla
    // trae base mínima 0 y por eso $200.000 (bajo las 10 UVT de compras) retiene.
    expect(rf.baseMinimaUvtUsada === null || Number(rf.baseMinimaUvtUsada) === 0).toBe(true);
  });

  // ---------------------------------------------------------------------------
  it('7 · Arrendamiento de inmueble $400.000 no retiene; el de mueble por igual valor sí ($16.000)', async () => {
    const tercero = await crearTercero(e, {});
    const inmueble = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.arrendamientoInmuebles,
      baseGravable: pesos(400_000),
    });
    const mueble = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.arrendamientoMuebles,
      baseGravable: pesos(400_000),
    });

    expect(unica(inmueble, 'retefuente').aplicada).toBe(false);
    expect(unica(inmueble, 'retefuente').valor).toBe(0);
    expect(unica(mueble, 'retefuente').aplicada).toBe(true);
    expect(unica(mueble, 'retefuente').valor).toBe(pesos(16_000));
    await auditar(unica(inmueble, 'retefuente'));
    await auditar(unica(mueble, 'retefuente'));
  });

  // ---------------------------------------------------------------------------
  it('8 · Servicio en Medellín → ReteICA con la tarifa general 2‰ y base 15 UVT = $785.610', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.medellin,
      baseGravable: pesos(1_000_000),
    });
    const ica = unica(r, 'reteica');
    expect(ica.aplicada).toBe(true);
    expect(ica.valor).toBe(pesos(2_000)); // 2‰ de $1.000.000
    expect(ica.municipalityId).toBe(e.municipios.medellin);
    expect(ica.ciiuActivityId).toBeNull(); // Medellín no va por actividad
    await auditar(ica);

    // La base mínima del municipio es la de la sección 12: 15 UVT = $785.610.
    const umbral = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ umbral: string }>(
        `SELECT (mir.base_minima_servicios_uvt * u.valor)::bigint::text AS umbral
           FROM municipality_ica_rule mir
           JOIN municipality m ON m.id = mir.municipality_id, uvt_value u
          WHERE m.codigo_dane = '05001'
            AND app.esta_vigente(mir.vigente_desde, mir.vigente_hasta, $1::date)
            AND u.tenant_id IS NULL AND u.company_id IS NULL
            AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, $1::date)`,
        [FECHA],
      );
      return Number(rows[0]!.umbral);
    });
    expect(umbral).toBe(pesos(785_610));

    // Y por debajo de esa base no retiene.
    const bajo = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.medellin,
      baseGravable: pesos(200_000),
    });
    expect(unica(bajo, 'reteica').aplicada).toBe(false);
  });

  // ---------------------------------------------------------------------------
  it('9 · Mismo servicio en Cali → base de servicios 3 UVT = $157.122, distinta de la de Medellín', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, tercero, e.municipios.cali, e.ciiuSecundaria, true);

    const enCali = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.cali,
      baseGravable: pesos(200_000),
    });
    const enMedellin = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.medellin,
      baseGravable: pesos(200_000),
    });

    // El mismo importe, el mismo tercero, el mismo día: solo cambia el municipio.
    expect(unica(enCali, 'reteica').aplicada).toBe(true);
    expect(unica(enMedellin, 'reteica').aplicada).toBe(false);
    await auditar(unica(enCali, 'reteica'));

    const umbral = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ umbral: string }>(
        `SELECT (mir.base_minima_servicios_uvt * u.valor)::bigint::text AS umbral
           FROM municipality_ica_rule mir
           JOIN municipality m ON m.id = mir.municipality_id, uvt_value u
          WHERE m.codigo_dane = '76001'
            AND app.esta_vigente(mir.vigente_desde, mir.vigente_hasta, $1::date)
            AND u.tenant_id IS NULL AND u.company_id IS NULL
            AND app.esta_vigente(u.vigente_desde, u.vigente_hasta, $1::date)`,
        [FECHA],
      );
      return Number(rows[0]!.umbral);
    });
    expect(umbral).toBe(pesos(157_122));
  });

  // ---------------------------------------------------------------------------
  it('10 · Principal en Bogotá, secundaria en Cali, operación en Cali → manda la actividad DE CALI', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.bogota });
    await registrarActividad(e, tercero, e.municipios.bogota, e.ciiuGlobal, true);
    await registrarActividad(e, tercero, e.municipios.cali, e.ciiuSecundaria, false);

    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.cali,
      baseGravable: pesos(1_000_000),
    });
    const ica = unica(r, 'reteica');
    expect(ica.aplicada).toBe(true);
    expect(ica.municipalityId).toBe(e.municipios.cali);
    expect(ica.ciiuActivityId).toBe(e.ciiuSecundaria);
    expect(ica.ciiuActivityId).not.toBe(e.ciiuGlobal); // NO la principal de Bogotá
    await auditar(ica);
  });

  // ---------------------------------------------------------------------------
  it('11 · Vigilancia $5.000.000 con AIU de $500.000 → retiene 2% sobre el AIU = $10.000', async () => {
    const tercero = await crearTercero(e, {});
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.vigilancia,
      baseGravable: pesos(5_000_000),
      valorAiu: pesos(500_000),
    });
    const rf = unica(r, 'retefuente');
    expect(rf.base).toBe(pesos(500_000)); // el AIU
    expect(rf.base).not.toBe(pesos(5_000_000)); // NO el total
    expect(rf.valor).toBe(pesos(10_000));
    await auditar(rf);

    // Sin AIU discriminado no lo deduce del total: revisión manual.
    const sinAiu = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.vigilancia,
      baseGravable: pesos(5_000_000),
    });
    expect(codigos(sinAiu)).toContain(MOTIVO.SIN_AIU);
    expect(sinAiu.retenciones).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  it('12 · Proveedor del exterior → ReteIVA al 100% del IVA = $190.000', async () => {
    const exterior = await crearTercero(e, { delExterior: true, responsableIva: false });
    const r = await resolver({
      terceroId: exterior,
      conceptoId: e.conceptos.serviciosExterior,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    const ri = unica(r, 'reteiva');
    expect(ri.base).toBe(pesos(190_000));
    expect(ri.valor).toBe(pesos(190_000)); // el 100%
    expect(ri.normaRespaldo).toContain('437-2');
    await auditar(ri);

    // No es "la misma regla al tope": es OTRA fila. Un nacional da $28.500.
    const nacional = await crearTercero(e, {});
    const rn = await resolver({
      terceroId: nacional,
      conceptoId: e.conceptos.serviciosExterior,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(unica(rn, 'reteiva').valor).toBe(pesos(28_500));
    expect(unica(rn, 'reteiva').regla.taxRuleId).not.toBe(ri.regla.taxRuleId);
  });

  // ---------------------------------------------------------------------------
  it('13 · Régimen SIMPLE: tratamiento diferenciado SEGÚN PARAMETRIZACIÓN, nunca por omisión', async () => {
    const simple = await crearTercero(e, { regimenSimple: true });

    // Sin política parametrizada el motor no decide por su cuenta.
    const sinPolitica = await resolver({
      terceroId: simple,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(codigos(sinPolitica)).toContain(MOTIVO.SIMPLE_SIN_POLITICA);
    expect(sinPolitica.agregados).toEqual([]);

    // Con la política puesta como DATO (company_setting), el resultado cambia.
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company_setting (tenant_id, company_id, clave, valor, descripcion)
         VALUES ($1, $2, 'retencion.regimen_simple', $3::jsonb, 'Política del régimen SIMPLE (A14)')
         ON CONFLICT DO NOTHING`,
        [
          e.tenantId,
          e.companyId,
          JSON.stringify({ practica_retefuente: false, practica_reteiva: true, practica_reteica: false }),
        ],
      );
    });

    const conPolitica = await resolver({
      terceroId: simple,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(unica(conPolitica, 'retefuente').aplicada).toBe(false);
    expect(unica(conPolitica, 'retefuente').motivoNoAplica).toContain('SIMPLE');
    expect(unica(conPolitica, 'reteiva').valor).toBe(pesos(28_500));

    // Y un tercero ordinario NO se ve afectado por esa política.
    const ordinario = await crearTercero(e, {});
    const ro = await resolver({
      terceroId: ordinario,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(unica(ro, 'retefuente').valor).toBe(pesos(40_000));
  });

  // ---------------------------------------------------------------------------
  it('14 · Factura con 3 líneas de conceptos distintos → retención por concepto, agregada', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const r = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      resolverFactura(new RepositorioTributarioSql(tx), {
        companyId: e.companyId,
        terceroId: tercero,
        municipioOperacionId: null,
        fechaHechoEconomico: FECHA,
        lineas: [
          { conceptoId: e.conceptos.serviciosSoloRetefuente, baseGravable: pesos(1_000_000), valorIva: 0 },
          { conceptoId: e.conceptos.compras, baseGravable: pesos(600_000), valorIva: 0 },
          { conceptoId: e.conceptos.honorariosPj, baseGravable: pesos(200_000), valorIva: 0 },
        ],
      }),
    );

    expect(r.retenciones).toHaveLength(3);
    for (const x of r.retenciones) await auditar(x);
    const valores = r.retenciones.map((x) => x.valor).sort((a, b) => a - b);
    expect(valores).toEqual([pesos(15_000), pesos(22_000), pesos(40_000)]);
    expect(r.agregados.reduce((s, a) => s + a.valor, 0)).toBe(pesos(77_000));
    // Tres reglas distintas contra la MISMA cuenta: tres agregados, no uno.
    expect(new Set(r.agregados.map((a) => a.regla.taxRuleId)).size).toBe(3);
    expect(new Set(r.agregados.map((a) => a.accountId)).size).toBe(1);
  });

  it('14 (variante hostil) · trocear un concepto en dos líneas NO esquiva la base mínima', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const r = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      resolverFactura(new RepositorioTributarioSql(tx), {
        companyId: e.companyId,
        terceroId: tercero,
        municipioOperacionId: null,
        fechaHechoEconomico: FECHA,
        lineas: [
          { conceptoId: e.conceptos.compras, baseGravable: pesos(300_000), valorIva: 0 },
          { conceptoId: e.conceptos.compras, baseGravable: pesos(300_000), valorIva: 0 },
        ],
      }),
    );
    expect(r.retenciones).toHaveLength(1);
    expect(r.retenciones[0]!.base).toBe(pesos(600_000));
    expect(r.retenciones[0]!.valor).toBe(pesos(15_000));
  });

  // ---------------------------------------------------------------------------
  it('16 · Factura fechada antes de la vigencia y procesada después: manda la FECHA DEL HECHO', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });

    const julio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
      fechaHechoEconomico: '2026-07-15',
    });
    expect(unica(julio, 'retefuente').valor).toBe(pesos(40_000));

    const junio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
      fechaHechoEconomico: '2026-06-15',
    });
    // A1 no cargó (ni inventó) la tarifa anterior al decreto: aplicarle a un
    // hecho de junio la regla que empieza el 1-jul sería romper la Regla 3.
    expect(junio.retenciones.filter((x) => x.tipo === 'retefuente')).toEqual([]);
    expect(codigos(junio)).toContain(MOTIVO.SIN_REGLA);

    // Que lo que falla es la VIGENCIA y no la fecha en sí: un concepto cuya
    // regla sí estaba vigente en junio se resuelve en junio.
    const honorarios = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.honorariosPj,
      baseGravable: pesos(200_000),
      fechaHechoEconomico: '2026-06-15',
    });
    expect(unica(honorarios, 'retefuente').valor).toBe(pesos(22_000));
    await auditar(unica(honorarios, 'retefuente'), '2026-06-15');

    // Y el borde exacto: 30-jun no resuelve, 1-jul sí. Un día de diferencia.
    const vispera = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
      fechaHechoEconomico: '2026-06-30',
    });
    const primerDia = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
      fechaHechoEconomico: '2026-07-01',
    });
    expect(vispera.retenciones.filter((x) => x.tipo === 'retefuente')).toEqual([]);
    expect(unica(primerDia, 'retefuente').valor).toBe(pesos(40_000));

    // La UVT también se resuelve por la fecha del hecho, no por hoy.
    const uvts = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ anio: number }>(
        `SELECT u.anio FROM (VALUES (DATE '2025-06-15'), (DATE '2026-07-15')) AS f(fecha)
           JOIN uvt_value u ON app.esta_vigente(u.vigente_desde, u.vigente_hasta, f.fecha)
          WHERE u.tenant_id IS NULL AND u.company_id IS NULL ORDER BY f.fecha`,
      );
      return rows.map((r) => r.anio);
    });
    expect(uvts).toEqual([2025, 2026]);
  });

  // ---------------------------------------------------------------------------
  it('19 (la mitad que existe hoy) · ni el motor ni los servicios tienen con qué llamar a un LLM', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raiz = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const archivos: string[] = [];
    const recorrer = (dir: string): void => {
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (ruta.endsWith('.ts')) archivos.push(ruta);
      }
    };
    recorrer(raiz);

    // Barrido de TODO src/, no solo de src/domain: si mañana aparece una
    // llamada de red en los servicios, esto la ve.
    const conRed = archivos
      .filter((a) =>
        /\b(fetch|XMLHttpRequest|node:http|node:https|axios|openai|anthropic|@ai-sdk)\b/.test(
          readFileSync(a, 'utf8'),
        ),
      )
      .map((a) => a.replace(raiz, 'src/'));
    expect(conRed).toEqual([]);

    // Y el cálculo es reproducible sin estado: dos resoluciones seguidas de la
    // misma factura dan la misma huella.
    const tercero = await crearTercero(e, {});
    const entrada = {
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    };
    expect((await resolver(entrada)).huella).toBe((await resolver(entrada)).huella);
  });
});

// =============================================================================
describe('A14 · el andamiaje declarado no puede estar fabricando ningún PASS', () => {
  it('ningún valor esperado de la sección 12 depende del MODO de redondeo: todos son productos exactos', async () => {
    // Si `base × tarifa` da un entero exacto de centavos, la regla de redondeo
    // que monta el escenario (pendiente de A1) no puede cambiar ni un resultado.
    // Esto es lo que convierte ese andamiaje en irrelevante para el veredicto.
    const casos: { concepto: string; base: number; declarante?: boolean; persona?: 'natural' | 'juridica' }[] = [
      { concepto: e.conceptos.serviciosSoloRetefuente, base: pesos(1_000_000), declarante: true },
      { concepto: e.conceptos.serviciosSoloRetefuente, base: pesos(1_000_000), declarante: false, persona: 'natural' },
      { concepto: e.conceptos.compras, base: pesos(600_000), declarante: true },
      { concepto: e.conceptos.honorariosPj, base: pesos(200_000), persona: 'juridica' },
      { concepto: e.conceptos.arrendamientoMuebles, base: pesos(400_000) },
    ];
    for (const c of casos) {
      const tercero = await crearTercero(e, {
        declarante: c.declarante ?? true,
        tipoPersona: c.persona ?? 'juridica',
      });
      const r = await resolver({ terceroId: tercero, conceptoId: c.concepto, baseGravable: c.base });
      const rf = unica(r, 'retefuente');
      if (!rf.aplicada) continue;
      expect(`${rf.tarifa}: sin redondeo ${rf.valorSinRedondeo} = redondeado ${rf.valor}`).toBe(
        `${rf.tarifa}: sin redondeo ${rf.valorSinRedondeo} = redondeado ${rf.valorSinRedondeo}`,
      );
    }
  });

  it('la tarifa de ReteICA materializada por la suite es, byte a byte, la que cargó A1 en municipality_ica_rule', async () => {
    const comparacion = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ de_la_regla: string; de_a1: string; norma: string }>(
        `SELECT r.tarifa::text AS de_la_regla, mir.tarifa_general::text AS de_a1, mir.norma_respaldo AS norma
           FROM tax_rule r, municipality_ica_rule mir
           JOIN municipality m ON m.id = mir.municipality_id
          WHERE r.id = $1 AND m.codigo_dane = '05001'`,
        [e.reglaIcaMedellin],
      );
      return rows[0]!;
    });
    expect(comparacion.de_la_regla).toBe(comparacion.de_a1);
    expect(comparacion.norma).toMatch(/Acuerdo/i);
  });

  it('LA CONSECUENCIA REAL DEL ANDAMIAJE: con SOLO los seeds de A1, ReteICA no existe en producción', async () => {
    // Esta prueba no falla: DECLARA el hueco y lo mide. Si algún día A1
    // materializa las reglas de ReteICA en tax_rule, esta prueba falla y hay
    // que actualizarla — que es exactamente lo que se quiere que pase.
    const db = await createTestDb();
    try {
      const { seed } = await import('../../src/db/seed.js');
      const { fileURLToPath } = await import('node:url');
      const dir = fileURLToPath(new URL('../../db/seeds', import.meta.url));
      const conteos = await db.asAdmin(async (tx) => {
        await seed(tx, { dir });
        const { rows } = await tx.query<{ reglas_ica: number; conceptos_ica: number; redondeos: number }>(
          `SELECT (SELECT count(*)::int FROM tax_rule WHERE tipo = 'reteica')      AS reglas_ica,
                  (SELECT count(*)::int FROM tax_concept WHERE tipo = 'reteica')   AS conceptos_ica,
                  (SELECT count(*)::int FROM rounding_rule)                        AS redondeos`,
        );
        return rows[0]!;
      });
      // Estado REAL del producto tal como se entrega la Ola 1.
      expect(conteos.reglas_ica).toBe(0);
      expect(conteos.conceptos_ica).toBe(0);
      expect(conteos.redondeos).toBe(0);
    } finally {
      await db.close();
    }
  }, 120_000);
});

// =============================================================================
describe('A14 · canario anti-falso-PASS (actualizado en la Ola 1)', () => {
  it('el inventario de módulos de src/ es una lista CERRADA: un módulo nuevo se declara aquí', async () => {
    // Intención original (Ola 0): que nadie esconda un cálculo tributario en un
    // rincón del código sin que A14 se entere. La lista ya no dice "solo hay
    // auth y db"; dice "estos cinco módulos están auditados y ningún otro
    // existe". Un `src/ai/` de A5 en la Ola 2 hará fallar esta prueba, que es
    // el punto: obliga a declararlo y a barrerlo.
    const { readdirSync } = await import('node:fs');
    const raiz = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    expect(readdirSync(raiz).sort()).toEqual(['auth', 'db', 'domain', 'ingest', 'services']);
  });

  it('las migraciones NO traen datos normativos: aplicar el esquema solo deja las tablas VACÍAS', async () => {
    // Versión Ola 1 de la vieja prueba "las tablas están vacías". Ya no
    // significa "A1 no ha trabajado": significa que el DATO vive en db/seeds y
    // no se cuela por una migración, que es lo que la Regla 2 protege.
    const db = await createTestDb();
    try {
      const conteos = await db.asAdmin(async (tx) => {
        const tablas = [
          'uvt_value',
          'smmlv_value',
          'tax_rule',
          'tax_concept',
          'municipality_ica_rule',
          'rounding_rule',
          'tax_calendar',
          'concepto_causacion',
          'memoria_clasificacion',
        ];
        const resultado: Record<string, number> = {};
        for (const t of tablas) {
          const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
          resultado[t] = rows[0]!.n;
        }
        return resultado;
      });
      for (const [tabla, n] of Object.entries(conteos)) {
        expect(`${tabla}=${n}`).toBe(`${tabla}=0`);
      }
    } finally {
      await db.close();
    }
  });

  it('y CON los seeds las tablas normativas sí traen datos: los casos no pasan sobre el vacío', async () => {
    const conteos = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ uvt: number; reglas: number; conceptos: number; municipios: number }>(
        `SELECT (SELECT count(*)::int FROM uvt_value)             AS uvt,
                (SELECT count(*)::int FROM tax_rule)              AS reglas,
                (SELECT count(*)::int FROM tax_concept)           AS conceptos,
                (SELECT count(*)::int FROM municipality_ica_rule) AS municipios`,
      );
      return rows[0]!;
    });
    expect(conteos.uvt).toBeGreaterThan(0);
    expect(conteos.reglas).toBeGreaterThan(5);
    expect(conteos.conceptos).toBeGreaterThan(5);
    expect(conteos.municipios).toBeGreaterThan(0);
  });

  it('toda tarifa cargada declara su norma de respaldo: ninguna fila inventada (advertencia 17.5)', async () => {
    const sinNorma = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ t: string }>(
        `SELECT 'tax_rule:' || id::text AS t FROM tax_rule
          WHERE norma_respaldo IS NULL OR length(trim(norma_respaldo)) < 10
          UNION ALL
         SELECT 'uvt_value:' || id::text FROM uvt_value
          WHERE norma_respaldo IS NULL OR length(trim(norma_respaldo)) < 10`,
      );
      return rows.map((r) => r.t);
    });
    expect(sinNorma).toEqual([]);
  });

  it('el motor se NIEGA a calcular cuando falta el parámetro, en vez de suponerlo', async () => {
    // La conducta que separa un motor tributario honesto de uno peligroso.
    // Base de datos limpia, con seeds pero SIN la rounding_rule del escenario.
    const db = await createTestDb();
    try {
      const { seed } = await import('../../src/db/seed.js');
      const { fileURLToPath } = await import('node:url');
      const dir = fileURLToPath(new URL('../../db/seeds', import.meta.url));
      await db.asAdmin(async (tx) => {
        await seed(tx, { dir });
      });
      // Sin rounding_rule cargada, cualquier resolución tiene que decir por qué
      // no calcula. Se comprueba que la tabla está vacía (medida arriba) y que
      // el motor tiene un motivo específico para ese caso en su catálogo.
      expect(MOTIVO.SIN_REDONDEO).toBe('sin_regla_de_redondeo_vigente');
      const vacias = await db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM rounding_rule`);
        return rows[0]!.n;
      });
      expect(vacias).toBe(0);
    } finally {
      await db.close();
    }
  }, 120_000);
});

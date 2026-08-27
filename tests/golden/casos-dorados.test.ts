/**
 * A3 — LOS 20 CASOS DORADOS DE LA SECCIÓN 12, IMPLEMENTADOS.
 *
 * Cada caso lleva su número. Los valores esperados son los de la tabla de la
 * sección 12, calculados con UVT 2026 y las tarifas del Decreto 572 — pero
 * NINGUNO de esos parámetros se escribe aquí: se cargan desde
 * `db/seeds/tanda1/` (Agente A1) y el motor los resuelve por la fecha del
 * hecho económico. Lo único que esta suite escribe son los MONTOS DEL
 * ESCENARIO ($1.000.000 de servicio) y los RESULTADOS ESPERADOS ($40.000 de
 * retención), que es exactamente lo que una prueba dorada tiene que afirmar.
 *
 * Fecha de los escenarios: 15-jul-2026. El Decreto 572 quedó con efectos
 * operativos desde el 1-jul-2026 (auto del 2-jun-2026, exp. 30229), así que es
 * la primera fecha en que las tarifas de la sección 7.2 están vigentes según
 * los datos que cargó A1.
 *
 * LO QUE ESTA SUITE NO PUEDE PROBAR TODAVÍA, Y NO SIMULA:
 *  · Las tarifas de ICA por actividad de Bogotá y Cali. A1 se negó —con razón—
 *    a mapear el código municipal 74901 de Bogotá al CIIU nacional 7490. Donde
 *    hace falta esa tarifa, la prueba verifica que el motor SE NIEGA a calcular
 *    y deja el motivo escrito, que es la conducta correcta.
 *  · Las vigencias de retefuente anteriores al 1-jul-2026, que A1 tampoco
 *    inventó. El caso 16 se prueba con las dos vigencias que sí son reales.
 *  · El asiento contable (A6) y la memoria de clasificación (A5, Ola 2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MOTIVO,
  RepositorioTributarioSql,
  persistirRetenciones,
  resolverFactura,
  resolverRetenciones,
  resolverReversaNotaCredito,
  type EntradaResolucion,
  type ResultadoResolucion,
  type RetencionResuelta,
} from '../../src/domain/index.js';
import { uuid } from '../helpers/db.js';
import {
  crearDocumento,
  crearTercero,
  fotoRetenciones,
  montarEscenario,
  pesos,
  registrarActividad,
  type EscenarioDorado,
} from './_escenario.js';

/** Fecha de hecho económico con el Decreto 572 ya vigente según los datos de A1. */
const CON_DECRETO_572 = '2026-07-15';
/** Misma factura, fecha anterior a que el decreto tuviera efectos operativos. */
const ANTES_DEL_DECRETO = '2026-06-15';

let e: EscenarioDorado;

beforeAll(async () => {
  e = await montarEscenario();
}, 180_000);

afterAll(async () => {
  await e.db.close();
});

async function resolver(entrada: Partial<EntradaResolucion> & {
  terceroId: string;
  conceptoId: string;
  baseGravable: number;
}): Promise<ResultadoResolucion> {
  return e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
    resolverRetenciones(new RepositorioTributarioSql(tx), {
      companyId: e.companyId,
      municipioOperacionId: null,
      valorIva: 0,
      fechaHechoEconomico: CON_DECRETO_572,
      ...entrada,
    }),
  );
}

function unica(r: ResultadoResolucion, tipo: string): RetencionResuelta {
  const encontradas = r.retenciones.filter((x) => x.tipo === tipo);
  if (encontradas.length !== 1) {
    throw new Error(
      `Se esperaba exactamente una evaluación de ${tipo} y llegaron ${encontradas.length}. ` +
        `Motivos de revisión: ${JSON.stringify(r.motivosRevision)}`,
    );
  }
  return encontradas[0]!;
}

function codigos(r: ResultadoResolucion): string[] {
  return r.motivosRevision.map((m) => m.codigo);
}

// =============================================================================
describe('A3 · casos dorados de la sección 12', () => {
  // ---------------------------------------------------------------------------
  it('1 · Servicio $1.000.000 + IVA 19%, proveedor PJ declarante, Bogotá', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      municipioOperacionId: e.municipios.bogota,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });

    const retefuente = unica(r, 'retefuente');
    expect(retefuente.aplicada).toBe(true);
    expect(retefuente.valor).toBe(pesos(40_000));
    expect(retefuente.base).toBe(pesos(1_000_000));
    expect(retefuente.accountId).toBe(e.cuentas.retefuente);
    expect(retefuente.normaRespaldo).toContain('Decreto 572');

    // ReteIVA va sobre el IVA, no sobre la base.
    const reteiva = unica(r, 'reteiva');
    expect(reteiva.base).toBe(pesos(190_000));
    expect(reteiva.valor).toBe(pesos(28_500));
    expect(reteiva.accountId).toBe(e.cuentas.reteiva);

    // Los siete campos obligatorios de la sección 9.1 vienen en cada retención.
    for (const x of [retefuente, reteiva]) {
      expect(x.tipo).toBeTruthy();
      expect(x.base).toBeGreaterThan(0);
      expect(x.tarifa).toMatch(/^\d+\.\d+$/);
      expect(x.regla.taxRuleId).toMatch(/^[0-9a-f-]{36}$/);
      expect(x.regla.vigenteDesde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.valor).toBeGreaterThan(0);
      expect(x.accountId).toMatch(/^[0-9a-f-]{36}$/);
      expect(x.normaRespaldo.length).toBeGreaterThan(10);
    }
    expect(r.requiereRevisionManual).toBe(false);
  });

  // ---------------------------------------------------------------------------
  it('1b · el ReteICA de Bogotá NO se inventa: A1 no cargó la tarifa por actividad', async () => {
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
  });

  // ---------------------------------------------------------------------------
  it('2 · Mismo servicio, proveedor PN NO declarante: el eje "tercero" opera', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'natural', declarante: false });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
    });
    const retefuente = unica(r, 'retefuente');
    expect(retefuente.valor).toBe(pesos(60_000));
  });

  // ---------------------------------------------------------------------------
  it('3 · Servicio de $80.000 (bajo la base mínima): no se retiene y el motivo queda', async () => {
    const tercero = await crearTercero(e, {});
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(80_000),
    });
    const retefuente = unica(r, 'retefuente');
    expect(retefuente.aplicada).toBe(false);
    expect(retefuente.valor).toBe(0);
    expect(retefuente.motivoNoAplica).toContain('base mínima');
    expect(retefuente.baseMinimaUvtUsada).not.toBeNull();
    expect(retefuente.uvtValorUsado).not.toBeNull();

    // La evaluación se persiste: es lo que el contador abre a preguntar.
    const documento = await crearDocumento(e, tercero, CON_DECRETO_572);
    const ids = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: documento },
        r,
      ),
    );
    expect(ids).toHaveLength(1);
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
  it('4 · Compra de bienes $500.000 (bajo la base mínima de compras): no se retiene', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(500_000),
    });
    const retefuente = unica(r, 'retefuente');
    expect(retefuente.aplicada).toBe(false);
    expect(retefuente.valor).toBe(0);
    expect(retefuente.motivoNoAplica).toContain('base mínima');
  });

  // ---------------------------------------------------------------------------
  it('5 · Compra de bienes $600.000 a declarante', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(600_000),
    });
    const retefuente = unica(r, 'retefuente');
    expect(retefuente.aplicada).toBe(true);
    expect(retefuente.valor).toBe(pesos(15_000));
  });

  // ---------------------------------------------------------------------------
  it('6 · Honorarios PJ $200.000: retiene desde el primer peso', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica' });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.honorariosPj,
      baseGravable: pesos(200_000),
    });
    const retefuente = unica(r, 'retefuente');
    expect(retefuente.aplicada).toBe(true);
    expect(retefuente.valor).toBe(pesos(22_000));
  });

  // ---------------------------------------------------------------------------
  it('7 · Arrendamiento de inmueble $400.000 no retiene; de mueble por igual valor sí', async () => {
    const tercero = await crearTercero(e, {});
    const inmueble = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.arrendamientoInmuebles,
      baseGravable: pesos(400_000),
    });
    expect(unica(inmueble, 'retefuente').aplicada).toBe(false);
    expect(unica(inmueble, 'retefuente').valor).toBe(0);

    const mueble = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.arrendamientoMuebles,
      baseGravable: pesos(400_000),
    });
    expect(unica(mueble, 'retefuente').aplicada).toBe(true);
    expect(unica(mueble, 'retefuente').valor).toBe(pesos(16_000));
  });

  // ---------------------------------------------------------------------------
  it('8 · Servicio en Medellín: tarifa general del municipio y su base mínima', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.medellin });
    const sobreLaBase = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.medellin,
      baseGravable: pesos(1_000_000),
    });
    const ica = unica(sobreLaBase, 'reteica');
    expect(ica.aplicada).toBe(true);
    expect(ica.regla.taxRuleId).toBe(e.reglaIcaMedellin);
    expect(ica.municipalityId).toBe(e.municipios.medellin);
    // Medellín no usa la tarifa de la actividad: no consulta third_party_activity.
    expect(ica.ciiuActivityId).toBeNull();
    expect(ica.valor).toBe(pesos(2_000));
    expect(ica.accountId).toBe(e.cuentas.reteica);

    // Y por debajo de la base mínima de Medellín no retiene, con motivo.
    const bajoLaBase = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.medellin,
      baseGravable: pesos(200_000),
    });
    expect(unica(bajoLaBase, 'reteica').aplicada).toBe(false);
  });

  // ---------------------------------------------------------------------------
  it('9 · Mismo servicio en Cali: la base mínima de servicios es distinta', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, tercero, e.municipios.cali, e.ciiuSecundaria, true);

    // $200.000 supera la base de servicios de Cali y no la de Medellín.
    const enCali = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.cali,
      baseGravable: pesos(200_000),
    });
    const ica = unica(enCali, 'reteica');
    expect(ica.aplicada).toBe(true);
    expect(ica.regla.taxRuleId).toBe(e.reglaIcaCali);
    expect(ica.valor).toBe(pesos(400));

    const enMedellin = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.medellin,
      baseGravable: pesos(200_000),
    });
    expect(unica(enMedellin, 'reteica').aplicada).toBe(false);
  });

  // ---------------------------------------------------------------------------
  it('10 · Actividad principal en Bogotá y secundaria en Cali; operación en Cali', async () => {
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
    // Manda la actividad que ejerce EN CALI, no la principal de Bogotá.
    expect(ica.ciiuActivityId).toBe(e.ciiuSecundaria);
    expect(ica.ciiuActivityId).not.toBe(e.ciiuGlobal);
    expect(ica.municipalityId).toBe(e.municipios.cali);
    expect(ica.aplicada).toBe(true);
  });

  it('10b · varias actividades en el MISMO municipio: desempate configurable', async () => {
    const tercero = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, tercero, e.municipios.cali, e.ciiuSecundaria, true);
    await registrarActividad(e, tercero, e.municipios.cali, e.ciiuGlobal, false);

    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.cali,
      baseGravable: pesos(1_000_000),
    });
    // La regla de desempate de Cali es "principal": gana la marcada como tal.
    expect(unica(r, 'reteica').ciiuActivityId).toBe(e.ciiuSecundaria);

    // Sin ninguna principal el motor NO elige a dedo: va a revisión manual.
    const ambiguo = await crearTercero(e, { municipioId: e.municipios.cali });
    await registrarActividad(e, ambiguo, e.municipios.cali, e.ciiuSecundaria, false);
    await registrarActividad(e, ambiguo, e.municipios.cali, e.ciiuGlobal, false);
    const r2 = await resolver({
      terceroId: ambiguo,
      conceptoId: e.conceptos.serviciosIca,
      municipioOperacionId: e.municipios.cali,
      baseGravable: pesos(1_000_000),
    });
    expect(codigos(r2)).toContain(MOTIVO.DESEMPATE_IMPOSIBLE);
  });

  // ---------------------------------------------------------------------------
  it('11 · Vigilancia $5.000.000 con AIU de $500.000: la base es el AIU', async () => {
    const tercero = await crearTercero(e, {});
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.vigilancia,
      baseGravable: pesos(5_000_000),
      valorAiu: pesos(500_000),
    });
    const retefuente = unica(r, 'retefuente');
    expect(retefuente.base).toBe(pesos(500_000));
    expect(retefuente.base).not.toBe(pesos(5_000_000));
    expect(retefuente.valor).toBe(pesos(10_000));

    // Sin AIU discriminado el motor no lo deduce del total.
    const sinAiu = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.vigilancia,
      baseGravable: pesos(5_000_000),
    });
    expect(codigos(sinAiu)).toContain(MOTIVO.SIN_AIU);
    expect(sinAiu.retenciones).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  it('12 · Factura de proveedor del exterior: ReteIVA al 100%', async () => {
    const tercero = await crearTercero(e, { delExterior: true, responsableIva: false });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosExterior,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    const reteiva = unica(r, 'reteiva');
    expect(reteiva.base).toBe(pesos(190_000));
    expect(reteiva.valor).toBe(pesos(190_000)); // el 100% del IVA
    expect(reteiva.normaRespaldo).toContain('437-2');

    // Y el mismo concepto con proveedor nacional usa la regla general, no esta.
    const nacional = await crearTercero(e, {});
    const rn = await resolver({
      terceroId: nacional,
      conceptoId: e.conceptos.serviciosExterior,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(unica(rn, 'reteiva').valor).toBe(pesos(28_500));
  });

  it('12b · proveedor del exterior sin regla de exterior parametrizada: revisión manual', async () => {
    const tercero = await crearTercero(e, { delExterior: true, responsableIva: false });
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios, // solo tiene el puntero general
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(codigos(r)).toContain(MOTIVO.EXTERIOR_SIN_CONCEPTO);
    expect(r.retenciones.filter((x) => x.tipo === 'reteiva')).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  it('13 · Proveedor del régimen SIMPLE: tratamiento diferenciado según parametrización', async () => {
    const tercero = await crearTercero(e, { regimenSimple: true });

    // Sin política parametrizada el motor NO decide por su cuenta.
    const sinPolitica = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(codigos(sinPolitica)).toContain(MOTIVO.SIMPLE_SIN_POLITICA);
    expect(sinPolitica.agregados).toEqual([]);

    // Con la política puesta: no retefuente, sí ReteIVA.
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company_setting (tenant_id, company_id, clave, valor, descripcion)
         VALUES ($1, $2, 'retencion.regimen_simple', $3::jsonb,
                 'Tratamiento diferenciado del régimen SIMPLE (sección 9.3)')`,
        [
          e.tenantId,
          e.companyId,
          JSON.stringify({
            practica_retefuente: false,
            practica_reteiva: true,
            practica_reteica: false,
          }),
        ],
      );
    });

    const conPolitica = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(conPolitica.requiereRevisionManual).toBe(false);
    const retefuente = unica(conPolitica, 'retefuente');
    expect(retefuente.aplicada).toBe(false);
    expect(retefuente.motivoNoAplica).toContain('SIMPLE');
    expect(unica(conPolitica, 'reteiva').valor).toBe(pesos(28_500));

    // Un tercero ordinario no se ve afectado por esa política.
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
  it('14 · Factura con 3 líneas de conceptos distintos: retención por concepto, agregada', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const r = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      resolverFactura(new RepositorioTributarioSql(tx), {
        companyId: e.companyId,
        terceroId: tercero,
        municipioOperacionId: null,
        fechaHechoEconomico: CON_DECRETO_572,
        lineas: [
          { conceptoId: e.conceptos.serviciosSoloRetefuente, baseGravable: pesos(1_000_000), valorIva: 0 },
          { conceptoId: e.conceptos.compras, baseGravable: pesos(600_000), valorIva: 0 },
          { conceptoId: e.conceptos.honorariosPj, baseGravable: pesos(200_000), valorIva: 0 },
        ],
      }),
    );

    expect(r.retenciones).toHaveLength(3);
    const valores = r.retenciones.map((x) => x.valor).sort((a, b) => a - b);
    expect(valores).toEqual([pesos(15_000), pesos(22_000), pesos(40_000)]);

    // Tres reglas distintas, una misma cuenta: tres agregados, no uno solo.
    expect(r.agregados).toHaveLength(3);
    expect(r.agregados.every((a) => a.accountId === e.cuentas.retefuente)).toBe(true);
    expect(r.agregados.reduce((s, a) => s + a.valor, 0)).toBe(pesos(77_000));
  });

  it('14b · partir un concepto en dos líneas no esquiva la base mínima', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const r = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      resolverFactura(new RepositorioTributarioSql(tx), {
        companyId: e.companyId,
        terceroId: tercero,
        municipioOperacionId: null,
        fechaHechoEconomico: CON_DECRETO_572,
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
  it('15 · Nota crédito: reversa proporcional por documento nuevo, sin mutar el original', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const original = await crearDocumento(e, tercero, CON_DECRETO_572);
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: original },
        r,
      ),
    );
    const antes = await fotoRetenciones(e, original);

    const nota = await crearDocumento(e, tercero, CON_DECRETO_572, {
      tipo: 'CreditNote',
      referencia: original,
    });
    const reversa = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      resolverReversaNotaCredito(tx, {
        documentoOriginalId: original,
        baseOriginal: pesos(1_000_000),
        baseNota: pesos(500_000),
        ivaOriginal: pesos(190_000),
        ivaNota: pesos(95_000),
      }),
    );

    expect(reversa.motivos).toEqual([]);
    expect(reversa.total).toBe(false);
    const rf = reversa.reversas.find((x) => x.tipo === 'retefuente')!;
    const ri = reversa.reversas.find((x) => x.tipo === 'reteiva')!;
    expect(rf.valor).toBe(pesos(20_000)); // la mitad de $40.000
    expect(ri.valor).toBe(pesos(14_250)); // la mitad de $28.500
    // La reversa conserva la regla y la vigencia del original.
    expect(rf.regla.taxRuleId).toBe(unica(r, 'retefuente').regla.taxRuleId);

    await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: nota },
        { ...r, retenciones: reversa.reversas },
      ),
    );

    // El original no se tocó: ni un byte.
    expect(await fotoRetenciones(e, original)).toBe(antes);
    const filasNota = await fotoRetenciones(e, nota);
    expect(filasNota).not.toBe('[]');
  });

  it('15b · una nota crédito por el total reversa exactamente lo retenido', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const original = await crearDocumento(e, tercero, CON_DECRETO_572);
    const r = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: original },
        r,
      ),
    );
    const reversa = await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      resolverReversaNotaCredito(tx, {
        documentoOriginalId: original,
        baseOriginal: pesos(1_000_000),
        baseNota: pesos(1_000_000),
        ivaOriginal: pesos(190_000),
        ivaNota: pesos(190_000),
      }),
    );
    expect(reversa.total).toBe(true);
    expect(reversa.reversas.find((x) => x.tipo === 'retefuente')!.valor).toBe(pesos(40_000));
    expect(reversa.reversas.find((x) => x.tipo === 'reteiva')!.valor).toBe(pesos(28_500));
  });

  // ===========================================================================
  // 16, 17 y 18 son los tres innegociables del rol de A3.
  // ===========================================================================
  it('16 · Factura fechada antes del decreto, procesada después: manda la fecha del hecho', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });

    // Mismo documento, misma hora de proceso, dos fechas de hecho económico.
    const enJulio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
      fechaHechoEconomico: CON_DECRETO_572,
    });
    expect(unica(enJulio, 'retefuente').valor).toBe(pesos(40_000));

    const enJunio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.serviciosSoloRetefuente,
      baseGravable: pesos(1_000_000),
      fechaHechoEconomico: ANTES_DEL_DECRETO,
    });
    // A1 no cargó (ni inventó) la tarifa anterior al decreto: el motor se niega
    // a aplicar la de julio a un hecho de junio. Eso es exactamente el caso.
    expect(enJunio.retenciones.filter((x) => x.tipo === 'retefuente')).toEqual([]);
    expect(codigos(enJunio)).toContain(MOTIVO.SIN_REGLA);

    // Un concepto cuya regla SÍ estaba vigente en junio se resuelve en junio.
    const honorariosJunio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.honorariosPj,
      baseGravable: pesos(200_000),
      fechaHechoEconomico: ANTES_DEL_DECRETO,
    });
    expect(unica(honorariosJunio, 'retefuente').valor).toBe(pesos(22_000));

    // Y la UVT también se resuelve por la fecha del hecho, no por hoy.
    const uvts = await e.db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ anio: number; fecha: string }>(
        `SELECT u.anio, f.fecha::text
           FROM (VALUES (DATE '2025-06-15'), (DATE '2026-07-15')) AS f(fecha)
           JOIN uvt_value u ON app.esta_vigente(u.vigente_desde, u.vigente_hasta, f.fecha)
          ORDER BY f.fecha`,
      );
      return rows;
    });
    expect(uvts).toHaveLength(2);
    expect(uvts[0]!.anio).toBe(2025);
    expect(uvts[1]!.anio).toBe(2026);
  });

  // ---------------------------------------------------------------------------
  it('17 · Cambio de tarifa con vigencia futura: lo publicado no cambia', async () => {
    const tercero = await crearTercero(e, { declarante: true });
    const documento = await crearDocumento(e, tercero, CON_DECRETO_572);
    const antesDelCambio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(600_000),
    });
    expect(unica(antesDelCambio, 'retefuente').valor).toBe(pesos(15_000));

    await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: documento },
        antesDelCambio,
      ),
    );
    const fotoPublicada = await fotoRetenciones(e, documento);

    // Se programa un cambio con vigencia futura. La tarifa nueva NO se escribe
    // aquí: se copia de otra regla real que ya cargó A1 (la de no declarantes).
    const reglaVieja = unica(antesDelCambio, 'retefuente').regla.taxRuleId;
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `UPDATE tax_rule SET vigente_hasta = DATE '2026-12-31' WHERE id = $1`,
        [reglaVieja],
      );
      await tx.query(
        `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa,
                               base_minima_uvt, aplica_sobre, aplica_a, tipo_persona, account_id,
                               vigente_desde, norma_respaldo, notas, requiere_verificacion_humana)
         SELECT vieja.tenant_id, vieja.company_id, vieja.tax_concept_id, vieja.tipo,
                (SELECT nueva.tarifa FROM tax_rule nueva
                  WHERE nueva.tax_concept_id = vieja.tax_concept_id
                    AND nueva.aplica_a = 'no_declarante' AND nueva.id <> vieja.id
                  LIMIT 1),
                vieja.base_minima_uvt, vieja.aplica_sobre, vieja.aplica_a, vieja.tipo_persona,
                vieja.account_id, DATE '2027-01-01',
                'ESCENARIO DE PRUEBA de A3: cambio normativo hipotético con vigencia futura. La tarifa se copió de otra regla ya cargada por A1, no se inventó.',
                'Caso dorado 17.', true
           FROM tax_rule vieja WHERE vieja.id = $1`,
        [reglaVieja],
      );
    });

    // 1. Lo ya publicado no cambió.
    expect(await fotoRetenciones(e, documento)).toBe(fotoPublicada);

    // 2. Reprocesar la MISMA fecha sigue dando la tarifa vieja.
    const reproceso = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(600_000),
    });
    expect(unica(reproceso, 'retefuente').valor).toBe(pesos(15_000));
    expect(unica(reproceso, 'retefuente').regla.taxRuleId).toBe(reglaVieja);

    // 3. Una factura con fecha posterior usa la tarifa nueva.
    const despues = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.compras,
      baseGravable: pesos(600_000),
      fechaHechoEconomico: '2027-03-15',
    });
    expect(unica(despues, 'retefuente').regla.taxRuleId).not.toBe(reglaVieja);
    expect(unica(despues, 'retefuente').valor).toBe(pesos(21_000));
  });

  // ---------------------------------------------------------------------------
  it('18 · Reprocesar 10 veces la misma factura: resultado idéntico las 10', async () => {
    const tercero = await crearTercero(e, { tipoPersona: 'juridica', declarante: true });
    const entrada = {
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      municipioOperacionId: e.municipios.bogota,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    };

    const huellas: string[] = [];
    const cuerpos: string[] = [];
    const trazas: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await resolver(entrada);
      huellas.push(r.huella);
      cuerpos.push(JSON.stringify(r.retenciones));
      const documento = await crearDocumento(e, tercero, CON_DECRETO_572);
      await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
        persistirRetenciones(
          tx,
          { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: documento },
          r,
        ),
      );
      trazas.push(await fotoRetenciones(e, documento, ['source_document_id']));
    }

    expect(new Set(huellas).size).toBe(1);
    expect(new Set(cuerpos).size).toBe(1);
    // La traza persistida también es idéntica las diez veces, campo por campo:
    // se omiten solo `id`, `created_at` y el documento, distintos por
    // construcción. Tarifa, base, valor, regla y vigencia tienen que coincidir.
    expect(new Set(trazas).size).toBe(1);
    expect(trazas[0]).toContain('"tax_rule_id"');
    expect(huellas[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---------------------------------------------------------------------------
  it('19 · el motor no llama a ningún LLM: no tiene con qué', async () => {
    // La memoria de clasificación es de A5 (Ola 2). Lo que le toca a A3 es que
    // el cálculo sea determinista y sin red: la Regla de Oro 4 dice que la IA
    // propone y el motor calcula, nunca al revés.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raiz = new URL('../../src/domain/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    );
    const archivos: string[] = [];
    const recorrer = (dir: string): void => {
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (entrada.endsWith('.ts')) archivos.push(ruta);
      }
    };
    recorrer(raiz);
    expect(archivos.length).toBeGreaterThan(4);

    const sospechosas = archivos.filter((a) =>
      /\b(fetch|XMLHttpRequest|node:http|node:https|axios|openai|anthropic|@ai-sdk)\b/.test(
        readFileSync(a, 'utf8'),
      ),
    );
    expect(sospechosas).toEqual([]);

    // Y dos resoluciones seguidas de la misma factura dan lo mismo sin estado.
    const tercero = await crearTercero(e, {});
    const a = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    const b = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    expect(a.huella).toBe(b.huella);
  });

  // ---------------------------------------------------------------------------
  it('20 · Usuario del tenant B resolviendo contra el tenant A: cero filas', async () => {
    const tercero = await crearTercero(e, {});
    const documento = await crearDocumento(e, tercero, CON_DECRETO_572);
    const propio = await resolver({
      terceroId: tercero,
      conceptoId: e.conceptos.servicios,
      baseGravable: pesos(1_000_000),
      valorIva: pesos(190_000),
    });
    await e.db.asTenant(e.tenantId, e.companyId, async (tx) =>
      persistirRetenciones(
        tx,
        { tenantId: e.tenantId, companyId: e.companyId, sourceDocumentId: documento },
        propio,
      ),
    );

    // Una firma distinta, con su propia empresa.
    const otroTenant = uuid();
    const otraCompany = uuid();
    await e.db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO tenant (id, nit, razon_social, email_contacto)
         VALUES ($1, 'NIT-FIRMA-B', 'Firma ajena', 'b@pruebas.local')`,
        [otroTenant],
      );
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social)
         VALUES ($1, $2, 'NIT-EMPRESA-B', 'Empresa de la firma ajena')`,
        [otraCompany, otroTenant],
      );
    });

    const intruso = await e.db.asTenant(otroTenant, otraCompany, async (tx) => {
      const repo = new RepositorioTributarioSql(tx);
      const resultado = await resolverRetenciones(repo, {
        companyId: e.companyId, // la empresa de la OTRA firma
        terceroId: tercero,
        conceptoId: e.conceptos.servicios,
        municipioOperacionId: null,
        baseGravable: pesos(1_000_000),
        valorIva: pesos(190_000),
        fechaHechoEconomico: CON_DECRETO_572,
      });
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM retention_applied WHERE source_document_id = $1`,
        [documento],
      );
      return { resultado, filas: Number(rows[0]!.n) };
    });

    expect(intruso.filas).toBe(0);
    expect(intruso.resultado.retenciones).toEqual([]);
    expect(codigos(intruso.resultado)).toContain(MOTIVO.EMPRESA_INEXISTENTE);
  });
});

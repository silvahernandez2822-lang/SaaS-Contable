/**
 * A10 — Pruebas sin base de datos: la estructura de notas y la aritmética del
 * armado de los estados.
 *
 * La parte importante de este archivo no es la aritmética: es la primera
 * sección. Verifica, como si fuera una compuerta, que el producto NO redacte
 * revelaciones. Es la advertencia 17.5 llevada al dominio de A10 — una nota
 * inventada es peor que una nota vacía, porque la vacía se ve y la inventada
 * no—, y se defiende con una aserción, no con un comentario.
 */
import { describe, expect, it } from 'vitest';
import {
  ESTRUCTURA_NOTAS,
  notasAutomaticas,
  notasQueRequierenIntervencionHumana,
  seccionesEnJuego,
} from '../../src/reports/estados/notas';
import {
  armarDesgloseNaturaleza,
  armarEstadoFlujosEfectivo,
  armarEstadoResultadoIntegral,
  armarEstadoSituacionFinanciera,
} from '../../src/reports/estados/armado';
import type { PartidaFlujo, SaldoCuenta } from '../../src/reports/estados/tipos';

function cuenta(parcial: Partial<SaldoCuenta> & Pick<SaldoCuenta, 'cuentaCodigo'>): SaldoCuenta {
  return {
    accountId: `acc-${parcial.cuentaCodigo}`,
    cuentaNombre: `Cuenta ${parcial.cuentaCodigo}`,
    cuentaNaturaleza: 'debito',
    clasificacionNiif: null,
    seccionNiif: null,
    rubro: `Rubro ${parcial.cuentaCodigo}`,
    grupoCodigo: parcial.cuentaCodigo.slice(0, 2),
    grupoNombre: `Grupo ${parcial.cuentaCodigo.slice(0, 2)}`,
    resolucionNiif: 'directa',
    origenCodigo: parcial.cuentaCodigo,
    vigenteDesde: '2020-01-01',
    vigenteHasta: null,
    normaRespaldo: 'Norma de prueba',
    requiereVerificacionHumana: false,
    saldoFinal: '0',
    saldoInicial: '0',
    debitos: '0',
    creditos: '0',
    ...parcial,
  };
}

// =============================================================================
describe('A10 · el sistema NO redacta revelaciones (advertencia 17.5 aplicada a las notas)', () => {
  it('ninguna nota trae texto de revelación redactado: solo la exigencia y qué falta', () => {
    for (const nota of ESTRUCTURA_NOTAS) {
      // El tipo no tiene un campo `texto`/`redaccion`: la nota es un ÍNDICE,
      // no un contenido. Se comprueba sobre el objeto real, no sobre el tipo.
      expect(Object.keys(nota).sort()).toEqual([
        'aportaElSistema',
        'completaElContador',
        'exigencia',
        'origen',
        'referencia',
        'titulo',
        'codigo',
      ].sort());
    }
  });

  it('toda nota que no es automática dice EXPLÍCITAMENTE qué debe escribir el contador', () => {
    const manuales = notasQueRequierenIntervencionHumana();
    expect(manuales.length).toBeGreaterThan(0);
    for (const nota of manuales) {
      expect(nota.completaElContador.trim().length).toBeGreaterThan(30);
      expect(nota.referencia.trim()).not.toBe('');
    }
  });

  it('las cuatro revelaciones que un sistema contable no puede producir salen marcadas como manuales', () => {
    // Bases de preparación y declaración de cumplimiento, políticas contables,
    // juicios (8.6) y fuentes de incertidumbre en las estimaciones (8.7).
    const manuales = notasQueRequierenIntervencionHumana().map((n) => n.codigo);
    for (const codigo of ['N2', 'N3', 'N4', 'N5']) expect(manuales).toContain(codigo);
  });

  it('las revelaciones mínimas del Grupo 2 están todas en el índice', () => {
    const titulos = ESTRUCTURA_NOTAS.map((n) => n.titulo.toLowerCase()).join(' | ');
    expect(titulos).toContain('bases de preparación');
    expect(titulos).toContain('políticas contables');
    expect(titulos).toContain('juicios contables');
    expect(titulos).toContain('incertidumbre en las estimaciones');
    expect(titulos).toContain('desagregación de las partidas del estado de situación financiera');
    expect(titulos).toContain('desagregación de ingresos, costos y gastos');
    expect(titulos).toContain('movimientos del patrimonio');
    expect(titulos).toContain('efectivo y equivalentes');
  });

  it('solo se declaran automáticas las notas que salen enteras del ledger', () => {
    expect(notasAutomaticas().map((n) => n.codigo).sort()).toEqual(['N6', 'N7']);
  });

  it('sin `seccion_niif` poblada, la lista de políticas sale VACÍA en vez de suponer secciones', () => {
    expect(seccionesEnJuego([{ seccionNiif: null, saldoFinal: '100' }])).toEqual([]);
    expect(
      seccionesEnJuego([
        { seccionNiif: 'Sección 13 — Inventarios', saldoFinal: '100' },
        // Una cuenta sin saldo no pone su sección en juego.
        { seccionNiif: 'Sección 17 — Propiedades, planta y equipo', saldoFinal: '0' },
      ]),
    ).toEqual(['Sección 13 — Inventarios']);
  });
});

// =============================================================================
describe('A10 · aritmética del armado', () => {
  it('el ESF cuadra y respeta el signo de presentación de cada sección', () => {
    const esf = armarEstadoSituacionFinanciera(
      [
        cuenta({ cuentaCodigo: '110505', clasificacionNiif: 'activo_corriente', saldoFinal: '300' }),
        cuenta({ cuentaCodigo: '220505', clasificacionNiif: 'pasivo_corriente', saldoFinal: '-200' }),
        cuenta({ cuentaCodigo: '310505', clasificacionNiif: 'patrimonio', saldoFinal: '-50' }),
        cuenta({ cuentaCodigo: '413595', clasificacionNiif: 'ingreso', saldoFinal: '-50' }),
      ],
      { fechaCorte: '2026-12-31' },
    );
    expect(esf.totalActivo).toBe('300');
    expect(esf.totalPasivo).toBe('200');
    expect(esf.totalPatrimonio).toBe('50');
    expect(esf.resultadoNoCerrado).toBe('50');
    expect(esf.descuadre).toBe('0');
  });

  it('las cuentas de orden se excluyen del ESF (no son activo, pasivo ni patrimonio)', () => {
    const esf = armarEstadoSituacionFinanciera(
      [
        cuenta({ cuentaCodigo: '110505', clasificacionNiif: 'activo_corriente', saldoFinal: '100' }),
        cuenta({ cuentaCodigo: '220505', clasificacionNiif: 'pasivo_corriente', saldoFinal: '-100' }),
        cuenta({ cuentaCodigo: '810505', clasificacionNiif: 'cuenta_de_orden', saldoFinal: '999' }),
      ],
      { fechaCorte: '2026-12-31' },
    );
    expect(esf.detalle.some((c) => c.cuentaCodigo === '810505')).toBe(false);
    expect(esf.descuadre).toBe('0');
  });

  it('la aritmética es BigInt: un importe por encima del entero seguro de JavaScript no pierde un centavo', () => {
    // 2^53 + 1. Con `number` este valor se redondearía y el estado descuadraría
    // sin que nadie lo notara. Es exactamente lo que la Regla de Oro 5 evita.
    const enorme = '9007199254740993';
    const esf = armarEstadoSituacionFinanciera(
      [
        cuenta({ cuentaCodigo: '110505', clasificacionNiif: 'activo_corriente', saldoFinal: enorme }),
        cuenta({
          cuentaCodigo: '220505',
          clasificacionNiif: 'pasivo_corriente',
          saldoFinal: `-${enorme}`,
        }),
      ],
      { fechaCorte: '2026-12-31' },
    );
    expect(esf.totalActivo).toBe(enorme);
    expect(esf.totalPasivo).toBe(enorme);
    expect(esf.descuadre).toBe('0');
  });

  it('el ERI por función y por naturaleza dan el MISMO total, agregado a distinto nivel', () => {
    const cuentas = [
      cuenta({
        cuentaCodigo: '510506',
        clasificacionNiif: 'gasto',
        rubro: 'Operacionales de administración',
        grupoCodigo: '51',
        debitos: '700',
        creditos: '0',
      }),
      cuenta({
        cuentaCodigo: '511006',
        clasificacionNiif: 'gasto',
        rubro: 'Operacionales de administración',
        grupoCodigo: '51',
        debitos: '300',
        creditos: '0',
      }),
    ];
    const naturaleza = [
      { saldo: cuentas[0]!, naturalezaCodigo: '5105', naturalezaNombre: 'Gastos de personal' },
      { saldo: cuentas[1]!, naturalezaCodigo: '5110', naturalezaNombre: 'Honorarios' },
    ];

    const funcion = armarEstadoResultadoIntegral(cuentas, naturaleza, {
      desde: '2026-01-01',
      hasta: '2026-12-31',
      presentacion: 'funcion',
    });
    const porNaturaleza = armarEstadoResultadoIntegral(cuentas, naturaleza, {
      desde: '2026-01-01',
      hasta: '2026-12-31',
      presentacion: 'naturaleza',
    });

    expect(funcion.totalGastos).toBe('1000');
    expect(porNaturaleza.totalGastos).toBe('1000');
    // Por función: un renglón (el grupo). Por naturaleza: dos (las cuentas).
    expect(funcion.renglones.filter((r) => r.seccion === 'Gastos' && r.nivel === 2)).toHaveLength(1);
    expect(
      porNaturaleza.renglones.filter((r) => r.seccion === 'Gastos' && r.nivel === 2),
    ).toHaveLength(2);
  });

  it('el desglose por naturaleza solo incluye costos y gastos, con el rótulo del catálogo', () => {
    const gasto = cuenta({ cuentaCodigo: '510506', clasificacionNiif: 'gasto', debitos: '400' });
    const ingreso = cuenta({ cuentaCodigo: '413595', clasificacionNiif: 'ingreso', creditos: '900' });
    const desglose = armarDesgloseNaturaleza([
      { saldo: gasto, naturalezaCodigo: '5105', naturalezaNombre: 'Gastos de personal' },
      { saldo: ingreso, naturalezaCodigo: '4135', naturalezaNombre: 'Comercio al por mayor' },
    ]);
    expect(desglose).toHaveLength(1);
    expect(desglose[0]!.rubro).toBe('Gastos de personal');
    expect(desglose[0]!.valor).toBe('400');
  });

  it('el EFE agrupa por actividad y cuenta cuántas partidas quedaron por confirmar', () => {
    const partidas: PartidaFlujo[] = [
      {
        journalEntryId: 'a',
        asientoNumero: '1',
        fecha: '2026-03-01',
        cuentaCodigo: '413595',
        cuentaNombre: 'Ingresos',
        rubro: 'Operacionales',
        actividad: 'operacion',
        actividadOrigen: 'presumida',
        flujo: '500',
        terceroRazonSocial: null,
      },
      {
        journalEntryId: 'b',
        asientoNumero: '2',
        fecha: '2026-03-02',
        cuentaCodigo: '152405',
        cuentaNombre: 'Equipo de cómputo',
        rubro: 'Propiedades, planta y equipo',
        actividad: 'inversion',
        actividadOrigen: 'declarada',
        flujo: '-200',
        terceroRazonSocial: null,
      },
    ];
    const efe = armarEstadoFlujosEfectivo(partidas, {
      desde: '2026-01-01',
      hasta: '2026-12-31',
      cuentasEfectivo: [{ accountId: 'caja', codigo: '110505', nombre: 'Caja' }],
      candidatasEfectivo: [],
      efectivoInicial: '1000',
      efectivoFinal: '1300',
    });
    expect(efe.flujoOperacion).toBe('500');
    expect(efe.flujoInversion).toBe('-200');
    expect(efe.flujoNeto).toBe('300');
    expect(efe.descuadre).toBe('0');
    expect(efe.partidasPresumidas).toBe(1);

    // La partida presumida se marca en el renglón; la declarada, no.
    const operacion = efe.renglones.find(
      (r) => r.seccion === 'Actividades de operación' && r.nivel === 2,
    );
    const inversion = efe.renglones.find(
      (r) => r.seccion === 'Actividades de inversión' && r.nivel === 2,
    );
    expect(operacion!.advertencia).toContain('PRESUNCIÓN');
    expect(inversion!.advertencia).toBeNull();
  });
});

/**
 * A10 — Armado de los cuatro estados financieros a partir de los saldos ya
 * consultados. Funciones PURAS: entra lo que devolvió `consulta.ts`, sale el
 * estado. Sin I/O, como `src/domain/`.
 *
 * Aritmética en `BigInt` de punta a punta (Regla de Oro 5). No hay una sola
 * división en todo el archivo: los estados financieros suman y restan, nunca
 * prorratean. Lo único que se divide en el producto es centavos → pesos, y eso
 * ocurre en la capa de presentación de A9 (`src/reports/formato.ts`).
 */
import type {
  ActividadEfe,
  ClasificacionNiif,
  EstadoCambiosPatrimonio,
  EstadoFlujosEfectivo,
  EstadoResultadoIntegral,
  EstadoSituacionFinanciera,
  MovimientoPatrimonio,
  PartidaFlujo,
  PresentacionEri,
  RenglonEstado,
  SaldoCuenta,
} from './tipos';
import type { AsientoPatrimonio } from './tipos';

const CERO = 0n;

function sumar(valores: Iterable<string>): bigint {
  let total = CERO;
  for (const v of valores) total += BigInt(v);
  return total;
}

/** Saldo acumulado con signo deudor positivo. */
function saldoDeudor(c: SaldoCuenta): bigint {
  return BigInt(c.saldoFinal);
}

/** Movimiento del período con signo deudor positivo. */
function movimientoDeudor(c: SaldoCuenta): bigint {
  return BigInt(c.debitos) - BigInt(c.creditos);
}

const CLASES_ACTIVO: ClasificacionNiif[] = ['activo_corriente', 'activo_no_corriente'];
const CLASES_PASIVO: ClasificacionNiif[] = ['pasivo_corriente', 'pasivo_no_corriente'];
const CLASES_RESULTADO: ClasificacionNiif[] = ['ingreso', 'costo', 'gasto', 'otro_resultado_integral'];

/**
 * Rótulos de las secciones del ESF. Son TEXTO DE PRESENTACIÓN en español, no
 * clasificaciones inventadas: cada uno corresponde uno a uno con un valor del
 * CHECK de `niif_mapping.clasificacion_niif`, que es donde vive la decisión.
 */
const SECCION_ESF: Record<string, string> = {
  activo_corriente: 'Activo corriente',
  activo_no_corriente: 'Activo no corriente',
  pasivo_corriente: 'Pasivo corriente',
  pasivo_no_corriente: 'Pasivo no corriente',
  patrimonio: 'Patrimonio',
};

const SECCION_ERI: Record<string, string> = {
  ingreso: 'Ingresos',
  costo: 'Costos',
  gasto: 'Gastos',
  otro_resultado_integral: 'Otro resultado integral',
};

const SECCION_EFE: Record<ActividadEfe, string> = {
  operacion: 'Actividades de operación',
  inversion: 'Actividades de inversión',
  financiacion: 'Actividades de financiación',
  sin_clasificar: 'Partidas sin actividad asignada',
};

const ADVERTENCIA_SIN_MAPEO =
  'Cuenta con saldo y SIN clasificación NIIF vigente: ni ella ni ningún ancestro suyo del PUC tiene mapeo. No se puede presentar en ningún rubro hasta que se clasifique.';

// =============================================================================
// Estado de Situación Financiera (sección 4)
// =============================================================================

export function armarEstadoSituacionFinanciera(
  saldos: readonly SaldoCuenta[],
  opciones: {
    fechaCorte: string;
    comparativos?: readonly SaldoCuenta[] | null;
    fechaCorteComparativa?: string | null;
  },
): EstadoSituacionFinanciera {
  // Las cuentas de orden (clases 8 y 9) no van al ESF: no son activos, pasivos
  // ni patrimonio. Se revelan en notas (sección 8.2(c)) si son significativas.
  const relevantes = saldos.filter((c) => c.clasificacionNiif !== 'cuenta_de_orden');
  const sinClasificar = relevantes.filter((c) => c.clasificacionNiif === null);

  const porClase = (clases: ClasificacionNiif[]): SaldoCuenta[] =>
    relevantes.filter((c) => c.clasificacionNiif !== null && clases.includes(c.clasificacionNiif));

  const activo = sumar(porClase(CLASES_ACTIVO).map((c) => c.saldoFinal));
  const pasivo = -sumar(porClase(CLASES_PASIVO).map((c) => c.saldoFinal));
  const patrimonio = -sumar(porClase(['patrimonio']).map((c) => c.saldoFinal));
  const resultadoNoCerrado = -sumar(porClase(CLASES_RESULTADO).map((c) => c.saldoFinal));
  const totalSinClasificar = -sumar(sinClasificar.map((c) => c.saldoFinal));

  const comparativoPorCuenta = new Map<string, bigint>();
  for (const c of opciones.comparativos ?? []) {
    comparativoPorCuenta.set(c.accountId, saldoDeudor(c));
  }
  const hayComparativo = (opciones.comparativos ?? null) !== null;

  const renglones: RenglonEstado[] = [];
  for (const clase of [...CLASES_ACTIVO, ...CLASES_PASIVO, 'patrimonio' as ClasificacionNiif]) {
    const cuentas = porClase([clase]);
    if (cuentas.length === 0) continue;
    const signo = clase === 'activo_corriente' || clase === 'activo_no_corriente' ? 1n : -1n;
    const seccion = SECCION_ESF[clase] ?? clase;
    const agrupados = agrupar(cuentas, (c) => `${c.grupoCodigo}|${c.rubro}`);

    for (const [, grupo] of agrupados) {
      const valor = signo * sumar(grupo.map((c) => c.saldoFinal));
      const comparativo = hayComparativo
        ? signo *
          grupo.reduce((acc, c) => acc + (comparativoPorCuenta.get(c.accountId) ?? CERO), CERO)
        : null;
      renglones.push({
        seccion,
        rubro: grupo[0]!.rubro,
        codigoOrden: grupo[0]!.grupoCodigo,
        valor: valor.toString(),
        valorComparativo: comparativo === null ? null : comparativo.toString(),
        nivel: 2,
        advertencia: grupo.some((c) => c.requiereVerificacionHumana)
          ? 'El mapeo NIIF que sustenta este rubro está marcado como pendiente de verificación humana en niif_mapping.'
          : null,
      });
    }

    const totalClase = signo * sumar(cuentas.map((c) => c.saldoFinal));
    renglones.push({
      seccion,
      rubro: `Total ${seccion.toLowerCase()}`,
      codigoOrden: 'zzz',
      valor: totalClase.toString(),
      valorComparativo: hayComparativo
        ? (
            signo *
            cuentas.reduce((acc, c) => acc + (comparativoPorCuenta.get(c.accountId) ?? CERO), CERO)
          ).toString()
        : null,
      nivel: 1,
      advertencia: null,
    });
  }

  if (resultadoNoCerrado !== CERO) {
    renglones.push({
      seccion: SECCION_ESF.patrimonio!,
      rubro: 'Resultado del ejercicio (pendiente de cierre contra patrimonio)',
      codigoOrden: 'zzy',
      valor: resultadoNoCerrado.toString(),
      valorComparativo: null,
      nivel: 2,
      advertencia:
        'Las cuentas de resultado todavía tienen saldo al corte: el asiento de cierre no se ha publicado. El importe se presenta dentro del patrimonio para que el estado cuadre.',
    });
  }

  for (const c of sinClasificar) {
    renglones.push({
      seccion: 'Partidas sin clasificación NIIF',
      rubro: `${c.cuentaCodigo} — ${c.cuentaNombre}`,
      codigoOrden: c.cuentaCodigo,
      valor: (-saldoDeudor(c)).toString(),
      valorComparativo: null,
      nivel: 2,
      advertencia: ADVERTENCIA_SIN_MAPEO,
    });
  }

  const descuadre =
    activo - pasivo - patrimonio - resultadoNoCerrado - totalSinClasificar;

  return {
    fechaCorte: opciones.fechaCorte,
    fechaCorteComparativa: opciones.fechaCorteComparativa ?? null,
    renglones,
    detalle: relevantes,
    totalActivo: activo.toString(),
    totalPasivo: pasivo.toString(),
    totalPatrimonio: patrimonio.toString(),
    resultadoNoCerrado: resultadoNoCerrado.toString(),
    totalSinClasificar: totalSinClasificar.toString(),
    descuadre: descuadre.toString(),
    cuentasSinClasificar: sinClasificar,
  };
}

// =============================================================================
// Estado de Resultado Integral (sección 5)
// =============================================================================

export function armarEstadoResultadoIntegral(
  saldos: readonly SaldoCuenta[],
  naturaleza: readonly { saldo: SaldoCuenta; naturalezaCodigo: string; naturalezaNombre: string | null }[],
  opciones: {
    desde: string;
    hasta: string;
    presentacion: PresentacionEri;
    comparativos?: readonly SaldoCuenta[] | null;
  },
): EstadoResultadoIntegral {
  const deResultado = saldos.filter(
    (c) => c.clasificacionNiif !== null && CLASES_RESULTADO.includes(c.clasificacionNiif),
  );
  const sinClasificar = saldos.filter(
    (c) => c.clasificacionNiif === null && movimientoDeudor(c) !== CERO,
  );

  const porClase = (clase: ClasificacionNiif): SaldoCuenta[] =>
    deResultado.filter((c) => c.clasificacionNiif === clase);

  const ingresos = -sumar2(porClase('ingreso'));
  const costos = sumar2(porClase('costo'));
  const gastos = sumar2(porClase('gasto'));
  const ori = -sumar2(porClase('otro_resultado_integral'));
  const resultado = ingresos - costos - gastos;

  const comparativoPorCuenta = new Map<string, bigint>();
  for (const c of opciones.comparativos ?? []) {
    comparativoPorCuenta.set(c.accountId, movimientoDeudor(c));
  }
  const hayComparativo = (opciones.comparativos ?? null) !== null;

  // La ÚNICA diferencia entre presentar por función y por naturaleza es el
  // nivel del PUC por el que se agrupa: el grupo (51 administración, 52
  // ventas, 61 costo de ventas) es la FUNCIÓN; la cuenta (5105 gastos de
  // personal, 5110 honorarios) es la NATURALEZA. El rótulo lo pone el
  // catálogo, no este archivo.
  const claveNaturaleza = new Map<string, { codigo: string; nombre: string | null }>();
  for (const n of naturaleza) {
    claveNaturaleza.set(n.saldo.accountId, { codigo: n.naturalezaCodigo, nombre: n.naturalezaNombre });
  }

  const renglones: RenglonEstado[] = [];
  for (const clase of CLASES_RESULTADO) {
    const cuentas = porClase(clase);
    if (cuentas.length === 0) continue;
    const signo = clase === 'ingreso' || clase === 'otro_resultado_integral' ? -1n : 1n;
    const seccion = SECCION_ERI[clase] ?? clase;

    const agrupados = agrupar(cuentas, (c) =>
      opciones.presentacion === 'funcion'
        ? `${c.grupoCodigo}|${c.rubro}`
        : `${claveNaturaleza.get(c.accountId)?.codigo ?? c.cuentaCodigo}`,
    );

    for (const [, grupo] of agrupados) {
      const primera = grupo[0]!;
      const rubro =
        opciones.presentacion === 'funcion'
          ? primera.rubro
          : (claveNaturaleza.get(primera.accountId)?.nombre ??
            `${claveNaturaleza.get(primera.accountId)?.codigo ?? primera.cuentaCodigo} — ${primera.cuentaNombre}`);
      const valor = signo * sumar2(grupo);
      const comparativo = hayComparativo
        ? signo *
          grupo.reduce((acc, c) => acc + (comparativoPorCuenta.get(c.accountId) ?? CERO), CERO)
        : null;
      renglones.push({
        seccion,
        rubro,
        codigoOrden:
          opciones.presentacion === 'funcion'
            ? primera.grupoCodigo
            : (claveNaturaleza.get(primera.accountId)?.codigo ?? primera.cuentaCodigo),
        valor: valor.toString(),
        valorComparativo: comparativo === null ? null : comparativo.toString(),
        nivel: 2,
        advertencia: null,
      });
    }

    renglones.push({
      seccion,
      rubro: `Total ${seccion.toLowerCase()}`,
      codigoOrden: 'zzz',
      valor: (signo * sumar2(cuentas)).toString(),
      valorComparativo: null,
      nivel: 1,
      advertencia: null,
    });
  }

  for (const c of sinClasificar) {
    renglones.push({
      seccion: 'Partidas sin clasificación NIIF',
      rubro: `${c.cuentaCodigo} — ${c.cuentaNombre}`,
      codigoOrden: c.cuentaCodigo,
      valor: movimientoDeudor(c).toString(),
      valorComparativo: null,
      nivel: 2,
      advertencia: ADVERTENCIA_SIN_MAPEO,
    });
  }

  renglones.push({
    seccion: 'Resultado',
    rubro: 'Resultado del período',
    codigoOrden: 'zzz1',
    valor: resultado.toString(),
    valorComparativo: null,
    nivel: 0,
    advertencia: null,
  });
  renglones.push({
    seccion: 'Resultado',
    rubro: 'Resultado integral total del período',
    codigoOrden: 'zzz2',
    valor: (resultado + ori).toString(),
    valorComparativo: null,
    nivel: 0,
    advertencia: null,
  });

  return {
    desde: opciones.desde,
    hasta: opciones.hasta,
    presentacion: opciones.presentacion,
    renglones,
    detalle: deResultado,
    totalIngresos: ingresos.toString(),
    totalCostos: costos.toString(),
    totalGastos: gastos.toString(),
    resultadoDelPeriodo: resultado.toString(),
    otroResultadoIntegral: ori.toString(),
    resultadoIntegralTotal: (resultado + ori).toString(),
    desgloseNaturaleza: armarDesgloseNaturaleza(naturaleza),
    cuentasSinClasificar: sinClasificar,
  };
}

function sumar2(cuentas: readonly SaldoCuenta[]): bigint {
  let total = CERO;
  for (const c of cuentas) total += movimientoDeudor(c);
  return total;
}

/**
 * Desglose de costos y gastos POR NATURALEZA. Cuando el ERI se presenta por
 * función, la sección 5.11(b) exige revelarlo de todos modos —incluyendo
 * depreciación, amortización y beneficios a los empleados—, así que este
 * desglose no es optativo: sale siempre, y se lleva a la nota correspondiente.
 */
export function armarDesgloseNaturaleza(
  naturaleza: readonly { saldo: SaldoCuenta; naturalezaCodigo: string; naturalezaNombre: string | null }[],
): RenglonEstado[] {
  const soloCostosYGastos = naturaleza.filter(
    (n) => n.saldo.clasificacionNiif === 'costo' || n.saldo.clasificacionNiif === 'gasto',
  );
  const agrupados = agrupar(soloCostosYGastos, (n) => n.naturalezaCodigo);
  const renglones: RenglonEstado[] = [];
  for (const [codigo, grupo] of agrupados) {
    let total = CERO;
    for (const n of grupo) total += movimientoDeudor(n.saldo);
    renglones.push({
      seccion: 'Costos y gastos por naturaleza',
      rubro: grupo[0]!.naturalezaNombre ?? `${codigo} — ${grupo[0]!.saldo.cuentaNombre}`,
      codigoOrden: codigo,
      valor: total.toString(),
      valorComparativo: null,
      nivel: 2,
      advertencia: null,
    });
  }
  renglones.sort((a, b) => a.codigoOrden.localeCompare(b.codigoOrden));
  return renglones;
}

// =============================================================================
// Estado de Cambios en el Patrimonio (sección 6)
// =============================================================================

export function armarEstadoCambiosPatrimonio(
  saldos: readonly SaldoCuenta[],
  asientos: readonly AsientoPatrimonio[],
  opciones: { desde: string; hasta: string; resultadoDelPeriodo: string },
): EstadoCambiosPatrimonio {
  const patrimonio = saldos.filter((c) => c.clasificacionNiif === 'patrimonio');

  const movimientos: MovimientoPatrimonio[] = patrimonio.map((c) => ({
    accountId: c.accountId,
    componenteCodigo: c.grupoCodigo,
    componenteNombre: c.grupoNombre ?? c.rubro,
    cuentaCodigo: c.cuentaCodigo,
    cuentaNombre: c.cuentaNombre,
    saldoInicial: (-BigInt(c.saldoInicial)).toString(),
    aumentos: c.creditos,
    disminuciones: c.debitos,
    saldoFinal: (-BigInt(c.saldoFinal)).toString(),
    // En blanco a propósito: la clasificación de un movimiento de patrimonio
    // entre «cambio de política contable», «corrección de error», «aporte de
    // los propietarios» y «distribución» es juicio profesional. El sistema no
    // la deduce del asiento; el papel de trabajo la pide.
    naturalezaDelCambio: '',
  }));

  const saldoInicialTotal = movimientos.reduce((a, m) => a + BigInt(m.saldoInicial), CERO);
  const saldoFinalTotal = movimientos.reduce((a, m) => a + BigInt(m.saldoFinal), CERO);

  return {
    desde: opciones.desde,
    hasta: opciones.hasta,
    movimientos,
    saldoInicialTotal: saldoInicialTotal.toString(),
    resultadoDelPeriodo: opciones.resultadoDelPeriodo,
    saldoFinalTotal: saldoFinalTotal.toString(),
    asientosDePatrimonio: [...asientos],
  };
}

// =============================================================================
// Estado de Flujos de Efectivo, método directo (sección 7)
// =============================================================================

export function armarEstadoFlujosEfectivo(
  partidas: readonly PartidaFlujo[],
  opciones: {
    desde: string;
    hasta: string;
    cuentasEfectivo: { accountId: string; codigo: string; nombre: string }[];
    candidatasEfectivo: readonly SaldoCuenta[];
    efectivoInicial: string;
    efectivoFinal: string;
  },
): EstadoFlujosEfectivo {
  const porActividad = new Map<ActividadEfe, bigint>();
  const renglones: RenglonEstado[] = [];

  const actividades: ActividadEfe[] = ['operacion', 'inversion', 'financiacion', 'sin_clasificar'];
  for (const actividad of actividades) {
    const dela = partidas.filter((p) => p.actividad === actividad);
    if (dela.length === 0) {
      porActividad.set(actividad, CERO);
      continue;
    }
    const agrupados = agrupar(dela, (p) => p.rubro);
    let total = CERO;
    for (const [rubro, grupo] of agrupados) {
      const valor = grupo.reduce((a, p) => a + BigInt(p.flujo), CERO);
      total += valor;
      renglones.push({
        seccion: SECCION_EFE[actividad],
        rubro,
        codigoOrden: rubro,
        valor: valor.toString(),
        valorComparativo: null,
        nivel: 2,
        advertencia: grupo.some((p) => p.actividadOrigen !== 'declarada')
          ? 'Actividad asignada por PRESUNCIÓN a partir de la clasificación NIIF. Confírmela declarando rubro_efe en el mapeo NIIF antes de emitir el estado.'
          : null,
      });
    }
    porActividad.set(actividad, total);
    renglones.push({
      seccion: SECCION_EFE[actividad],
      rubro: `Flujo neto de ${SECCION_EFE[actividad].toLowerCase()}`,
      codigoOrden: 'zzz',
      valor: total.toString(),
      valorComparativo: null,
      nivel: 1,
      advertencia: null,
    });
  }

  const operacion = porActividad.get('operacion') ?? CERO;
  const inversion = porActividad.get('inversion') ?? CERO;
  const financiacion = porActividad.get('financiacion') ?? CERO;
  const sinClasificar = porActividad.get('sin_clasificar') ?? CERO;
  const neto = operacion + inversion + financiacion + sinClasificar;

  const inicial = BigInt(opciones.efectivoInicial);
  const final = BigInt(opciones.efectivoFinal);

  return {
    desde: opciones.desde,
    hasta: opciones.hasta,
    cuentasEfectivo: opciones.cuentasEfectivo,
    sinCuentasDeEfectivoMarcadas: opciones.cuentasEfectivo.length === 0,
    candidatasEfectivo: [...opciones.candidatasEfectivo],
    partidas: [...partidas],
    renglones,
    flujoOperacion: operacion.toString(),
    flujoInversion: inversion.toString(),
    flujoFinanciacion: financiacion.toString(),
    flujoNeto: neto.toString(),
    efectivoInicial: inicial.toString(),
    efectivoFinal: final.toString(),
    descuadre: (inicial + neto - final).toString(),
    partidasPresumidas: partidas.filter((p) => p.actividadOrigen !== 'declarada').length,
  };
}

// =============================================================================
// Utilidad
// =============================================================================

function agrupar<T>(items: readonly T[], clave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of items) {
    const k = clave(item);
    const existente = mapa.get(k);
    if (existente) existente.push(item);
    else mapa.set(k, [item]);
  }
  return mapa;
}

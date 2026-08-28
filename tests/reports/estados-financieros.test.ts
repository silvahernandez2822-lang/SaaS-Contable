/**
 * A10 — Los cuatro estados financieros bajo NIIF para las PYMES (Grupo 2),
 * contra una base de datos real (PGlite). Cubre:
 *
 *  1. Que el Estado de Situación Financiera CUADRE al centavo, y que cuadre
 *     porque el ledger impone la doble partida, no porque el informe se cuadre
 *     a sí mismo.
 *  2. Que la clasificación NIIF se HEREDE del ancestro del PUC: A1 cargó el
 *     catálogo hasta el nivel de cuenta, y las subcuentas de cada empresa no
 *     tienen mapeo propio.
 *  3. Que una cuenta con saldo y sin mapeo NIIF aparezca APARTE, nunca omitida.
 *  4. Que el ERI por función y por naturaleza sean el mismo dato agregado a
 *     distinto nivel del PUC, y que el desglose por naturaleza salga siempre.
 *  5. Que el Estado de Flujos de Efectivo por método directo concilie al
 *     centavo, y que sin cuentas de efectivo marcadas salga VACÍO con su papel
 *     de trabajo dentro, en vez de salir con una cifra supuesta.
 *  6. Aislamiento entre empresas (Regla de Oro 7).
 *  7. Que `reporte.exportar` se exija de verdad.
 *  8. Que cada libro traiga las cuatro hojas obligatorias de la sección 11.2
 *     más sus hojas de papel de trabajo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import {
  CIEN_MIL,
  MEDIO_MILLON,
  TRESCIENTOS_MIL,
  UN_MILLON,
  montarMovimientos,
  montarPucYMapeo,
  publicarEnFecha,
  type CuentasEstados,
} from '../helpers/estados-a10';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import type { SqlClient } from '../../src/db/types';
import {
  calcularEstadoCambiosPatrimonio,
  calcularEstadoFlujosEfectivo,
  calcularEstadoResultadoIntegral,
  calcularEstadoSituacionFinanciera,
  diaAnterior,
  generarEstadoCambiosPatrimonio,
  generarEstadoFlujosEfectivo,
  generarEstadoResultadoIntegral,
  generarEstadoSituacionFinanciera,
  generarNotasEstadosFinancieros,
} from '../../src/reports/estados/libros';

const HOJAS_OBLIGATORIAS = ['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros'];
const EJERCICIO = { desde: '2026-06-01', hasta: '2026-06-30' };

let db: TestDb;
let e: Escenario;
let cuentas: CuentasEstados;
let eSinEfectivo: Escenario;
let cuentasSinEfectivo: CuentasEstados;
let otra: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  eSinEfectivo = await crearEscenario(db);
  otra = await crearEscenario(db);

  await db.asAdmin(async (tx) => {
    cuentas = await montarPucYMapeo(tx, e, { marcarEfectivo: true });
    cuentasSinEfectivo = await montarPucYMapeo(tx, eSinEfectivo, { marcarEfectivo: false });
    await montarPucYMapeo(tx, otra, { marcarEfectivo: true });
    await montarMovimientos(tx, e, cuentas);
    await montarMovimientos(tx, eSinEfectivo, cuentasSinEfectivo);
  });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

function enEmpresa<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  return db.asTenant(e.tenantId, e.companyId, fn);
}

// =============================================================================
describe('A10 · Estado de Situación Financiera (sección 4)', () => {
  it('cuadra al centavo: Activo − Pasivo − Patrimonio − Resultado − Sin clasificar = 0', async () => {
    const esf = await enEmpresa((tx) =>
      calcularEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    expect(esf.descuadre).toBe('0');

    // Y cuadra con las cifras que dicta la aritmética del ledger, no con
    // cualquier terna que sume cero.
    expect(esf.totalActivo).toBe(String(CIEN_MIL));
    expect(esf.totalPasivo).toBe(String(UN_MILLON - TRESCIENTOS_MIL));
    expect(esf.totalPatrimonio).toBe('0');
    expect(esf.resultadoNoCerrado).toBe(String(-(UN_MILLON - MEDIO_MILLON)));
    expect(esf.totalSinClasificar).toBe(String(-CIEN_MIL));
  });

  it('hereda la clasificación NIIF del ancestro del PUC cuando la subcuenta no tiene mapeo propio', async () => {
    const esf = await enEmpresa((tx) =>
      calcularEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    const gasto = esf.detalle.find((c) => c.cuentaCodigo === '513595');
    expect(gasto).toBeDefined();
    expect(gasto!.clasificacionNiif).toBe('gasto');
    expect(gasto!.resolucionNiif).toBe('heredada');
    expect(gasto!.origenCodigo).toBe('51');
    // Y el rótulo sale del CATÁLOGO, no de una constante del programa.
    expect(gasto!.rubro).toBe('Operacionales de administración');
  });

  it('una cuenta con saldo y sin mapeo NIIF sale APARTE, nunca omitida', async () => {
    const esf = await enEmpresa((tx) =>
      calcularEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    const huerfana = esf.cuentasSinClasificar.find((c) => c.cuentaCodigo === '199905');
    expect(huerfana).toBeDefined();
    expect(huerfana!.resolucionNiif).toBe('sin_mapeo');
    expect(huerfana!.saldoFinal).toBe(String(CIEN_MIL));

    // Aparece en el estado, con su alerta: omitirla lo descuadraría en silencio.
    const renglon = esf.renglones.find((r) => r.rubro.startsWith('199905'));
    expect(renglon).toBeDefined();
    expect(renglon!.advertencia).toContain('SIN clasificación NIIF');
  });

  it('acepta comparativo del período anterior (información comparativa, 3.14)', async () => {
    const esf = await enEmpresa((tx) =>
      calcularEstadoSituacionFinanciera(tx, {
        fechaCorte: EJERCICIO.hasta,
        fechaCorteComparativa: '2026-06-12',
      }),
    );
    expect(esf.fechaCorteComparativa).toBe('2026-06-12');
    const pasivo = esf.renglones.find((r) => r.rubro === 'Proveedores');
    expect(pasivo).toBeDefined();
    // Al 12 de junio solo existía la factura de compra: el pago fue el día 20.
    expect(pasivo!.valorComparativo).toBe(String(UN_MILLON));
    expect(pasivo!.valor).toBe(String(UN_MILLON - TRESCIENTOS_MIL));
  });

  it('el libro trae las cuatro hojas obligatorias más el cuadre y las no clasificadas', async () => {
    const wb = await enEmpresa((tx) =>
      generarEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    const hojas = wb.worksheets.map((h) => h.name);
    for (const obligatoria of HOJAS_OBLIGATORIAS) expect(hojas).toContain(obligatoria);
    expect(hojas).toContain('Cuadre');
    expect(hojas).toContain('Sin clasificacion NIIF');
    // Las cuatro obligatorias van PRIMERO: las adicionales no las desplazan.
    expect(hojas.slice(0, 4)).toEqual(HOJAS_OBLIGATORIAS);
  });

  it('la hoja "Trazabilidad" dice con qué mapeo y qué vigencia se clasificó cada cuenta', async () => {
    const wb = await enEmpresa((tx) =>
      generarEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    const traza = wb.getWorksheet('Trazabilidad')!;
    const textos: string[] = [];
    traza.eachRow((fila) => {
      textos.push(fila.values!.toString());
    });
    const unido = textos.join('\n');
    expect(unido).toContain('513595');
    expect(unido).toContain('2020-01-01');
    expect(unido).toContain('Mapeo de prueba A10');
  });
});

// =============================================================================
describe('A10 · Estado de Resultado Integral (sección 5)', () => {
  it('por función agrupa por el GRUPO del PUC, con el nombre del catálogo', async () => {
    const eri = await enEmpresa((tx) =>
      calcularEstadoResultadoIntegral(tx, { ...EJERCICIO, presentacion: 'funcion' }),
    );
    expect(eri.presentacion).toBe('funcion');
    const gastos = eri.renglones.filter((r) => r.seccion === 'Gastos' && r.nivel === 2);
    expect(gastos).toHaveLength(1);
    expect(gastos[0]!.rubro).toBe('Operacionales de administración');
    expect(gastos[0]!.codigoOrden).toBe('51');
  });

  it('por naturaleza agrupa por la CUENTA del PUC: el mismo dato un nivel más abajo', async () => {
    const eri = await enEmpresa((tx) =>
      calcularEstadoResultadoIntegral(tx, { ...EJERCICIO, presentacion: 'naturaleza' }),
    );
    const gastos = eri.renglones.filter((r) => r.seccion === 'Gastos' && r.nivel === 2);
    expect(gastos[0]!.codigoOrden).toBe('5135');
    expect(gastos[0]!.rubro).toBe('Servicios');
    // Cambia la agregación, no la cifra.
    expect(eri.totalGastos).toBe(String(UN_MILLON));
  });

  it('el resultado del período es ingresos − costos − gastos, en BigInt', async () => {
    const eri = await enEmpresa((tx) => calcularEstadoResultadoIntegral(tx, EJERCICIO));
    expect(eri.totalIngresos).toBe(String(MEDIO_MILLON));
    expect(eri.totalCostos).toBe('0');
    expect(eri.totalGastos).toBe(String(UN_MILLON));
    expect(eri.resultadoDelPeriodo).toBe(String(MEDIO_MILLON - UN_MILLON));
    expect(eri.resultadoIntegralTotal).toBe(String(MEDIO_MILLON - UN_MILLON));
  });

  it('el desglose por naturaleza sale SIEMPRE, aunque se presente por función (5.11(b))', async () => {
    const eri = await enEmpresa((tx) =>
      calcularEstadoResultadoIntegral(tx, { ...EJERCICIO, presentacion: 'funcion' }),
    );
    expect(eri.desgloseNaturaleza.length).toBeGreaterThan(0);
    expect(eri.desgloseNaturaleza.map((r) => r.codigoOrden)).toContain('5135');
  });

  it('el libro trae las cuatro hojas obligatorias más el desglose por naturaleza', async () => {
    const wb = await enEmpresa((tx) => generarEstadoResultadoIntegral(tx, EJERCICIO));
    const hojas = wb.worksheets.map((h) => h.name);
    expect(hojas.slice(0, 4)).toEqual(HOJAS_OBLIGATORIAS);
    expect(hojas).toContain('Gastos por naturaleza');
    expect(hojas).toContain('Resultado');
  });
});

// =============================================================================
describe('A10 · Estado de Cambios en el Patrimonio (sección 6)', () => {
  it('la columna de naturaleza del cambio queda EN BLANCO: es juicio profesional', async () => {
    await db.asAdmin((tx) =>
      publicarEnFecha(tx, e, '2026-06-28', [
        { accountId: cuentas.caja, side: 'debito', monto: CIEN_MIL },
        { accountId: cuentas.resultadoDelEjercicio, side: 'credito', monto: CIEN_MIL },
      ]),
    );
    const ecp = await enEmpresa((tx) => calcularEstadoCambiosPatrimonio(tx, EJERCICIO));
    const componente = ecp.movimientos.find((m) => m.cuentaCodigo === '360505');
    expect(componente).toBeDefined();
    expect(componente!.componenteNombre).toBe('Resultados del ejercicio');
    expect(componente!.aumentos).toBe(String(CIEN_MIL));
    expect(componente!.naturalezaDelCambio).toBe('');
  });

  it('el papel de trabajo lista una fila por partida de patrimonio, para que la clasifique un humano', async () => {
    const wb = await enEmpresa((tx) => generarEstadoCambiosPatrimonio(tx, EJERCICIO));
    const hojas = wb.worksheets.map((h) => h.name);
    expect(hojas.slice(0, 4)).toEqual(HOJAS_OBLIGATORIAS);
    expect(hojas).toContain('PT clasificacion movimientos');

    const pt = wb.getWorksheet('PT clasificacion movimientos')!;
    const textos: string[] = [];
    pt.eachRow((fila) => textos.push(fila.values!.toString()));
    const unido = textos.join('\n');
    expect(unido).toContain('CLASIFIQUE AQUÍ');
    expect(unido).toContain('Corrección de un error de períodos anteriores');
    expect(unido).toContain('360505');
  });
});

// =============================================================================
describe('A10 · Estado de Flujos de Efectivo, método directo (sección 7)', () => {
  it('concilia al centavo: efectivo inicial + flujo neto − efectivo final = 0', async () => {
    const efe = await enEmpresa((tx) => calcularEstadoFlujosEfectivo(tx, EJERCICIO));
    expect(efe.descuadre).toBe('0');
    expect(efe.efectivoInicial).toBe('0');
    // 500.000 de cobro − 300.000 de pago − 100.000 del movimiento sin clasificar
    // + 100.000 del aporte del ECP de más arriba.
    expect(efe.efectivoFinal).toBe(String(MEDIO_MILLON - TRESCIENTOS_MIL));
    expect(efe.flujoNeto).toBe(efe.efectivoFinal);
  });

  it('clasifica por actividad y marca lo que asignó por PRESUNCIÓN', async () => {
    const efe = await enEmpresa((tx) => calcularEstadoFlujosEfectivo(tx, EJERCICIO));
    const operacion = efe.partidas.filter((p) => p.actividad === 'operacion');
    expect(operacion.length).toBeGreaterThan(0);
    // Ninguna de estas cuentas declara rubro_efe, así que todas van presumidas
    // y todas quedan listadas para confirmación humana.
    expect(efe.partidasPresumidas).toBeGreaterThan(0);
    expect(operacion.every((p) => p.actividadOrigen === 'presumida')).toBe(true);

    const huerfana = efe.partidas.find((p) => p.cuentaCodigo === '199905');
    expect(huerfana).toBeDefined();
    expect(huerfana!.actividad).toBe('sin_clasificar');
    expect(huerfana!.actividadOrigen).toBe('sin_mapeo');
  });

  it('un traslado entre dos cuentas de efectivo NO genera flujo (7.3)', async () => {
    // Se comprueba por la identidad que hace exacto el método directo: solo se
    // listan las CONTRAPARTIDAS de las líneas de efectivo, y un traslado entre
    // efectivos no tiene ninguna.
    const efe = await enEmpresa((tx) => calcularEstadoFlujosEfectivo(tx, EJERCICIO));
    expect(efe.partidas.every((p) => p.cuentaCodigo !== '110505')).toBe(true);
  });

  it('sin cuentas de efectivo marcadas el estado sale VACÍO, con su papel de trabajo dentro', async () => {
    const efe = await db.asTenant(eSinEfectivo.tenantId, eSinEfectivo.companyId, (tx) =>
      calcularEstadoFlujosEfectivo(tx, EJERCICIO),
    );
    expect(efe.sinCuentasDeEfectivoMarcadas).toBe(true);
    expect(efe.partidas).toHaveLength(0);
    expect(efe.flujoNeto).toBe('0');
    // Pero SÍ trae las candidatas para que el contador decida: preguntar, no suponer.
    expect(efe.candidatasEfectivo.some((c) => c.cuentaCodigo === '110505')).toBe(true);

    const wb = await db.asTenant(eSinEfectivo.tenantId, eSinEfectivo.companyId, (tx) =>
      generarEstadoFlujosEfectivo(tx, EJERCICIO),
    );
    const pt = wb.getWorksheet('PT efectivo y equivalentes')!;
    const textos: string[] = [];
    pt.eachRow((fila) => textos.push(fila.values!.toString()));
    const unido = textos.join('\n');
    expect(unido).toContain('NINGUNA CUENTA ESTÁ MARCADA TODAVÍA');
    expect(unido).toContain('110505');
  });

  it('el libro trae las cuatro obligatorias más los dos papeles de trabajo de juicio', async () => {
    const wb = await enEmpresa((tx) => generarEstadoFlujosEfectivo(tx, EJERCICIO));
    const hojas = wb.worksheets.map((h) => h.name);
    expect(hojas.slice(0, 4)).toEqual(HOJAS_OBLIGATORIAS);
    expect(hojas).toContain('Conciliacion efectivo');
    expect(hojas).toContain('PT efectivo y equivalentes');
    expect(hojas).toContain('PT actividades presumidas');
  });

  it('diaAnterior no depende de la zona horaria del proceso', () => {
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31');
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
  });
});

// =============================================================================
describe('A10 · Notas a los estados financieros (sección 8)', () => {
  it('trae el índice de notas y una hoja de papel de trabajo por cada revelación de juicio', async () => {
    const wb = await enEmpresa((tx) => generarNotasEstadosFinancieros(tx, EJERCICIO));
    const hojas = wb.worksheets.map((h) => h.name);
    expect(hojas.slice(0, 4)).toEqual(HOJAS_OBLIGATORIAS);
    expect(hojas).toContain('N6 desagregacion ESF');
    expect(hojas).toContain('N7 desagregacion ERI');
    expect(hojas).toContain('PT politicas contables');
    expect(hojas).toContain('PT juicios y estimaciones');
    expect(hojas).toContain('PT partes relacionadas');
    expect(hojas).toContain('PT hechos posteriores');
  });

  it('las notas de juicio salen EN BLANCO: el sistema no redacta ninguna revelación', async () => {
    const wb = await enEmpresa((tx) => generarNotasEstadosFinancieros(tx, EJERCICIO));
    const pt = wb.getWorksheet('PT juicios y estimaciones')!;
    // Localiza la fila de datos y comprueba que las columnas de contenido están vacías.
    let filasDeJuicio = 0;
    pt.eachRow((fila) => {
      const primera = fila.getCell(1).value;
      if (typeof primera === 'string' && primera.startsWith('Juicio (')) {
        filasDeJuicio += 1;
        expect(fila.getCell(2).value ?? '').toBe('');
        expect(fila.getCell(3).value ?? '').toBe('');
      }
    });
    expect(filasDeJuicio).toBeGreaterThan(0);
  });
});

// =============================================================================
describe('A10 · aislamiento y permisos', () => {
  it('los estados de una empresa no ven ni un centavo de otra (Regla de Oro 7)', async () => {
    const esf = await enEmpresa((tx) =>
      calcularEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    const idsPropios = new Set(Object.values(cuentas));
    for (const c of esf.detalle) {
      const esDeLaEmpresa =
        idsPropios.has(c.accountId) || Object.values(e.cuentas).includes(c.accountId);
      expect(esDeLaEmpresa).toBe(true);
    }

    // Y la otra empresa, con exactamente los mismos códigos de cuenta, ve lo suyo.
    const ajeno = await db.asTenant(otra.tenantId, otra.companyId, (tx) =>
      calcularEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
    );
    expect(ajeno.detalle).toHaveLength(0);
  });

  it('generar un estado financiero exige `reporte.exportar` de verdad', async () => {
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => generarEstadoSituacionFinanciera(tx, { fechaCorte: EJERCICIO.hasta }),
        { rolCodigo: 'auxiliar_causacion' },
      ),
    ).rejects.toThrow(PermisoInsuficienteError);
  });
});

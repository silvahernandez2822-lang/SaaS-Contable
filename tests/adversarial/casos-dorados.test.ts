/**
 * A14 — LOS 20 CASOS DORADOS DE LA SECCIÓN 12.
 *
 * NINGUNO SE PUEDE EJECUTAR TODAVÍA, Y NINGUNO SE VA A SIMULAR.
 *
 * Los veinte casos calculan retenciones. Calcular retenciones exige tres cosas
 * que en la Ola 0 no existen a propósito:
 *
 *   · los DATOS normativos (UVT, tarifas, bases, municipios) — los puebla A1
 *     en la Ola 1. Hoy `uvt_value`, `tax_rule` y `municipality_ica_rule` están
 *     creadas y vacías, y así deben estar: la advertencia 17.5 dice que un
 *     valor inventado es peor que uno faltante.
 *   · el MOTOR de resolución determinista — lo construye A3 en la Ola 1.
 *   · el PARSER de la factura UBL — lo construye A4 en la Ola 1.
 *
 * Y dos casos necesitan además una cuarta pieza:
 *   · el caso 18 (reprocesar 10 veces) necesita la causación de punta a punta
 *     (A4 + A3 + A6).
 *   · el caso 19 (cero llamadas al LLM en la segunda factura igual) necesita la
 *     memoria de clasificación de A5, en la Ola 2.
 *
 * Marcar cualquiera de estos veinte en verde hoy sería el falso PASS más caro
 * del proyecto: un caso dorado en verde sin motor de reglas detrás dice que el
 * sistema calcula bien algo que todavía no calcula nada. Por eso quedan como
 * `todo`: el corredor de pruebas los ENUMERA en cada ejecución, sin contarlos
 * como pasados y sin dejar que nadie los olvide.
 *
 * A14 los implementa de verdad al cerrar la Ola 1, que es cuando la sección 12
 * dice que deben estar implementados.
 */
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db.js';

describe('A14 · casos dorados — NO IMPLEMENTADOS TODAVÍA (bloqueados por A1, A3, A4 y A5)', () => {
  it.todo('1 · Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá — [A1+A3, Ola 1]');
  it.todo('2 · Mismo servicio, proveedor PN NO declarante: el eje "tercero" opera — [A1+A3, Ola 1]');
  it.todo('3 · Servicio bajo 2 UVT: no se retiene, y el motivo queda registrado — [A1+A3, Ola 1]');
  it.todo('4 · Compra de bienes bajo 10 UVT: no se retiene, con motivo — [A1+A3, Ola 1]');
  it.todo('5 · Compra de bienes sobre la base, a declarante — [A1+A3, Ola 1]');
  it.todo('6 · Honorarios PJ: retiene desde el primer peso — [A1+A3, Ola 1]');
  it.todo('7 · Arrendamiento de inmueble vs. de mueble por igual valor — [A1+A3, Ola 1]');
  it.todo('8 · ReteICA en Medellín con su tarifa y su base — [A1+A3, Ola 1]');
  it.todo('9 · ReteICA en Cali: base de servicios distinta — [A1+A3, Ola 1]');
  it.todo('10 · Actividad principal en Bogotá, operación en Cali: manda la de Cali — [A1+A3, Ola 1]');
  it.todo('11 · Vigilancia con AIU: la retención va sobre el AIU, no sobre el total — [A1+A3, Ola 1]');
  it.todo('12 · Proveedor del exterior: ReteIVA al 100% — [A1+A3, Ola 1]');
  it.todo('13 · Proveedor régimen SIMPLE: tratamiento parametrizado — [A1+A3, Ola 1]');
  it.todo('14 · Factura con 3 líneas de conceptos distintos, agregación correcta — [A1+A3+A4, Ola 1]');
  it.todo('15 · Nota crédito sobre factura causada: reversa proporcional por asiento nuevo — [A3+A4+A6, Ola 1]');
  it.todo('16 · Factura de 15-jun procesada el 20-jul: aplica la vigencia de junio — [A1+A3, Ola 1]');
  it.todo('17 · Cambio de tarifa con vigencia futura: lo publicado no cambia — [A1+A3, Ola 1] (la mitad de base de datos YA se prueba en compuerta-ola0)');
  it.todo('18 · Reprocesar 10 veces la misma factura: asiento idéntico — [A3+A4+A6, Ola 1]');
  it.todo('19 · Segunda factura igual del mismo proveedor: CERO llamadas al LLM — [A5, Ola 2]');
  it.todo('20 · Usuario del tenant A consulta datos del tenant B: cero filas — [YA PROBADO en compuerta-ola0, COMPUERTA 3]');

  it.todo('Extra · balance de prueba contra el ledger con 10.000 asientos aleatorios — [A9, Ola 3]');
  it.todo('Extra · carga: 5.000 facturas en cola sin degradar el request HTTP — [A6+A13, Ola 2]');
});

describe('A14 · prueba de que los casos dorados NO se pueden estar pasando por accidente', () => {
  it('las tablas normativas existen y están VACÍAS: sin datos no hay cálculo posible, ni verdadero ni falso', async () => {
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

      // Todas creadas (la consulta no reventó) y todas en cero.
      expect(Object.keys(conteos).length).toBe(9);
      for (const [tabla, n] of Object.entries(conteos)) {
        expect(`${tabla}=${n}`).toBe(`${tabla}=0`);
      }
    } finally {
      await db.close();
    }
  });

  it('no existe todavía ningún motor de reglas, parser ni clasificador: no hay dónde esconder un cálculo', async () => {
    const { readdirSync } = await import('node:fs');
    const raiz = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const modulos = readdirSync(raiz).sort();
    // Ola 0 entrega exactamente dos: acceso a datos y seguridad.
    expect(modulos).toEqual(['auth', 'db']);
  });
});

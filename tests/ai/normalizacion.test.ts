/**
 * A5 — El normalizador de la sección 8.3, paso 1.
 *
 * Es una función pura: estas pruebas no tocan la base de datos. Si el patrón
 * dejara de ser estable, la memoria dejaría de acertar y cada factura volvería
 * a costar una llamada al modelo. Por eso se prueban los casos que de verdad
 * varían entre dos facturas del mismo proveedor.
 */
import { describe, expect, it } from 'vitest';
import {
  PATRON_SIN_DESCRIPCION,
  normalizacionMinima,
  normalizarDescripcion,
  patronCanonico,
  patronesDeMemoria,
} from '../../src/ai/normalizar';

describe('A5 · normalización de la descripción', () => {
  it('minúsculas y sin tildes', () => {
    expect(normalizarDescripcion('Servicio de CONSULTORÍA Técnica')).toBe(
      'servicio de consultoria tecnica',
    );
  });

  it('sin fechas, las escriba como las escriba el proveedor', () => {
    const esperado = 'arrendamiento de oficina';
    expect(normalizarDescripcion('Arrendamiento de oficina 15/07/2026')).toBe(esperado);
    expect(normalizarDescripcion('Arrendamiento de oficina 2026-07-15')).toBe(esperado);
    expect(normalizarDescripcion('Arrendamiento de oficina julio 2026')).toBe(esperado);
    expect(normalizarDescripcion('Arrendamiento de oficina AGOSTO 2026')).toBe(esperado);
  });

  it('el mes no sobrevive: si sobreviviera, cada mes pagaría una llamada por el mismo arriendo', () => {
    const meses = ['enero', 'febrero', 'jul', 'dic', 'septiembre'];
    const patrones = meses.map((m) => normalizarDescripcion(`Arriendo bodega ${m}`));
    expect(new Set(patrones).size).toBe(1);
    expect(patrones[0]).toBe('arriendo bodega');
  });

  it('sin números variables: el consecutivo de la factura no entra en el patrón', () => {
    expect(normalizarDescripcion('Mantenimiento preventivo OT-98213')).toBe(
      'mantenimiento preventivo',
    );
    expect(normalizarDescripcion('Mantenimiento preventivo OT-11111')).toBe(
      'mantenimiento preventivo',
    );
    // Y la etiqueta de la referencia se va con el número: sola no dice nada.
    expect(normalizarDescripcion('Mantenimiento preventivo Nro. 4471')).toBe(
      'mantenimiento preventivo',
    );
    expect(normalizarDescripcion('Mantenimiento preventivo, OC 908')).toBe(
      'mantenimiento preventivo',
    );
  });

  it('la puntuación y los espacios de más no cambian el patrón', () => {
    expect(normalizarDescripcion('  Honorarios   jurídicos,  mes  ')).toBe('honorarios juridicos mes');
    expect(normalizarDescripcion('Honorarios jurídicos - mes')).toBe('honorarios juridicos mes');
  });

  it('es idempotente y determinista: normalizar dos veces da lo mismo', () => {
    const original = 'Servicio de VIGILANCIA armada — sede norte, 03/2026';
    const una = normalizarDescripcion(original)!;
    expect(normalizarDescripcion(una)).toBe(una);
    for (let i = 0; i < 20; i += 1) expect(normalizarDescripcion(original)).toBe(una);
  });

  it('una descripción que solo tiene ruido no produce patrón', () => {
    expect(normalizarDescripcion('   ')).toBeNull();
    expect(normalizarDescripcion('12345 - 2026/07/15')).toBeNull();
    expect(normalizarDescripcion(null)).toBeNull();
    expect(patronCanonico(null)).toBe(PATRON_SIN_DESCRIPCION);
  });

  it('el patrón se recorta por frontera de palabra y respeta el límite', () => {
    const largo = `mantenimiento ${'palabra '.repeat(60)}`;
    const patron = normalizarDescripcion(largo)!;
    expect(patron.length).toBeLessThanOrEqual(180);
    expect(patron.endsWith(' ')).toBe(false);
    expect(patron.startsWith('mantenimiento palabra')).toBe(true);
  });

  it('devuelve los dos patrones para no perder la memoria escrita en la Ola 1', () => {
    const patrones = patronesDeMemoria('Servicio de consultoría');
    expect(patrones).toEqual(['servicio de consultoria', 'servicio de consultoría']);
    expect(normalizacionMinima('Servicio de consultoría')).toBe('servicio de consultoría');
  });

  it('cuando las dos normalizaciones coinciden, no se duplica el patrón', () => {
    expect(patronesDeMemoria('servicio de aseo')).toEqual(['servicio de aseo']);
  });

  it('todo patrón cumple lo que la base exige: minúsculas, sin bordes y no vacío', () => {
    const muestras = [
      'Servicio de mantenimiento de equipos de cómputo — julio 2026',
      '  ARRIENDO   Oficina 501  ',
      'Ñoñería técnica S.A.S.',
      'Papelería/útiles',
    ];
    for (const m of muestras) {
      const patron = patronCanonico(m);
      expect(patron).toBe(patron.toLowerCase());
      expect(patron).toBe(patron.trim());
      expect(patron.length).toBeGreaterThan(0);
    }
  });
});

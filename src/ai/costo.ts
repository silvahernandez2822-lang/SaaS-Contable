/**
 * A5 — Costo de una llamada, en millonésimas de USD (Regla de Oro 5: entero).
 *
 * Los precios NO están aquí: se leen de `parametro_clasificacion`, porque el
 * precio de un proveedor de cómputo cambia sin que cambie ninguna norma y A15
 * tiene que poder actualizarlo sin tocar código ni desplegar.
 *
 * La aritmética es entera de punta a punta: nada de flotantes para dinero,
 * aunque sea dinero de infraestructura.
 */

/** Los precios de la tabla vienen por millón de tokens. */
const POR_MILLON = 1_000_000;

export interface PreciosModelo {
  entradaPorMillon: number;
  salidaPorMillon: number;
}

/** Millonésimas de USD de una llamada con ese consumo de tokens. */
export function costoMicrosUsd(
  tokens: { entrada: number; salida: number },
  precios: PreciosModelo,
): number {
  const entrada = Math.ceil((tokens.entrada * precios.entradaPorMillon) / POR_MILLON);
  const salida = Math.ceil((tokens.salida * precios.salidaPorMillon) / POR_MILLON);
  return entrada + salida;
}

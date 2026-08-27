/**
 * A9 — Formato de presentación para los reportes. Sin aritmética de negocio:
 * solo convierte lo que ya calculó la base de datos a algo legible para el
 * contador. Ningún valor tributario nace aquí (Regla de Oro 2).
 */

/** `numeric`/`bigint::text` de PostgreSQL, ya como texto, o null. */
export type TextoONulo = string | null | undefined;

/** Lo que puede llegar a una celda de dinero: texto (`bigint::text`), número, o nada. */
export type CentavosEntrada = string | number | null | undefined;

/**
 * Centavos (texto o número, tal como llegan de `bigint::text`) a pesos, con
 * separador de miles es-CO. La división por 100 es la definición misma de la
 * subunidad monetaria (D-005), no un valor tributario.
 */
export function centavosATextoPesos(centavos: CentavosEntrada): string {
  if (centavos === null || centavos === undefined) return '';
  const valor = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(valor)) return '';
  return (valor / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

/** Centavos a un número de pesos plano, para que Excel lo trate como número (no texto). */
export function centavosANumeroPesos(centavos: CentavosEntrada): number | null {
  if (centavos === null || centavos === undefined) return null;
  const valor = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(valor)) return null;
  return valor / 100;
}

/**
 * `tax_rule.tarifa` / `retention_applied.tarifa` (fracción decimal, p. ej.
 * "0.040000") a un texto porcentual, moviendo el punto decimal en el propio
 * texto en vez de multiplicar en punto flotante.
 */
export function tarifaATextoPorcentaje(tarifaTexto: TextoONulo): string {
  if (tarifaTexto === null || tarifaTexto === undefined || tarifaTexto === '') return '';
  const negativo = tarifaTexto.trim().startsWith('-');
  const limpio = tarifaTexto.trim().replace(/^-/, '');
  const punto = limpio.indexOf('.');
  const parteEntera = punto === -1 ? limpio : limpio.slice(0, punto);
  const parteDecimal = punto === -1 ? '' : limpio.slice(punto + 1);
  // Desplazar el punto decimal dos posiciones a la derecha: fracción -> porcentaje.
  const digitos = (parteEntera + parteDecimal).padStart(3, '0');
  const posicionDesdeElFinal = parteDecimal.length - 2;
  let enteraNueva: string;
  let decimalNueva: string;
  if (posicionDesdeElFinal <= 0) {
    enteraNueva = '0';
    decimalNueva = '0'.repeat(-posicionDesdeElFinal) + digitos;
  } else {
    enteraNueva = digitos.slice(0, digitos.length - posicionDesdeElFinal);
    decimalNueva = digitos.slice(digitos.length - posicionDesdeElFinal);
  }
  enteraNueva = enteraNueva.replace(/^0+(?=\d)/, '');
  decimalNueva = decimalNueva.replace(/0+$/, '');
  const simbolo = '%';
  const cuerpo = decimalNueva === '' ? enteraNueva : `${enteraNueva}.${decimalNueva}`;
  return `${negativo ? '-' : ''}${cuerpo}${simbolo}`;
}

/** Nombre para mostrar de un tercero, con documento. */
export function nombreTercero(razonSocial: string, tipoDocumento: string, numeroDocumento: string): string {
  return `${razonSocial} (${tipoDocumento} ${numeroDocumento})`;
}

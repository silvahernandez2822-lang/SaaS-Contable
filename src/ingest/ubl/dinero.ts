/**
 * Conversión de montos UBL (texto decimal, p. ej. "119000.00") a centavos
 * `bigint` (Regla de Oro 5: el dinero es entero, nunca `float`).
 *
 * Nunca pasa por `Number`/`parseFloat`: aritmética de enteros sobre el texto,
 * para no introducir el error de redondeo binario que la Regla de Oro 5
 * prohíbe. Redondea al centavo con la convención half-up sobre el tercer
 * decimal, cuando el XML trae más de dos decimales (raro en COP, pero UBL lo
 * permite).
 */
export function parseMontoACentavos(valor: string | null | undefined): bigint | null {
  if (valor === null || valor === undefined) return null;
  const t = valor.trim();
  if (t === '') return null;

  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;

  const signo = m[1] === '-' ? -1n : 1n;
  const entero = m[2] ?? '0';
  const fracRaw = m[3] ?? '';
  const frac = fracRaw.padEnd(3, '0');
  const dosDecimales = frac.slice(0, 2);
  const tercerDigito = frac.charCodeAt(2) - 48; // '0'..'9' -> 0..9

  let centavos = BigInt(entero) * 100n + BigInt(dosDecimales);
  if (tercerDigito >= 5) centavos += 1n;

  return signo * centavos;
}

/** Parsea un porcentaje UBL (p. ej. "19.00" -> 19). No divide entre 100: eso lo decide quien lo use. */
export function parsePorcentaje(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const t = valor.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseEntero(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const t = valor.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

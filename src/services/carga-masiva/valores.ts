/**
 * A16 — Conversión de una celda de texto al valor que espera el esquema
 * (Ola 4, Tarea 3).
 *
 * TODO SE HACE CON CADENAS, NUNCA CON `Number` (Regla de Oro 5). Un importe
 * que pase por un `float` de JavaScript ya perdió la partida: `0.1 + 0.2`
 * no es `0.3` y `49799 * 100` es exacto solo por suerte. Aquí los pesos se
 * convierten a centavos moviendo el punto decimal en la cadena, y las tarifas
 * a fracción moviéndolo en la otra dirección. El resultado se entrega como
 * cadena y PostgreSQL lo interpreta como `bigint` o `numeric`, que sí son
 * exactos.
 *
 * NO SE ADIVINA EL SEPARADOR DE MILES. «1.500» es mil quinientos en Colombia y
 * uno coma cinco en el resto del mundo, y no hay forma honesta de decidir cuál
 * quiso escribir el contador. Se rechaza y se le pide que lo quite. Un importe
 * mal interpretado en un motor tributario es peor que un importe faltante: el
 * faltante se ve, el equivocado no.
 */

export class ValorInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ValorInvalidoError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOLO_DIGITOS = /^\d+$/;
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** Verdaderos y falsos que un contador escribe de verdad en una celda. */
const VERDADEROS = new Set(['si', 'sí', 'true', 'verdadero', 'x', '1', 'y', 'yes']);
const FALSOS = new Set(['no', 'false', 'falso', '0', 'n']);

export function textoObligatorio(valor: string, columna: string): string {
  const v = (valor ?? '').trim();
  if (v === '') throw new ValorInvalidoError(`"${columna}" es obligatoria y vino vacía.`);
  return v;
}

export function textoOpcional(valor: string): string | null {
  const v = (valor ?? '').trim();
  return v === '' ? null : v;
}

export function booleano(valor: string, columna: string): boolean {
  const v = (valor ?? '').trim().toLowerCase();
  if (VERDADEROS.has(v)) return true;
  if (FALSOS.has(v)) return false;
  throw new ValorInvalidoError(
    `"${columna}" debe decir SI o NO; vino ${JSON.stringify(valor)}. ` +
      'No se asume ningún valor por omisión: una bandera fiscal supuesta cambia la retención.',
  );
}

export function booleanoOpcional(valor: string, columna: string, porDefecto: boolean): boolean {
  return (valor ?? '').trim() === '' ? porDefecto : booleano(valor, columna);
}

export function entero(valor: string, columna: string, min?: number, max?: number): number {
  const v = (valor ?? '').trim();
  if (!SOLO_DIGITOS.test(v)) {
    throw new ValorInvalidoError(`"${columna}" debe ser un número entero sin puntos ni comas; vino ${JSON.stringify(valor)}.`);
  }
  const n = Number(v);
  if (min !== undefined && n < min) throw new ValorInvalidoError(`"${columna}" no puede ser menor que ${min}.`);
  if (max !== undefined && n > max) throw new ValorInvalidoError(`"${columna}" no puede ser mayor que ${max}.`);
  return n;
}

export function fechaIso(valor: string, columna: string): string {
  const v = (valor ?? '').trim();
  if (ISO_DATE.test(v)) return v;
  // Excel en español a veces entrega dd/mm/aaaa como texto.
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (m) {
    const [, d, mes, a] = m as unknown as [string, string, string, string];
    return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  throw new ValorInvalidoError(
    `"${columna}" debe ser una fecha AAAA-MM-DD (por ejemplo 2026-01-01); vino ${JSON.stringify(valor)}.`,
  );
}

export function fechaIsoOpcional(valor: string, columna: string): string | null {
  return (valor ?? '').trim() === '' ? null : fechaIso(valor, columna);
}

/** Mueve el punto decimal `n` posiciones a la derecha, sobre la cadena. */
function correrDecimalDerecha(entero: string, decimales: string, n: number): string {
  const digitos = entero + decimales.padEnd(n, '0');
  const corte = entero.length + n;
  const parteEntera = digitos.slice(0, corte).replace(/^0+(?=\d)/, '');
  const resto = decimales.slice(n);
  if (resto.replace(/0+$/, '') !== '') {
    throw new ValorInvalidoError(
      `El valor ${entero}.${decimales} tiene más decimales de los que admite este campo (${n}).`,
    );
  }
  return parteEntera === '' ? '0' : parteEntera;
}

/**
 * Forma de un número escrito CON separador de miles: grupos de tres dígitos
 * detrás de un punto o una coma. Se rechaza sin intentar interpretarlo.
 *
 * Es el caso que destapó la prueba de la Ola 4: sin esta comprobación,
 * `250.000` pasaba el patrón decimal como «250 con 000 decimales» y moría con
 * un mensaje sobre decimales que no le dice nada al usuario; y `1.500` habría
 * entrado como UN PESO CON CINCUENTA en vez de mil quinientos, en silencio.
 * Eso es exactamente el importe mal interpretado que la cabecera de este
 * archivo dice que es peor que el importe faltante.
 *
 * El patrón exige que la parte entera NO empiece por cero: «0,025» es una
 * tarifa escrita como fracción y no tiene nada de ambiguo — nadie agrupa
 * millares detrás de un cero.
 */
const CON_SEPARADOR_DE_MILES = /^[1-9]\d{0,2}(?:[.,]\d{3})+$/;

function partir(valor: string, columna: string): { entero: string; decimales: string } {
  const v = (valor ?? '').trim().replace(/\s/g, '');
  if (CON_SEPARADOR_DE_MILES.test(v) || !DECIMAL.test(v)) {
    throw new ValorInvalidoError(
      `"${columna}" debe ser un número sin separador de miles; vino ${JSON.stringify(valor)}. ` +
        'Escriba 250000 o 250000,50 — nunca 250.000, porque no hay forma de saber si el punto separa miles o decimales.',
    );
  }
  const [ent, dec = ''] = v.replace(',', '.').split('.') as [string, string?];
  return { entero: ent, decimales: dec };
}

/**
 * Pesos colombianos → centavos enteros (D-005). "250000" → "25000000";
 * "1234,56" → "123456". Devuelve cadena: nunca pasa por un `number`.
 */
export function pesosACentavos(valor: string, columna: string): string {
  const { entero: ent, decimales } = partir(valor, columna);
  if (decimales.length > 2) {
    throw new ValorInvalidoError(`"${columna}" no puede tener más de dos decimales (son centavos).`);
  }
  return correrDecimalDerecha(ent, decimales, 2);
}

export function pesosACentavosOpcional(valor: string, columna: string): string | null {
  return (valor ?? '').trim() === '' ? null : pesosACentavos(valor, columna);
}

/**
 * Tarifa → FRACCIÓN, tal como la guarda `tax_rule.tarifa` (D-005).
 * Admite las dos formas en que un contador la escribe: como fracción decimal
 * con coma, o como porcentaje añadiendo el signo de por ciento al final. Ese
 * signo no es decorativo: cambia el valor por cien, así que se exige
 * escribirlo cuando se quiere decir porcentaje.
 */
export function tarifaAFraccion(valor: string, columna: string): string {
  const crudo = (valor ?? '').trim();
  const esPorcentaje = crudo.endsWith('%');
  const { entero: ent, decimales } = partir(esPorcentaje ? crudo.slice(0, -1) : crudo, columna);

  const digitos = ent + decimales;
  const puntoDesde = ent.length;
  const puntoNuevo = esPorcentaje ? puntoDesde - 2 : puntoDesde;
  const relleno = puntoNuevo < 0 ? '0'.repeat(-puntoNuevo) : '';
  const completo = relleno + digitos;
  const corte = puntoNuevo < 0 ? 0 : puntoNuevo;
  const parteEntera = completo.slice(0, corte) || '0';
  const parteDecimal = completo.slice(corte).replace(/0+$/, '');
  const resultado = parteDecimal === '' ? parteEntera : `${parteEntera}.${parteDecimal}`;

  // `tax_rule.tarifa` es numeric(9,6) CHECK BETWEEN 0 AND 1. Se comprueba aquí
  // para dar un mensaje con nombre de columna en vez de un 23514 pelado.
  const [pe, pd = ''] = resultado.split('.') as [string, string?];
  if (pe !== '0' && pe !== '1') {
    throw new ValorInvalidoError(
      `"${columna}" da una tarifa de ${resultado}, que es mayor que uno — o sea, más que el total. Si quiso ` +
        'escribir un porcentaje, añádale el signo de por ciento al final; sin él, el número se toma como fracción.',
    );
  }
  if (pe === '1' && pd.replace(/0+$/, '') !== '') {
    throw new ValorInvalidoError(
      `"${columna}" da una tarifa de ${resultado}, que es mayor que uno — o sea, más que el total.`,
    );
  }
  if (pd.length > 6) {
    throw new ValorInvalidoError(`"${columna}" tiene más de seis decimales de fracción, que es lo que admite la base.`);
  }
  return resultado;
}

export function tarifaAFraccionOpcional(valor: string, columna: string): string | null {
  return (valor ?? '').trim() === '' ? null : tarifaAFraccion(valor, columna);
}

/** Número decimal tal cual (UVT de una base mínima, rangos del art. 383). */
export function decimal(valor: string, columna: string): string {
  const { entero: ent, decimales } = partir(valor, columna);
  return decimales === '' ? ent : `${ent}.${decimales}`;
}

export function decimalOpcional(valor: string, columna: string): string | null {
  return (valor ?? '').trim() === '' ? null : decimal(valor, columna);
}

/** Valor de una lista cerrada. Se compara en minúsculas y sin tildes. */
export function deLista<T extends string>(
  valor: string,
  columna: string,
  admitidos: readonly T[],
  obligatoria = true,
): T | null {
  const v = (valor ?? '').trim();
  if (v === '') {
    if (obligatoria) throw new ValorInvalidoError(`"${columna}" es obligatoria y vino vacía.`);
    return null;
  }
  const normal = v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const hallado = admitidos.find(
    (a) =>
      a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === normal,
  );
  if (!hallado) {
    throw new ValorInvalidoError(
      `"${columna}" solo admite ${admitidos.map((a) => `"${a}"`).join(', ')}; vino ${JSON.stringify(valor)}.`,
    );
  }
  return hallado;
}

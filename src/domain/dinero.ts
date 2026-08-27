/**
 * A3 — Aritmética entera del motor (Regla de Oro 5: el dinero es entero).
 *
 * Nada de este archivo conoce una sola tarifa ni una sola base: solo sabe
 * multiplicar enteros escalados y redondear según un modo y un múltiplo que
 * vienen de `rounding_rule`.
 *
 * Por qué BigInt y no `number`: `numeric(9,6)` por `bigint` de centavos puede
 * desbordar el entero seguro de IEEE-754 a mitad del producto intermedio, y un
 * error de un centavo en una retención es un error de verdad. Se calcula en
 * BigInt y se vuelve a `number` solo al final, comprobando el rango.
 */

/** Escala de `tax_rule.tarifa`: numeric(9,6). */
export const ESCALA_TARIFA = 10n ** 6n;
/** Escala de las bases mínimas expresadas en UVT: numeric(12,4). */
export const ESCALA_UVT = 10n ** 4n;

const DECIMAL = /^\s*(-)?(\d+)(?:\.(\d*))?\s*$/;

/**
 * Convierte el texto de un `numeric` de PostgreSQL en un entero escalado, sin
 * pasar jamás por punto flotante. `"0.040000"` con escala 1e6 da `40000n`.
 *
 * Si el valor trae más decimales que la escala, se rechaza en vez de truncar
 * en silencio: truncar una tarifa sería inventar una tarifa distinta.
 */
export function aEnteroEscalado(valor: string | number | null | undefined, escala: bigint): bigint | null {
  if (valor === null || valor === undefined) return null;
  const texto = typeof valor === 'number' ? valor.toString() : valor;
  const m = DECIMAL.exec(texto);
  if (!m) throw new Error(`No es un decimal válido: ${JSON.stringify(texto)}`);
  const signo = m[1] === '-' ? -1n : 1n;
  const entero = BigInt(m[2] ?? '');
  const decimales = m[3] ?? '';
  const digitosEscala = escala.toString().length - 1;
  if (decimales.length > digitosEscala) {
    throw new Error(
      `El valor ${JSON.stringify(texto)} tiene más decimales de los que admite la escala ` +
        `${escala.toString()}. El motor no trunca valores paramétricos.`,
    );
  }
  const relleno = decimales.padEnd(digitosEscala, '0');
  return signo * (entero * escala + BigInt(relleno === '' ? '0' : relleno));
}

/** Devuelve el texto canónico de un entero escalado: `40000n` con 1e6 da `"0.040000"`. */
export function aTextoDecimal(escalado: bigint, escala: bigint): string {
  const digitos = escala.toString().length - 1;
  const negativo = escalado < 0n;
  const abs = negativo ? -escalado : escalado;
  const entero = abs / escala;
  const resto = (abs % escala).toString().padStart(digitos, '0');
  return `${negativo ? '-' : ''}${entero.toString()}${digitos > 0 ? `.${resto}` : ''}`;
}

/** Lee un `bigint` de PostgreSQL (que llega como texto o número) sin perder precisión. */
export function aEntero(valor: string | number | bigint | null | undefined): bigint | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'bigint') return valor;
  if (typeof valor === 'number') {
    if (!Number.isInteger(valor)) throw new Error(`Se esperaba un entero y llegó ${valor}.`);
    return BigInt(valor);
  }
  const texto = valor.trim();
  if (!/^-?\d+$/.test(texto)) throw new Error(`No es un entero: ${JSON.stringify(valor)}`);
  return BigInt(texto);
}

/** Vuelve a `number` comprobando que el valor cabe en el entero seguro. */
export function aNumeroSeguro(valor: bigint, contexto: string): number {
  if (valor > BigInt(Number.MAX_SAFE_INTEGER) || valor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${contexto}: el valor ${valor.toString()} no cabe en un entero seguro.`);
  }
  return Number(valor);
}

/** Modos de `rounding_rule.modo`. El motor no elige ninguno: lo elige el parámetro. */
export type ModoRedondeo = 'half_up' | 'half_even' | 'truncar' | 'techo' | 'piso';

export const MODOS_REDONDEO: readonly ModoRedondeo[] = [
  'half_up',
  'half_even',
  'truncar',
  'techo',
  'piso',
];

export function esModoRedondeo(valor: string): valor is ModoRedondeo {
  return (MODOS_REDONDEO as readonly string[]).includes(valor);
}

/**
 * Redondea `valor` al múltiplo `unidad` con el modo indicado. Ambos en la misma
 * unidad, sea la que sea (centavos, o centavos escalados por la tarifa).
 *
 * Trabaja sobre magnitudes no negativas —las retenciones lo son— y sobre
 * negativas se comporta simétricamente respecto al cero, que es lo que espera
 * quien mira una reversa.
 */
export function redondearA(valor: bigint, unidad: bigint, modo: ModoRedondeo): bigint {
  if (unidad <= 0n) throw new Error('El múltiplo de redondeo debe ser positivo.');
  const negativo = valor < 0n;
  const abs = negativo ? -valor : valor;
  const cociente = abs / unidad;
  const resto = abs % unidad;
  let ajustado: bigint;
  if (resto === 0n) {
    ajustado = cociente;
  } else {
    switch (modo) {
      case 'truncar':
      case 'piso':
        ajustado = cociente;
        break;
      case 'techo':
        ajustado = cociente + 1n;
        break;
      case 'half_up':
        ajustado = resto * 2n >= unidad ? cociente + 1n : cociente;
        break;
      case 'half_even': {
        const doble = resto * 2n;
        if (doble > unidad) ajustado = cociente + 1n;
        else if (doble < unidad) ajustado = cociente;
        else ajustado = cociente % 2n === 0n ? cociente : cociente + 1n;
        break;
      }
      default: {
        const inalcanzable: never = modo;
        throw new Error(`Modo de redondeo desconocido: ${String(inalcanzable)}`);
      }
    }
  }
  const resultado = ajustado * unidad;
  return negativo ? -resultado : resultado;
}

export interface CalculoRetencion {
  /** Valor final, redondeado según la regla configurada, en centavos. */
  valor: bigint;
  /** Valor antes del redondeo, truncado a centavos. */
  valorSinRedondeo: bigint;
}

/**
 * Aplica una tarifa escalada a una base en centavos y redondea.
 *
 * El producto se mantiene en "centavos escalados por la tarifa" hasta el
 * final: así el redondeo se hace una sola vez, sobre el valor exacto, y no
 * sobre un valor ya truncado. Redondear dos veces es la forma más común de
 * perder un peso.
 */
export function calcularRetencion(
  baseCentavos: bigint,
  tarifaEscalada: bigint,
  multiploCentavos: bigint,
  modo: ModoRedondeo,
): CalculoRetencion {
  const producto = baseCentavos * tarifaEscalada;
  const unidad = multiploCentavos * ESCALA_TARIFA;
  const redondeado = redondearA(producto, unidad, modo);
  return {
    valor: redondeado / ESCALA_TARIFA,
    valorSinRedondeo: producto / ESCALA_TARIFA,
  };
}

/**
 * Convierte una cantidad expresada en UVT (escala 1e4) al valor en centavos
 * usando la UVT vigente a la fecha del hecho. No redondea: la sección 12
 * expresa las bases mínimas como el producto exacto (2 UVT son exactamente dos
 * veces la UVT). Si algún día una norma exige redondear el umbral al mil, eso
 * será una regla de redondeo parametrizada, no una decisión de este archivo.
 */
export function uvtACentavos(cantidadUvtEscalada: bigint, uvtCentavos: bigint): bigint {
  return (cantidadUvtEscalada * uvtCentavos) / ESCALA_UVT;
}

/** Reparte proporcionalmente un valor: `valor * numerador / denominador`, redondeado. */
export function proporcion(
  valor: bigint,
  numerador: bigint,
  denominador: bigint,
  multiploCentavos: bigint,
  modo: ModoRedondeo,
): bigint {
  if (denominador === 0n) throw new Error('Proporción con denominador cero.');
  if (numerador === denominador) return valor;
  const producto = valor * numerador;
  const unidad = multiploCentavos * denominador;
  return redondearA(producto, unidad, modo) / denominador;
}

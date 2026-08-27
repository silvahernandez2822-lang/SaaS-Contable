/**
 * A5 — Normalización de la descripción (sección 8.3, paso 1).
 *
 * «Se normaliza la descripción (minúsculas, sin tildes, sin números variables,
 *  sin fechas).»
 *
 * Es una función PURA y determinista: la misma descripción produce el mismo
 * patrón hoy, dentro de seis meses y en cualquier máquina. De eso depende que
 * la memoria acierte y, por lo tanto, que no se gaste un token.
 *
 * POR QUÉ SE BORRA TODO TOKEN QUE LLEVE UN DÍGITO. En la descripción de una
 * compra, un dígito casi siempre codifica algo que cambia de factura en
 * factura: el período facturado, el número de la orden, la cantidad, el
 * consumo del medidor, el mes. Lo que la memoria mapea es un CONCEPTO —qué se
 * compró—, no un importe ni un período, así que la variación numérica es ruido
 * que rompería el acierto. El caso límite conocido es el de un token
 * alfanumérico que sí describe el producto («papel a4», «internet 100 megas»);
 * incluso ahí el concepto de causación es el mismo, que es lo único que este
 * patrón decide.
 *
 * POR QUÉ TAMBIÉN SE BORRAN LOS NOMBRES DE MES. «Arrendamiento oficina julio»
 * y «Arrendamiento oficina agosto» son la misma operación recurrente. Si el
 * mes sobreviviera al patrón, cada mes del año pagaría una llamada al modelo
 * por el mismo arriendo de siempre.
 *
 * COMPATIBILIDAD CON LA OLA 1. A6 escribió memoria con una normalización
 * mínima (minúsculas + trim, D-013). Esas filas no se reescriben: llevan
 * `normalizador_version = 1` y `patronesDeMemoria` devuelve los dos patrones
 * para que una factura encuentre su entrada la haya escrito quien la haya
 * escrito.
 */

/** Versión del normalizador que produce `patronDescripcion`. Se persiste. */
export const VERSION_NORMALIZADOR = 2;

/** Patrón que se usa cuando la línea no trae ninguna descripción utilizable. */
export const PATRON_SIN_DESCRIPCION = 'sin descripcion';

/** Longitud máxima del patrón. Acota el índice y el tamaño del prompt. */
const LARGO_MAXIMO_PATRON = 180;

/**
 * Nombres de mes y sus abreviaturas usuales en facturación colombiana.
 * No es un calendario tributario: no hay ni una fecha de vencimiento aquí,
 * solo las palabras que hay que borrar para que el patrón no lleve el mes.
 */
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'sept',
  'oct',
  'nov',
  'dic',
];

const MESES_SET = new Set(MESES);

/**
 * Prefijos de referencia documental. Van SIEMPRE pegados a un número que el
 * paso anterior ya borró («OT-4471», «OC 908», «Nro. 12»), así que lo que
 * queda es una etiqueta huérfana que cambia de factura en factura sin decir
 * nada sobre qué se compró. La lista es cerrada y corta a propósito: no se
 * borra ninguna palabra que pueda ser el objeto de la compra.
 */
const REFERENCIAS = new Set(['ot', 'oc', 'op', 'nro', 'num', 'ref', 'cod', 'consecutivo']);

/** Fechas escritas con separadores: 15/07/2026, 2026-07-15, 15.7.26. */
const FECHA_CON_SEPARADORES = /\b\d{1,4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,4}\b/g;

/** Quita tildes y diacríticos, conservando la letra base (ñ -> n). */
function sinDiacriticos(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Normaliza una descripción al patrón de memoria de la sección 8.3.
 * Devuelve `null` cuando no queda nada estable con lo que indexar.
 */
export function normalizarDescripcion(descripcion: string | null | undefined): string | null {
  if (descripcion === null || descripcion === undefined) return null;

  let texto = sinDiacriticos(descripcion).toLowerCase();

  // 1. Fechas con separadores, antes de que la puntuación se convierta en espacio.
  texto = texto.replace(FECHA_CON_SEPARADORES, ' ');

  // 2. Toda puntuación pasa a ser separador. Quedan letras, dígitos y espacios.
  texto = texto.replace(/[^a-z0-9]+/g, ' ');

  // 3. Fuera los tokens con dígitos y los nombres de mes.
  const tokens = texto
    .split(' ')
    .filter((t) => t !== '')
    .filter((t) => !/\d/.test(t))
    .filter((t) => !MESES_SET.has(t))
    .filter((t) => !REFERENCIAS.has(t));

  const patron = tokens.join(' ').trim();
  if (patron === '') return null;
  if (patron.length <= LARGO_MAXIMO_PATRON) return patron;

  // 4. Recorte por frontera de palabra, para que el patrón no dependa de si
  //    la última palabra cupo entera.
  const recortado = patron.slice(0, LARGO_MAXIMO_PATRON);
  const corte = recortado.lastIndexOf(' ');
  return (corte > 0 ? recortado.slice(0, corte) : recortado).trim();
}

/**
 * Normalización MÍNIMA de la Ola 1 (D-013): minúsculas + trim. Se conserva
 * para poder leer las entradas de memoria escritas antes de esta ola.
 */
export function normalizacionMinima(descripcion: string | null | undefined): string | null {
  if (descripcion === null || descripcion === undefined) return null;
  const minima = descripcion.toLowerCase().trim();
  return minima === '' ? null : minima;
}

/**
 * Los patrones con los que se consulta la memoria, en orden de preferencia:
 * primero el de la sección 8.3 completa, después el mínimo de la Ola 1.
 * Sin duplicados y sin nulos.
 */
export function patronesDeMemoria(descripcion: string | null | undefined): string[] {
  const patrones: string[] = [];
  const completo = normalizarDescripcion(descripcion);
  if (completo !== null) patrones.push(completo);
  const minimo = normalizacionMinima(descripcion);
  if (minimo !== null && !patrones.includes(minimo)) patrones.push(minimo);
  return patrones;
}

/** El patrón canónico con el que se ESCRIBE en memoria (nunca el mínimo). */
export function patronCanonico(descripcion: string | null | undefined): string {
  return normalizarDescripcion(descripcion) ?? PATRON_SIN_DESCRIPCION;
}

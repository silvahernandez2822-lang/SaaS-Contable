/**
 * A11 — Serialización al archivo plano (el "layout que exige la resolución
 * vigente"). Delimitado por `|`, una fila por registro, sin comillas ni
 * separador de miles: es el formato de texto que el prevalidador tributario
 * de la DIAN espera para cargar información exógena.
 *
 * ADVERTENCIA QUE ESTE AGENTE DEJA EXPLÍCITA (advertencia 17.5 del mega-
 * prompt): el orden EXACTO de columnas y, sobre todo, los CÓDIGOS NUMÉRICOS
 * que la DIAN usa para "tipo de documento" y para "concepto" dentro de cada
 * formato están publicados en el anexo técnico de la Resolución 000227 de
 * 2025, un documento que este agente no tuvo disponible para verificar. Por
 * eso ningún código numérico DIAN se inventa aquí: se exportan los campos
 * REALES de `third_party`/`concepto_causacion` en texto (p. ej. "NIT", no
 * "31"), y cada archivo generado lleva un encabezado de advertencia que dice
 * exactamente esto, para que el contador no lo presente sin cotejarlo antes
 * contra el anexo técnico vigente.
 */

export interface ColumnaPlano<T> {
  header: string;
  obtener: (fila: T) => string;
}

const DELIMITADOR = '|';

export const ADVERTENCIA_LAYOUT_NO_VERIFICADO =
  '# ADVERTENCIA: el orden de columnas sigue la estructura general de los formatos de exogena de la DIAN, ' +
  'pero los codigos numericos de "tipo de documento" y "concepto" de la Resolucion 000227 de 2025 NO fueron ' +
  'verificados contra el anexo tecnico (no estaba disponible para este agente). Coteje este archivo contra el ' +
  'anexo tecnico vigente antes de presentarlo al prevalidador de la DIAN.';

/**
 * `centavos` (BigInt en texto, D-005) a pesos ENTEROS en texto, redondeando
 * al peso más cercano con aritmética de enteros (nunca `float`, Regla de Oro
 * 5): es división entera con medio punto hacia arriba, no
 * `Math.round(n / 100)`.
 */
export function centavosAPesosEnteroTexto(centavosTexto: string | null | undefined): string {
  if (centavosTexto === null || centavosTexto === undefined || centavosTexto === '') return '0';
  const negativo = centavosTexto.trim().startsWith('-');
  const centavos = BigInt(negativo ? centavosTexto.trim().slice(1) : centavosTexto.trim());
  const pesos = (centavos + 50n) / 100n;
  return negativo ? `-${pesos.toString()}` : pesos.toString();
}

/** Arma el texto plano completo: advertencia, encabezado de columnas y filas. */
export function construirPlano<T>(
  formatoCodigo: string,
  columnas: ColumnaPlano<T>[],
  filas: readonly T[],
  advertenciasAdicionales: readonly string[] = [],
): string {
  const lineas: string[] = [
    `# Formato ${formatoCodigo} — generado por contable-co`,
    ADVERTENCIA_LAYOUT_NO_VERIFICADO,
    ...advertenciasAdicionales.map((a) => `# ${a}`),
    columnas.map((c) => c.header).join(DELIMITADOR),
  ];
  for (const fila of filas) {
    lineas.push(columnas.map((c) => c.obtener(fila)).join(DELIMITADOR));
  }
  return lineas.join('\n') + '\n';
}

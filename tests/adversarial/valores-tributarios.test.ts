/**
 * A14 — REGLA DE ORO 2: cero valores tributarios en el código fuente.
 *
 * «Ninguna tarifa, base mínima, valor de UVT, salario mínimo, porcentaje, tope
 *  o calendario puede estar escrito en el código fuente.»
 *
 * El barrido corre sobre `src/`, `app/` y `db/migrations/`, que es donde puede
 * esconderse un valor. Se ignoran los COMENTARIOS: un comentario que explique
 * «2,5% se guarda como 0.025000» documenta el formato, no fija una tarifa. Lo
 * que se persigue es el literal ejecutable.
 *
 * En la Ola 0 esto tiene que dar CERO por partida doble: además de la Regla 2,
 * es que A1 todavía no ha poblado NADA. Un solo hallazgo hoy significa que
 * alguien inventó un dato normativo, que es lo que la advertencia 17.5 llama
 * peor que un dato faltante: el faltante se ve, el inventado no.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIRECTORIOS = ['src', 'app', 'db/migrations'];
const EXTENSIONES = ['.ts', '.tsx', '.js', '.mjs', '.sql'];

interface Linea {
  archivo: string;
  numero: number;
  texto: string;
}

/**
 * Quita comentarios de bloque y de línea, conservando la numeración.
 *
 * `COMMENT ON ... IS '...'` cuenta como comentario: es documentación del
 * esquema, no un valor que el motor use para calcular nada. Explicar en un
 * COMMENT que la UVT se guarda en centavos es exactamente lo contrario de
 * quemar la UVT.
 */
function sinComentarios(contenido: string): string[] {
  const sinBloque = contenido.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const sinCommentOn = sinBloque.replace(/COMMENT\s+ON\s+[\s\S]*?;/gi, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  return sinCommentOn.split(/\r?\n/).map((linea) => linea.replace(/(--|\/\/).*$/, ''));
}

function recolectar(dir: string, acumulado: Linea[]): void {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return; // `app/` todavía no existe: no es un fallo, es la Ola 0.
  }
  for (const entrada of entradas) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === 'node_modules' || entrada.startsWith('.')) continue;
      recolectar(ruta, acumulado);
      continue;
    }
    if (!EXTENSIONES.some((e) => entrada.endsWith(e))) continue;
    const relativa = relative(RAIZ, ruta).replace(/\\/g, '/');
    sinComentarios(readFileSync(ruta, 'utf8')).forEach((texto, i) => {
      if (texto.trim() !== '') acumulado.push({ archivo: relativa, numero: i + 1, texto });
    });
  }
}

const LINEAS: Linea[] = [];
for (const d of DIRECTORIOS) recolectar(join(RAIZ, d), LINEAS);

function informar(hallazgos: Linea[]): string[] {
  return hallazgos.map((l) => `${l.archivo}:${l.numero}  ${l.texto.trim()}`);
}

describe('A14 · Regla de Oro 2 — ni un valor tributario quemado en el código', () => {
  it('el barrido encontró código que analizar (si no, la prueba no probaría nada)', () => {
    expect(LINEAS.length).toBeGreaterThan(1500);
    expect(new Set(LINEAS.map((l) => l.archivo)).size).toBeGreaterThan(15);
  });

  it('ninguna fracción decimal con pinta de tarifa (0,xxx) fuera de un comentario', () => {
    // 2,5% se escribe 0.025000; 2 por mil, 0.002000. Cualquier `0.<algo>` en
    // código ejecutable es sospechoso por definición.
    const patron = /(^|[^\w.])0\.\d+/;
    const hallazgos = LINEAS.filter((l) => patron.test(l.texto));
    expect(informar(hallazgos)).toEqual([]);
  });

  it('ningún porcentaje literal', () => {
    const patron = /\d+([.,]\d+)?\s*%/;
    const hallazgos = LINEAS.filter((l) => patron.test(l.texto));
    expect(informar(hallazgos)).toEqual([]);
  });

  it('ningún número grande cerca de una palabra tributaria', () => {
    // Un entero de cinco cifras o más a menos de 60 caracteres de "uvt",
    // "tarifa", "retefuente", "salario"... es un valor normativo disfrazado.
    const palabra =
      /(uvt|smmlv|salario_?minimo|salario minimo|retefuente|reteica|reteiva|autorretenci|tarifa|base_?minima|tope|sancion)/i;
    const numeroGrande = /(^|[^\w.])\d{5,}(?![\w.])/;
    const hallazgos = LINEAS.filter((l) => {
      if (!palabra.test(l.texto)) return false;
      const m = palabra.exec(l.texto)!;
      const ventana = l.texto.slice(Math.max(0, m.index - 60), m.index + 60);
      return numeroGrande.test(ventana);
    });
    expect(informar(hallazgos)).toEqual([]);
  });

  it('ninguna magnitud conocida de UVT o de salario mínimo, esté donde esté', () => {
    // Valores reales de referencia de los últimos años, en pesos y en centavos.
    // Que aparezca cualquiera de ellos en el código es un dato normativo
    // quemado, aunque la variable se llame `x`.
    const magnitudes = [
      '42412', '47065', '49799', '52374', // UVT 2023-2026, en pesos
      '4241200', '4706500', '4979900', '5237400', // los mismos, en centavos
      '1160000', '1300000', '1423500', // SMMLV
      '116000000', '130000000', '142350000',
    ];
    const hallazgos = LINEAS.filter((l) =>
      magnitudes.some((m) => new RegExp(`(^|[^\\d])${m}([^\\d]|$)`).test(l.texto)),
    );
    expect(informar(hallazgos)).toEqual([]);
  });

  it('ninguna constante ni DEFAULT que fije un valor tributario', () => {
    // Dos formas: una constante cuyo NOMBRE es tributario y lleva número, o
    // cualquier constante / DEFAULT cuyo VALOR es una fracción decimal.
    // `LONGITUD_CLAVE = 32` no es una tarifa; `TARIFA_SERVICIOS = 0.04` sí.
    const nombreTributario =
      /(const|let|var)\s+\w*(UVT|SMMLV|TARIFA|RETEFUENTE|RETEICA|RETEIVA|SALARIO|BASE_MINIMA|TOPE)\w*\s*(:\s*[\w<>[\]]+\s*)?=\s*[\d.]/i;
    const valorFraccion = /(const|let|var)\s+\w+\s*(:\s*[\w<>[\]]+\s*)?=\s*0?\.\d/i;
    const defaultFraccion = /DEFAULT\s+0?\.\d/i;
    const hallazgos = LINEAS.filter(
      (l) => nombreTributario.test(l.texto) || valorFraccion.test(l.texto) || defaultFraccion.test(l.texto),
    );
    expect(informar(hallazgos)).toEqual([]);
  });

  it('las tablas paramétricas están CREADAS pero VACÍAS: A2 crea el continente, A1 traerá el contenido', () => {
    // El complemento del grep. Si alguien poblara una tarifa desde una
    // migración, el grep de arriba lo vería; esto verifica lo contrario: que
    // nadie haya metido un INSERT de datos normativos en ninguna parte.
    const patron =
      /INSERT\s+INTO\s+(uvt_value|smmlv_value|tax_rule|tax_concept|municipality_ica_rule|ciiu_activity|rounding_rule|tax_calendar)\b/i;
    const hallazgos = LINEAS.filter((l) => patron.test(l.texto));
    expect(informar(hallazgos)).toEqual([]);
  });
});

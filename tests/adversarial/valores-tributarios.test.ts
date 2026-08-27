/**
 * A14 — REGLA DE ORO 2: cero valores tributarios en el código fuente.
 *
 * «Ninguna tarifa, base mínima, valor de UVT, salario mínimo, porcentaje, tope
 *  o calendario puede estar escrito en el código fuente.»
 *
 * QUÉ SE BARRE Y QUÉ NO (revisado por A14 al cerrar la Ola 1, D-039):
 *
 *  · `src/`, `app/` y `db/migrations/` SÍ se barren. Ahí no puede vivir ni un
 *    valor normativo: son código y estructura.
 *  · `db/seeds/` NO se barre, y es deliberado: desde la Ola 1 ahí viven las
 *    tarifas REALES que cargó A1. Un `INSERT INTO tax_rule (... 0.040000 ...)`
 *    en un archivo de seeds es el dato EN SU SITIO — es exactamente lo que la
 *    Regla 2 exige (que el valor viva en una tabla paramétrica, no en el
 *    código). Lo prohibido es el valor quemado en una ruta ejecutable.
 *
 *    Para que esa exclusión no sea una puerta trasera, se comprueba aparte que
 *    `db/seeds/` sea SOLO datos: únicamente archivos `.sql`, sin una sola línea
 *    de código (`CREATE FUNCTION`, `DO $$`), y sin `UPDATE`/`DELETE` sobre las
 *    tablas paramétricas —que además violaría la Regla 3, porque editar un
 *    parámetro inserta una vigencia nueva y jamás actualiza la anterior—.
 *
 * Se ignoran los COMENTARIOS: un comentario que explique «2,5% se guarda como
 * 0.025000» documenta el formato, no fija una tarifa. Lo que se persigue es el
 * literal ejecutable.
 *
 * Las seis reglas del detector viven en `REGLAS`, una sola vez, y las usan
 * tanto el barrido real como el CANARIO: el canario les pasa código con
 * tarifas y UVT de verdad y exige que las cacen. Si alguien afloja una regla
 * para que el barrido calle, el canario falla.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createTestDb } from '../helpers/db.js';
import { ESCALA_TARIFA, ESCALA_UVT } from '../../src/domain/dinero.js';

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
    return; // `app/` todavía no existe: lo construye A7 en la Ola 2.
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

// =============================================================================
// LAS SEIS REGLAS DEL DETECTOR — una sola definición, dos usos (barrido y canario)
// =============================================================================

/**
 * ÚNICA EXENCIÓN de la regla de constantes, y por qué NO es aflojarla
 * (adjudicación de A14, D-038).
 *
 * Forma exacta que se exime: `ESCALA_<ALGO> = 10n ** <n>n`. Es decir, un
 * identificador que empieza por `ESCALA_` cuyo valor es literalmente una
 * potencia de diez en BigInt. Nada más.
 *
 * Un factor de escala de punto fijo NO es un valor tributario: es la
 * definición de la columna (`numeric(9,6)` de `tax_rule.tarifa`), no el
 * contenido de ninguna fila. Si mañana se anula el Decreto 572, la escala no
 * cambia; si la columna pasara a `numeric(9,8)`, cambiaría sin que cambiara
 * ninguna tarifa. Eso es representación, no regla.
 *
 * Y la exención no se concede de palabra: se GANA. La prueba
 * «toda constante de escala eximida coincide con la escala real de su columna»
 * lee `information_schema` y exige que cada constante eximida sea exactamente
 * 10^(escala declarada en la base). Una constante que se llamara `ESCALA_` sin
 * serlo —o que dejara de coincidir con su columna— hace fallar esa prueba.
 * Así que la exención está acotada por la forma (potencia de diez) Y por el
 * hecho verificable (coincide con el esquema).
 */
const EXENCION_ESCALA = /(?:const|let|var)\s+(ESCALA_[A-Z0-9_]*)\s*=\s*10n\s*\*\*\s*\d+n\s*;?\s*$/;

export interface ReglaDetector {
  id: string;
  descripcion: string;
  detecta(texto: string, archivo?: string): boolean;
}

export const REGLAS: readonly ReglaDetector[] = [
  {
    id: 'fraccion',
    descripcion: 'fracción decimal con pinta de tarifa (0,xxx) fuera de un comentario',
    // 2,5% se escribe 0.025000; 2 por mil, 0.002000. Cualquier `0.<algo>` en
    // código ejecutable es sospechoso por definición.
    detecta: (t) => /(^|[^\w.])0\.\d+/.test(t),
  },
  {
    id: 'porcentaje',
    descripcion: 'porcentaje literal',
    detecta: (t) => /\d+([.,]\d+)?\s*%/.test(t),
  },
  {
    id: 'numero_junto_a_palabra_tributaria',
    descripcion: 'entero de cinco cifras o más a menos de 60 caracteres de una palabra tributaria',
    detecta: (t) => {
      const palabra =
        /(uvt|smmlv|salario_?minimo|salario minimo|retefuente|reteica|reteiva|autorretenci|tarifa|base_?minima|tope|sancion)/i;
      if (!palabra.test(t)) return false;
      const m = palabra.exec(t)!;
      const ventana = t.slice(Math.max(0, m.index - 60), m.index + 60);
      return /(^|[^\w.])\d{5,}(?![\w.])/.test(ventana);
    },
  },
  {
    id: 'magnitud_conocida',
    descripcion: 'magnitud conocida de UVT o de salario mínimo, esté donde esté',
    // Valores reales de referencia de los últimos años, en pesos y en centavos.
    // Que aparezca cualquiera de ellos en el código es un dato normativo
    // quemado, aunque la variable se llame `x`.
    detecta: (t) => {
      const magnitudes = [
        '42412', '47065', '49799', '52374', // UVT 2023-2026, en pesos
        '4241200', '4706500', '4979900', '5237400', // los mismos, en centavos
        '1160000', '1300000', '1423500', // SMMLV
        '116000000', '130000000', '142350000',
      ];
      return magnitudes.some((m) => new RegExp(`(^|[^\\d])${m}([^\\d]|$)`).test(t));
    },
  },
  {
    id: 'multiplo_de_uvt',
    descripcion: 'entero que es múltiplo exacto de una UVT o de un SMMLV conocido (umbral precalculado)',
    // HUECO QUE ENCONTRÓ EL PROPIO CANARIO DE A14 al cerrar la Ola 1 (D-040):
    // `if (base > 104748) retener();` no lo cazaba ninguna de las seis reglas
    // anteriores — no es fracción, no es porcentaje, no hay palabra tributaria
    // cerca y no es una magnitud de UVT sino DOS. Y 104.748 es exactamente la
    // base mínima de servicios de la sección 12. La forma más natural de
    // quemar una base mínima es precalcularla, así que se caza el múltiplo.
    detecta: (t) => {
      const BASES = [42412, 47065, 49799, 52374, 1160000, 1300000, 1423500];
      const numeros = t.match(/(?<![\w.])\d{5,}(?![\w.])/g) ?? [];
      return numeros.some((n) => {
        const v = Number(n);
        if (!Number.isSafeInteger(v)) return false;
        return BASES.some((u) => {
          for (const unidad of [u, u * 100]) {
            if (v >= unidad && v % unidad === 0 && v / unidad <= 100_000) return true;
          }
          return false;
        });
      });
    },
  },
  {
    id: 'constante_o_default',
    descripcion: 'constante o DEFAULT que fije un valor tributario',
    // Tres formas: una constante cuyo NOMBRE es tributario y lleva número,
    // cualquier constante cuyo VALOR es una fracción decimal, o un DEFAULT con
    // fracción. `LONGITUD_CLAVE = 32` no es una tarifa; `TARIFA_SERVICIOS =
    // 0.04` sí. Única exención: los factores de escala de punto fijo, con la
    // forma exacta de EXENCION_ESCALA y verificados contra el esquema.
    detecta: (t) => {
      const nombreTributario =
        /(const|let|var)\s+\w*(UVT|SMMLV|TARIFA|RETEFUENTE|RETEICA|RETEIVA|SALARIO|BASE_MINIMA|TOPE)\w*\s*(:\s*[\w<>[\]]+\s*)?=\s*[\d.]/i;
      const valorFraccion = /(const|let|var)\s+\w+\s*(:\s*[\w<>[\]]+\s*)?=\s*0?\.\d/i;
      const defaultFraccion = /DEFAULT\s+0?\.\d/i;
      const sospechosa =
        nombreTributario.test(t) || valorFraccion.test(t) || defaultFraccion.test(t);
      if (!sospechosa) return false;
      return !EXENCION_ESCALA.test(t.trim());
    },
  },
  {
    id: 'insert_normativo',
    descripcion: 'INSERT de datos normativos en una MIGRACIÓN (su sitio es db/seeds)',
    // AJUSTE DE LA OLA 2 (A8, sección 6): desde el módulo de parametrización,
    // `src/services/parametrizacion.ts` inserta filas en estas mismas tablas
    // A PROPÓSITO — es la interfaz por la que un contador crea una vigencia
    // nueva sin desplegar código (sección 6.1). Esos INSERT usan siempre
    // parámetros ligados ($1, $2, ...) que llegan del contador en tiempo de
    // ejecución: no hay ahí ningún valor tributario «quemado», y si lo
    // hubiera, lo cazarían las otras cinco reglas de este mismo detector
    // (aplican a `src/` igual que a `db/migrations`). Lo que esta regla sigue
    // sin permitir es que una MIGRACIÓN (que es esquema, no dato) le haga un
    // INSERT de datos normativos por fuera de `db/seeds/` para esquivar el
    // escrutinio de A1 — ese es el hueco original que cierra D-039.
    detecta: (t, archivo) => {
      if (!archivo || !archivo.startsWith('db/migrations/')) return false;
      return /INSERT\s+INTO\s+(uvt_value|smmlv_value|tax_rule|tax_concept|municipality_ica_rule|ciiu_activity|rounding_rule|tax_calendar)\b/i.test(
        t,
      );
    },
  },
];

// =============================================================================
// SALVAGUARDA RESTITUIDA POR A14 EN LA OLA 2 (D-049)
//
// A8 acotó la regla `insert_normativo` a `db/migrations/`, apoyándose en que
// «si un INSERT de `src/` tuviera un valor tributario, lo cazarían las otras
// cinco reglas». A14 lo comprobó con canario envenenado y es FALSO: los
// valores tributarios que son ENTEROS PEQUEÑOS pasan intactos, porque las
// cinco reglas restantes se anclan en decimales, en el signo `%` o en enteros
// de cinco cifras o más. Escaparon, entre otros:
//
//   INSERT INTO tax_rule (base_minima_uvt) VALUES (2)      -> base mínima
//   INSERT INTO rounding_rule (multiplo)   VALUES (1000)   -> regla de redondeo
//   INSERT INTO tax_calendar (dia)         VALUES (12)     -> calendario
//   INSERT INTO tax_rule (tarifa)          VALUES (4::numeric/100)
//
// Los cuatro son exactamente lo que la Regla 2 prohíbe («tarifa, base mínima,
// valor de UVT, salario mínimo, porcentaje, tope o calendario»), y los cuatro
// los cazaba la regla ANTES del acotamiento.
//
// La necesidad de A8 sí es legítima (§6.1: el contador crea una vigencia nueva
// desde la interfaz, y esa escritura pasa por `src/services/parametrizacion.ts`).
// Así que no se restituye la prohibición total: se restituye con la forma que
// distingue el caso legítimo del peligroso, que es la que A8 invocó en su
// propia justificación — «esos INSERT usan siempre parámetros ligados».
//
// REGLA: en `src/` y `app/`, un INSERT sobre una tabla normativa puede llevar
// SOLO marcadores ligados (`$1`), `NULL`, `DEFAULT` y llamadas a función. Ni un
// literal numérico. Si el valor llega del contador en tiempo de ejecución, va
// en un `$n`; si está escrito en la sentencia, es un valor tributario quemado.
// =============================================================================

const TABLAS_NORMATIVAS =
  'uvt_value|smmlv_value|tax_rule|tax_concept|municipality_ica_rule|ciiu_activity|rounding_rule|tax_calendar';

/**
 * Extrae el cuerpo de cada sentencia `INSERT INTO <tabla normativa>` de un
 * archivo, sin comentarios, desde el `INSERT` hasta el primer terminador
 * (`RETURNING`, `ON CONFLICT`, `;` o el cierre de la literal SQL).
 */
export function insertsNormativos(contenido: string): string[] {
  const texto = sinComentarios(contenido).join('\n');
  const re = new RegExp(String.raw`INSERT\s+INTO\s+(?:` + TABLAS_NORMATIVAS + String.raw`)\b`, 'gi');
  const sentencias: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const resto = texto.slice(m.index);
    const corte = resto.search(/RETURNING|ON\s+CONFLICT|[`;]|'\s*,\s*\[|"\s*,\s*\[/i);
    sentencias.push(corte === -1 ? resto.slice(0, 1200) : resto.slice(0, corte));
  }
  return sentencias;
}

/** Literales numéricos de una sentencia, ignorando `$1` y los sufijos de identificador. */
export function literalesNumericos(sentencia: string): string[] {
  const sinLigados = sentencia.replace(/\$\d+/g, '$');
  return sinLigados.match(/(?<![\w$.])\d+(?:\.\d+)?/g) ?? [];
}

describe('A14 · un INSERT normativo en `src/`/`app/` solo puede llevar parámetros ligados (D-049)', () => {
  const ARCHIVOS_EJECUTABLES = [...new Set(LINEAS.map((l) => l.archivo))].filter(
    (a) => a.startsWith('src/') || a.startsWith('app/'),
  );

  it('el barrido alcanza el módulo de parametrización (si no, no probaría nada)', () => {
    expect(ARCHIVOS_EJECUTABLES).toContain('src/services/parametrizacion.ts');
    const conInsert = ARCHIVOS_EJECUTABLES.filter(
      (a) => insertsNormativos(readFileSync(join(RAIZ, a), 'utf8')).length > 0,
    );
    // Debe haber al menos un INSERT normativo vivo en `src/`: es la vía del
    // contador (§6.1). Si desapareciera, esta salvaguarda estaría vigilando el
    // vacío y habría que revisar por dónde se edita ahora un parámetro.
    expect(conInsert.length).toBeGreaterThan(0);
  });

  it('ningún INSERT normativo de `src/`/`app/` lleva un literal numérico', () => {
    const hallazgos: string[] = [];
    for (const archivo of ARCHIVOS_EJECUTABLES) {
      for (const sentencia of insertsNormativos(readFileSync(join(RAIZ, archivo), 'utf8'))) {
        const literales = literalesNumericos(sentencia);
        if (literales.length > 0) {
          hallazgos.push(`${archivo}  literales [${literales.join(', ')}]  en «${
            sentencia.replace(/\s+/g, ' ').slice(0, 120)
          }»`);
        }
      }
    }
    expect(hallazgos).toEqual([]);
  });

  // ---- canario de esta salvaguarda: si alguien la afloja, aquí falla --------
  const VENENO_INSERT: readonly { sql: string; porQue: string }[] = [
    {
      sql: 'await tx.query(`INSERT INTO tax_rule (tarifa) VALUES (0.04)`);',
      porQue: 'tarifa decimal quemada',
    },
    {
      sql: 'await tx.query(`INSERT INTO tax_rule (base_minima_uvt) VALUES (2)`);',
      porQue: 'base mínima de 2 UVT: entero pequeño que NINGUNA otra regla ve',
    },
    {
      sql: 'await tx.query(`INSERT INTO rounding_rule (multiplo) VALUES (1000)`);',
      porQue: 'regla de redondeo quemada (Regla 5: el redondeo es parámetro)',
    },
    {
      sql: 'await tx.query(`INSERT INTO tax_calendar (dia, mes) VALUES (12, 4)`);',
      porQue: 'calendario tributario quemado',
    },
    {
      sql: 'await tx.query(`INSERT INTO tax_rule (tarifa) VALUES (4::numeric/100)`);',
      porQue: 'tarifa disfrazada de división, sin un solo decimal',
    },
    {
      sql: [
        'await tx.query(`INSERT INTO municipality_ica_rule (',
        '   municipality_id, tarifa_general, base_minima_servicios_uvt',
        ' ) VALUES ($1, 0.002, 15)`);',
      ].join('\n'),
      porQue: 'multilínea: el barrido por línea no lo vería completo',
    },
  ];

  for (const v of VENENO_INSERT) {
    it(`caza «${v.porQue}»`, () => {
      const sentencias = insertsNormativos(v.sql);
      expect(sentencias.length).toBeGreaterThan(0);
      expect(sentencias.flatMap(literalesNumericos).length).toBeGreaterThan(0);
    });
  }

  it('y NO caza la forma legítima de A8: parámetros ligados, NULL y llamadas a función', () => {
    const LEGITIMO = [
      'await tx.query(`INSERT INTO tax_rule (',
      '   tenant_id, company_id, tarifa, base_minima_uvt, vigente_desde, vigente_hasta, created_by',
      ' ) VALUES (',
      '   $1,$2,$3,$4,$5,NULL,',
      '   app.current_user_id()',
      ' )',
      ' RETURNING id`, [ctx.tenantId, companyId, input.tarifa, input.baseMinimaUvt, input.vigenteDesde]);',
    ].join('\n');
    const literales = insertsNormativos(LEGITIMO).flatMap(literalesNumericos);
    expect(literales).toEqual([]);
  });
});

function hallazgosDe(regla: ReglaDetector): Linea[] {
  return LINEAS.filter((l) => regla.detecta(l.texto, l.archivo));
}

// =============================================================================
describe('A14 · Regla de Oro 2 — ni un valor tributario quemado en el código', () => {
  it('el barrido encontró código que analizar (si no, la prueba no probaría nada)', () => {
    expect(LINEAS.length).toBeGreaterThan(1500);
    expect(new Set(LINEAS.map((l) => l.archivo)).size).toBeGreaterThan(15);
    // Y barre de verdad lo que la Ola 1 añadió, no solo lo de la Ola 0.
    const modulos = new Set(
      LINEAS.map((l) => l.archivo.split('/').slice(0, 2).join('/')),
    );
    for (const esperado of ['src/domain', 'src/ingest', 'src/services', 'db/migrations']) {
      expect([...modulos]).toContain(esperado);
    }
    // Ola 2 (A14): `app/` ya existe y es la superficie con MÁS decimales
    // legítimos del repositorio (CSS, `step=`, `width=`). Que el barrido la
    // alcance de verdad no puede quedar implícito: si alguien la excluyera
    // para acallar la regla `fraccion`, esta prueba cae.
    const modulosDeApp = [...modulos].filter((m) => m.startsWith('app/'));
    expect(modulosDeApp.length).toBeGreaterThan(0);
    const archivosDeApp = new Set(
      LINEAS.filter((l) => l.archivo.startsWith('app/')).map((l) => l.archivo),
    );
    expect(archivosDeApp.size).toBeGreaterThan(5);
    // Y entre ellos hay `.tsx`: si la extensión se cayera de EXTENSIONES, el
    // barrido diría «cero hallazgos» sobre unos archivos que ni abrió.
    expect([...archivosDeApp].some((a) => a.endsWith('.tsx'))).toBe(true);
    for (const ruta of ['app/parametros', 'app/bandeja']) {
      expect([...archivosDeApp].some((a) => a.startsWith(ruta))).toBe(true);
    }
  });

  for (const regla of REGLAS) {
    it(`ningún hallazgo de la regla «${regla.descripcion}»`, () => {
      expect(informar(hallazgosDe(regla))).toEqual([]);
    });
  }
});

// =============================================================================
describe('A14 · el detector sigue cazando tarifas de verdad (canario)', () => {
  /** Cada muestra es código que un agente podría escribir, y que DEBE ser cazado. */
  const VENENO: readonly { texto: string; porQue: string; archivo?: string }[] = [
    { texto: 'const TARIFA_SERVICIOS = 0.04;', porQue: 'tarifa quemada, nombre delator' },
    { texto: 'const x = 0.025;', porQue: 'tarifa quemada con nombre inocente' },
    { texto: 'const UVT_2026 = 5237400;', porQue: 'UVT en centavos' },
    { texto: 'const limite = 52374 * 10;', porQue: 'UVT en pesos disfrazada de multiplicación' },
    { texto: 'if (base > 104748) retener();', porQue: '2 UVT precalculadas' },
    { texto: 'if (monto >= 523740) aplicar();', porQue: '10 UVT precalculadas (compras)' },
    { texto: 'const umbral = 785610;', porQue: '15 UVT precalculadas (base de Medellín)' },
    { texto: 'return base > 157122;', porQue: '3 UVT precalculadas (base de servicios de Cali)' },
    { texto: 'const techo = 4975530;', porQue: '95 UVT precalculadas (umbral de salarios)' },
    { texto: 'const RETEIVA_PORCENTAJE = 15;', porQue: 'porcentaje con nombre tributario' },
    { texto: 'return monto * 15 / 100; // 15%', porQue: 'porcentaje literal' },
    {
      texto: 'INSERT INTO tax_rule (tarifa) VALUES (0.04);',
      porQue: 'dato normativo en migración',
      // A14, Ola 2: sin `archivo` esta muestra la cazaba `fraccion`, y la regla
      // `insert_normativo` —que es la que existe para ESTO— nunca se ejercitaba
      // en el canario. Se declara la ruta para que la regla se pruebe de verdad.
      archivo: 'db/migrations/999_veneno.sql',
    },
    {
      texto: "INSERT INTO tax_concept (codigo, nombre) VALUES ('X', 'Y');",
      porQue: 'dato normativo en migración SIN ningún número: solo lo caza insert_normativo',
      archivo: 'db/migrations/999_veneno.sql',
    },
    { texto: 'const baseMinimaUvt = 104748;', porQue: 'base mínima en pesos junto a la palabra' },
    // Los tres que intentan colarse POR LA EXENCIÓN de escala:
    { texto: 'const ESCALA_TARIFA = 0.04;', porQue: 'usa el prefijo eximido con valor de tarifa' },
    { texto: 'const ESCALA_UVT = 5237400n;', porQue: 'usa el prefijo eximido con valor de UVT' },
    {
      texto: 'const ESCALA_TARIFA_SERVICIOS = 4n; // 4%',
      porQue: 'prefijo eximido, valor que no es potencia de diez',
    },
  ];

  for (const muestra of VENENO) {
    it(`caza «${muestra.texto}» (${muestra.porQue})`, () => {
      const cazadores = REGLAS.filter((r) => r.detecta(muestra.texto, muestra.archivo)).map(
        (r) => r.id,
      );
      expect(cazadores.length).toBeGreaterThan(0);
    });
  }

  it('y NO caza lo que legítimamente no es tributario', () => {
    const INOCENTES = [
      'const LONGITUD_CLAVE = 32;',
      'const BACKOFF_MAXIMO_SEGUNDOS = 3600;',
      'const MAX_INTENTOS = 5;',
      'export const ESCALA_TARIFA = 10n ** 6n;',
      'export const ESCALA_UVT = 10n ** 4n;',
    ];
    for (const texto of INOCENTES) {
      const cazadores = REGLAS.filter((r) => r.detecta(texto)).map((r) => r.id);
      expect(`${texto} -> ${cazadores.join(',')}`).toBe(`${texto} -> `);
    }
  });
});

// =============================================================================
describe('A14 · la exención de las constantes de escala se GANA contra el esquema', () => {
  it('toda constante ESCALA_* eximida coincide con la escala real de su columna en la base', async () => {
    const db = await createTestDb();
    try {
      const escalas = await db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ columna: string; numeric_scale: number }>(
          `SELECT table_name || '.' || column_name AS columna, numeric_scale
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (table_name, column_name) IN (('tax_rule','tarifa'), ('tax_rule','base_minima_uvt'))`,
        );
        return new Map(rows.map((r) => [r.columna, Number(r.numeric_scale)]));
      });

      // Si estas dos constantes dejaran de ser la escala de su columna, el
      // motor truncaría o desplazaría valores paramétricos en silencio. La
      // exención de la Regla 2 se cae con ellas.
      expect(escalas.get('tax_rule.tarifa')).toBe(6);
      expect(escalas.get('tax_rule.base_minima_uvt')).toBe(4);
      expect(ESCALA_TARIFA).toBe(10n ** BigInt(escalas.get('tax_rule.tarifa')!));
      expect(ESCALA_UVT).toBe(10n ** BigInt(escalas.get('tax_rule.base_minima_uvt')!));
    } finally {
      await db.close();
    }
  });

  it('las constantes eximidas en el código son EXACTAMENTE las dos declaradas', () => {
    // Si aparece una tercera constante que reclama la exención, esta prueba
    // falla y A14 tiene que adjudicarla. La lista blanca no se amplía sola.
    const eximidas = LINEAS.filter((l) => EXENCION_ESCALA.test(l.texto.trim())).map(
      (l) => `${l.archivo}  ${l.texto.trim()}`,
    );
    expect(eximidas).toEqual([
      'src/domain/dinero.ts  export const ESCALA_TARIFA = 10n ** 6n;',
      'src/domain/dinero.ts  export const ESCALA_UVT = 10n ** 4n;',
    ]);
  });
});

// =============================================================================
describe('A14 · db/seeds es DATO, no código: la exclusión del barrido no es una puerta trasera', () => {
  const SEEDS = join(RAIZ, 'db/seeds');

  function archivosDeSeeds(dir: string, acc: string[] = []): string[] {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) archivosDeSeeds(ruta, acc);
      else acc.push(ruta);
    }
    return acc;
  }

  const ARCHIVOS = archivosDeSeeds(SEEDS);

  it('hay seeds que auditar y todos son .sql — ni un archivo ejecutable', () => {
    expect(ARCHIVOS.length).toBeGreaterThan(10);
    const noSql = ARCHIVOS.filter((a) => !a.endsWith('.sql')).map((a) => relative(RAIZ, a));
    expect(noSql).toEqual([]);
  });

  it('ningún seed define lógica: nada de CREATE FUNCTION, DO $$ ni triggers', () => {
    const conCodigo: string[] = [];
    for (const a of ARCHIVOS) {
      const contenido = readFileSync(a, 'utf8');
      if (/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER)|^\s*DO\s+\$\$/im.test(contenido)) {
        conCodigo.push(relative(RAIZ, a));
      }
    }
    expect(conCodigo).toEqual([]);
  });

  it('ningún seed hace UPDATE ni DELETE sobre una tabla paramétrica (Regla 3: se inserta vigencia, no se actualiza)', () => {
    const mutantes: string[] = [];
    for (const a of ARCHIVOS) {
      const lineas = sinComentarios(readFileSync(a, 'utf8'));
      lineas.forEach((texto, i) => {
        if (/^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s+/i.test(texto)) {
          mutantes.push(`${relative(RAIZ, a)}:${i + 1}  ${texto.trim()}`);
        }
      });
    }
    expect(mutantes).toEqual([]);
  });

  it('los seeds SÍ traen tarifas reales: si estuvieran vacíos, el barrido de arriba no probaría nada', () => {
    // El complemento indispensable. «Cero valores tributarios en el código» es
    // trivialmente cierto si tampoco hay valores en ninguna parte. Esta prueba
    // exige que el dato exista, y exista en su sitio.
    const conTarifa = ARCHIVOS.filter((a) => /0\.\d{4,}/.test(readFileSync(a, 'utf8')));
    expect(conTarifa.length).toBeGreaterThan(0);
  });

  it('toda fila normativa de los seeds declara su norma de respaldo (Regla 6 y advertencia 17.5)', () => {
    // Un valor tributario sin norma es un valor inventado con buena letra.
    const tablas = ['tax_rule', 'uvt_value', 'municipality_ica_rule'];
    for (const a of ARCHIVOS) {
      const contenido = readFileSync(a, 'utf8');
      for (const tabla of tablas) {
        const patron = new RegExp(`INSERT\\s+INTO\\s+${tabla}\\b`, 'i');
        if (!patron.test(contenido)) continue;
        expect(`${relative(RAIZ, a)} declara norma_respaldo`).toBe(
          `${relative(RAIZ, a)} ${/norma_respaldo/i.test(contenido) ? 'declara' : 'NO declara'} norma_respaldo`,
        );
      }
    }
  });
});

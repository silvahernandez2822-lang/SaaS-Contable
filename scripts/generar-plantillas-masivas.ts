/**
 * A16 — Generador de las plantillas de carga masiva (Ola 4, Tarea 2).
 *
 *   npm run plantillas-masivas
 *
 * Escribe un `.xlsx` INDEPENDIENTE por catálogo en `/archivos-masivos/`.
 *
 * POR QUÉ UN SCRIPT Y NO QUINCE ARCHIVOS SUBIDOS AL REPOSITORIO. Los
 * encabezados de la plantilla son un contrato con el importador: si mañana
 * `third_party` gana una columna obligatoria y la plantilla se quedó vieja,
 * todo el mundo sube archivos que el importador rechaza, y nadie sabe por qué.
 * Aquí las plantillas SE DERIVAN de `src/services/carga-masiva/definiciones.ts`,
 * que es el mismo archivo que usa el importador para validar. No pueden
 * desincronizarse: son la misma lista leída dos veces.
 *
 * POR QUÉ UN ARCHIVO POR CATÁLOGO Y NO UN LIBRO CON QUINCE HOJAS. Porque cada
 * catálogo lo carga una persona distinta en un momento distinto: el PUC lo
 * arma el contador al abrir la empresa, los terceros los actualiza el auxiliar
 * cada semana y el calendario tributario lo carga el administrador tributario
 * una vez al año. Un solo libro obligaría a los tres a mandarse el mismo
 * archivo y a pisarse.
 *
 * QUÉ PASA SI SE EDITA UNA PLANTILLA A MANO Y SE VUELVE A CORRER ESTO: se
 * sobrescribe. Las plantillas son producto derivado, no fuente. Lo que se
 * edita es la definición.
 *
 * LA CONSTRUCCIÓN DEL LIBRO NO ESTÁ AQUÍ, sino en
 * `src/services/carga-masiva/plantilla.ts`: la comparte con
 * `GET /api/plantillas/:catalogo`, que genera la plantilla en el momento en vez
 * de servir el archivo de disco.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFINICIONES } from '../src/services/carga-masiva/definiciones';
import { construirPlantilla, nombreDeArchivo } from '../src/services/carga-masiva/plantilla';

export const DIRECTORIO_PLANTILLAS = fileURLToPath(new URL('../archivos-masivos', import.meta.url));

export async function generarPlantillas(directorio: string = DIRECTORIO_PLANTILLAS): Promise<string[]> {
  await mkdir(directorio, { recursive: true });
  const generados: string[] = [];
  for (const definicion of DEFINICIONES) {
    const wb = construirPlantilla(definicion);
    const ruta = path.join(directorio, nombreDeArchivo(definicion));
    const buffer = await wb.xlsx.writeBuffer();
    await writeFile(ruta, Buffer.from(buffer as ArrayBuffer));
    generados.push(ruta);
  }
  await writeFile(path.join(directorio, 'LEEME.md'), leeme(), 'utf8');
  return generados;
}

function leeme(): string {
  const filas = DEFINICIONES.map(
    (d, i) =>
      `| ${i + 1} | \`${nombreDeArchivo(d)}\` | ${d.titulo} | \`${d.tabla}\` | ${d.modulo} | \`/carga-masiva/${d.clave}\` |`,
  ).join('\n');

  return `# Plantillas de carga masiva

**Este directorio es producto derivado. No se edita a mano.**

Se regenera con:

\`\`\`bash
npm run plantillas-masivas
\`\`\`

La fuente es \`src/services/carga-masiva/definiciones.ts\`, el mismo archivo que
usa el importador para validar lo que usted sube. Por eso la plantilla y el
importador no pueden desincronizarse: son la misma lista de columnas leída dos
veces (D-071).

Dentro del producto, estas mismas plantillas se descargan desde
\`/carga-masiva\` (o directamente en \`/api/plantillas/<catalogo>\`), generadas en
el momento: esa ruta nunca sirve los archivos de este directorio, para que un
despliegue con el directorio viejo no entregue plantillas que su propio
importador rechaza.

Cada archivo trae dos hojas: **Datos** (encabezados exactos, con las columnas
obligatorias en rojo y con asterisco, y una fila de ejemplo ya llena) e
**Instrucciones** (qué espera cada columna, en qué formato, y de dónde sacar los
valores válidos cuando dependen de otro catálogo).

## Orden de carga

Cárguelos en este orden: cada uno solo depende de los anteriores.

| # | Archivo | Catálogo | Tabla | Módulo | Se sube en |
|---|---|---|---|---|---|
${filas}

## Qué pasa si una fila está mal

No se carga nada. Se muestra la lista completa de filas con problema (número de
fila tal como lo ve en Excel, columna y motivo) y usted decide entre corregir el
archivo y volver a subirlo, o cargar solo las filas válidas — pero eso hay que
pedirlo explícitamente, nunca ocurre solo (D-072).
`;
}

const esEjecucionDirecta =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (esEjecucionDirecta) {
  generarPlantillas()
    .then((rutas) => {
      for (const ruta of rutas) console.log(`  ✓ ${path.relative(process.cwd(), ruta)}`);
      console.log(`\n${rutas.length} plantillas escritas en ${path.relative(process.cwd(), DIRECTORIO_PLANTILLAS)}/`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}

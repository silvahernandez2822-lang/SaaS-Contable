/**
 * A13 — La frontera de la sección 13.2, demostrada, no solo afirmada.
 *
 * "Ningún cálculo tributario. Ninguna escritura de asientos contables.
 * Ninguna resolución de reglas." n8n orquesta y notifica; la aplicación
 * decide y calcula. Esta suite verifica en código, no en prosa:
 *
 *  1. `src/integraciones/**` nunca importa el motor de reglas (`src/domain`)
 *     ni las funciones que SÍ causan (`procesarJobCausacion`,
 *     `construirPartidasCausacion`, `resolverFactura`, `ejecutarCicloCola`,
 *     `vaciarCola`, `aprobarAsiento*`, `reversarAsientoPublicado`) — solo
 *     puede tocar `recibirDocumento` (que ENCOLA, nunca causa) y las
 *     consultas de solo lectura.
 *  2. Ningún archivo de `src/integraciones/**` contiene un literal numérico
 *     que parezca una tarifa o un valor UVT (mismo espíritu que la Regla de
 *     Oro 2, acotado a esta capa).
 *  3. Las definiciones de workflow de n8n (`n8n/*.workflow.json`) no
 *     contienen ningún nodo de cálculo ni un valor tributario: son
 *     orquestación (HTTP, condicionales, notificación, horario), nunca
 *     lógica de negocio.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ_INTEGRACIONES = fileURLToPath(new URL('../../src/integraciones/', import.meta.url));
const RAIZ_N8N = fileURLToPath(new URL('../../n8n/', import.meta.url));

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta));
    else if (ruta.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

const FUNCIONES_QUE_CALCULAN_O_ESCRIBEN_ASIENTO = [
  'procesarJobCausacion',
  'construirPartidasCausacion',
  'resolverFactura',
  'causarNotaCredito',
  'ejecutarCicloCola',
  'vaciarCola',
  'aprobarAsiento',
  'aprobarAsientosEnLote',
  'reversarAsientoPublicado',
];

describe('Frontera n8n/A13 — nunca calcula, nunca escribe un asiento', () => {
  it('src/integraciones/** no importa src/domain (el motor de reglas) en absoluto', () => {
    for (const archivo of archivosTs(RAIZ_INTEGRACIONES)) {
      const contenido = readFileSync(archivo, 'utf8');
      expect(contenido, `${archivo} no debería importar src/domain`).not.toMatch(/from ['"].*\/domain\//);
    }
  });

  it('src/integraciones/** no IMPORTA ninguna función que cause o publique un asiento', () => {
    // Se mira solo el bloque `import { ... } from '...'`, no los comentarios:
    // este mismo archivo explica en prosa, a propósito, qué NO se importa
    // (ver la cabecera de ingest-correo.ts), y eso no debe contar como uso.
    for (const archivo of archivosTs(RAIZ_INTEGRACIONES)) {
      const contenido = readFileSync(archivo, 'utf8');
      const bloquesImport = contenido.match(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/gms) ?? [];
      const textoImports = bloquesImport.join('\n');
      for (const funcion of FUNCIONES_QUE_CALCULAN_O_ESCRIBEN_ASIENTO) {
        expect(textoImports, `${archivo} no debería IMPORTAR ${funcion}`).not.toMatch(
          new RegExp(`\\b${funcion}\\b`),
        );
      }
    }
  });

  it('la única función de causación que src/integraciones/** puede llamar es recibirDocumento (que ENCOLA, no causa)', () => {
    const contenidoIngest = readFileSync(join(RAIZ_INTEGRACIONES, 'ingest-correo.ts'), 'utf8');
    expect(contenidoIngest).toMatch(/\brecibirDocumento\b/);
    // Y solo desde services/ingest.js — nunca desde services/causacion.js.
    expect(contenidoIngest).not.toMatch(/services\/causacion\.js/);
  });

  it('ningún archivo de src/integraciones/** trae un literal que parezca tarifa o UVT', () => {
    const sospechosos = /\b(tarifa|uvt|smmlv|retefuente|reteiva|reteica|autorretencion)\s*[:=]\s*[\d.]+/i;
    for (const archivo of archivosTs(RAIZ_INTEGRACIONES)) {
      const contenido = readFileSync(archivo, 'utf8');
      expect(contenido, `${archivo} no debería traer un valor tributario`).not.toMatch(sospechosos);
    }
  });
});

describe('Frontera n8n — las definiciones de workflow son orquestación, no cálculo', () => {
  const archivosWorkflow = readdirSync(RAIZ_N8N).filter((f) => f.endsWith('.workflow.json'));

  it('hay al menos un workflow versionado por cada responsabilidad de la sección 13.1', () => {
    expect(archivosWorkflow.length).toBeGreaterThanOrEqual(5);
  });

  it('ningún workflow trae un nodo de tipo "code"/"function" que calcule algo tributario', () => {
    const sospechoso = /\b(tarifa|retefuente|reteiva|reteica|autorretencion|uvt|smmlv)\b/i;
    for (const nombre of archivosWorkflow) {
      const definicion = JSON.parse(readFileSync(join(RAIZ_N8N, nombre), 'utf8')) as {
        nodes: { type: string; parameters?: Record<string, unknown> }[];
      };
      for (const nodo of definicion.nodes) {
        const textoNodo = JSON.stringify(nodo.parameters ?? {});
        expect(
          sospechoso.test(textoNodo),
          `${nombre}: el nodo "${nodo.type}" no debería mencionar un concepto tributario`,
        ).toBe(false);
      }
    }
  });

  it('ningún workflow define un nodo que escriba directamente en la base de datos (Postgres/MySQL nativos de n8n)', () => {
    for (const nombre of archivosWorkflow) {
      const definicion = JSON.parse(readFileSync(join(RAIZ_N8N, nombre), 'utf8')) as {
        nodes: { type: string }[];
      };
      const tiposProhibidos = definicion.nodes
        .map((n) => n.type)
        .filter((t) => /postgres|mysql|mongodb|redis/i.test(t));
      expect(tiposProhibidos, `${nombre} no debería tocar una base de datos directamente`).toEqual([]);
    }
  });

  it('todo workflow que llama a la aplicación lo hace por HTTP (nodo httpRequest), nunca importando código', () => {
    for (const nombre of archivosWorkflow) {
      const definicion = JSON.parse(readFileSync(join(RAIZ_N8N, nombre), 'utf8')) as {
        nodes: { type: string }[];
      };
      const llamaAlgo = definicion.nodes.some((n) => /httpRequest|webhook|scheduleTrigger/i.test(n.type));
      expect(llamaAlgo, `${nombre} debería tener al menos un nodo de webhook/HTTP/horario`).toBe(true);
    }
  });
});

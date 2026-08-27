/**
 * A5 — Prompts versionados y determinismo (sección 8.4).
 *
 * «Temperatura del modelo en el mínimo. Prompts versionados; cambiar un prompt
 *  es un evento auditado. Procesar la misma factura N veces debe producir el
 *  mismo asiento N veces.»
 *
 * Las tres piezas del determinismo, y dónde está cada una:
 *
 *  1. TEMPERATURA. Vive en `prompt_clasificacion.temperatura_milesimas` y se
 *     siembra en cero. No hay forma de subirla desde el código: viaja con la
 *     plantilla, versionada con ella.
 *  2. PLANTILLA. `prompt_clasificacion` es append-only con trigger de
 *     auditoría: no se puede editar una versión publicada, solo insertar otra,
 *     y el `INSERT` queda en `audit_log`. Qué versión está activa lo dice
 *     `parametro_clasificacion.prompt_version`, cuyo cambio también se audita.
 *     Cada fila de `extraction` guarda la versión con la que se produjo, así
 *     que una propuesta de hace seis meses se puede reconstruir aunque el
 *     prompt haya cambiado tres veces desde entonces.
 *  3. RENDERIZADO. Determinista: el catálogo va ordenado por código, la
 *     descripción va normalizada, y no entra nada volátil —ni la fecha de
 *     hoy, ni el número de factura, ni un identificador aleatorio—. Dos
 *     ejecuciones del mismo documento producen exactamente el mismo texto, y
 *     `huellaPeticion` lo demuestra en una prueba.
 */
import { createHash } from 'node:crypto';
import type { SqlClient } from '../db/types.js';
import type { ConceptoCatalogo, PeticionLlm } from './tipos.js';

export interface PromptVersionado {
  id: string;
  codigo: string;
  version: number;
  plantillaSistema: string;
  plantillaUsuario: string;
  modelo: string;
  temperaturaMilesimas: number;
  maxTokensSalida: number;
  hashPlantilla: string;
}

interface FilaPrompt {
  id: string;
  codigo: string;
  version: number;
  plantilla_sistema: string;
  plantilla_usuario: string;
  modelo: string;
  temperatura_milesimas: number;
  max_tokens_salida: number;
  hash_plantilla: string;
}

/**
 * Carga la versión EXACTA que pide el parámetro. Nunca «la última»: si la
 * versión configurada no existe, devuelve null y el flujo manda la línea a
 * revisión. Coger otra versión sería producir una propuesta distinta de la que
 * el reproceso de mañana produciría.
 */
export async function cargarPrompt(
  tx: SqlClient,
  opciones: { tenantId: string; codigo: string; version: number },
): Promise<PromptVersionado | null> {
  const { rows } = await tx.query<FilaPrompt>(
    `SELECT id, codigo, version, plantilla_sistema, plantilla_usuario, modelo,
            temperatura_milesimas, max_tokens_salida, hash_plantilla
       FROM prompt_clasificacion
      WHERE codigo = $1 AND version = $2
        AND (tenant_id IS NULL OR tenant_id = $3)
      ORDER BY (tenant_id IS NOT NULL) DESC
      LIMIT 1`,
    [opciones.codigo, opciones.version, opciones.tenantId],
  );
  const f = rows[0];
  if (!f) return null;
  return {
    id: f.id,
    codigo: f.codigo,
    version: Number(f.version),
    plantillaSistema: f.plantilla_sistema,
    plantillaUsuario: f.plantilla_usuario,
    modelo: f.modelo,
    temperaturaMilesimas: Number(f.temperatura_milesimas),
    maxTokensSalida: Number(f.max_tokens_salida),
    hashPlantilla: f.hash_plantilla,
  };
}

/** Longitud máxima de la descripción de un concepto dentro del prompt. */
const LARGO_DESCRIPCION_EN_PROMPT = 90;

/** El catálogo, en texto compacto y en orden estable. */
export function formatearCatalogo(catalogo: readonly ConceptoCatalogo[]): string {
  return [...catalogo]
    .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
    .map((c) => {
      const detalle = (c.descripcion ?? '').replace(/\s+/g, ' ').trim();
      const recortada =
        detalle === '' ? '' : ` (${detalle.slice(0, LARGO_DESCRIPCION_EN_PROMPT)})`;
      return `${c.codigo} = ${c.nombre}${recortada}`;
    })
    .join('\n');
}

/** Sustituye `{{clave}}`. Un hueco sin llenar es un error, no un texto raro. */
export function renderizar(plantilla: string, valores: Record<string, string>): string {
  const texto = plantilla.replace(/\{\{(\w+)\}\}/g, (_todo, clave: string) => {
    const valor = valores[clave];
    if (valor === undefined) {
      throw new Error(`Plantilla de prompt con hueco sin valor: {{${clave}}}`);
    }
    return valor;
  });
  return texto;
}

export interface EntradaPeticion {
  prompt: PromptVersionado;
  catalogo: readonly ConceptoCatalogo[];
  descripcionNormalizada: string;
  proveedor: string | null;
}

/** Arma la petición del puerto. Función pura: mismo insumo, mismo texto. */
export function construirPeticion(e: EntradaPeticion): PeticionLlm {
  const catalogoTexto = formatearCatalogo(e.catalogo);
  const valores = {
    catalogo: catalogoTexto,
    descripcion: e.descripcionNormalizada,
    proveedor: e.proveedor ?? 'desconocido',
  };
  return {
    promptCodigo: e.prompt.codigo,
    promptVersion: e.prompt.version,
    promptHash: e.prompt.hashPlantilla,
    modelo: e.prompt.modelo,
    temperaturaMilesimas: e.prompt.temperaturaMilesimas,
    maxTokensSalida: e.prompt.maxTokensSalida,
    sistema: renderizar(e.prompt.plantillaSistema, valores),
    usuario: renderizar(e.prompt.plantillaUsuario, valores),
    codigosValidos: e.catalogo.map((c) => c.codigo),
    contexto: {
      descripcion: e.descripcionNormalizada,
      proveedor: e.proveedor,
      catalogo: e.catalogo,
    },
  };
}

/**
 * Huella de la petición: sha256 de todo lo que determina la respuesta. Dos
 * peticiones con la misma huella tienen que producir la misma propuesta, y es
 * lo que A14 puede comparar entre dos reprocesos del mismo documento.
 */
export function huellaPeticion(p: PeticionLlm): string {
  const canonico = JSON.stringify([
    p.promptCodigo,
    p.promptVersion,
    p.promptHash,
    p.modelo,
    p.temperaturaMilesimas,
    p.maxTokensSalida,
    p.sistema,
    p.usuario,
    [...p.codigosValidos].sort(),
  ]);
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * Estimación de tokens por longitud, para decidir ANTES de llamar si la
 * llamada cabe en el techo de costo. No pretende ser exacta: el consumo real
 * lo reporta el proveedor y es el que se persiste en `extraction`.
 */
const CARACTERES_POR_TOKEN = 4;

export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / CARACTERES_POR_TOKEN);
}

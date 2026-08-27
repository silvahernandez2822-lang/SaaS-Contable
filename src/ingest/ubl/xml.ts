/**
 * Utilidades de bajo nivel sobre el árbol que produce `fast-xml-parser`.
 *
 * Los XML UBL de la DIAN declaran los prefijos `cbc:`/`cac:`/`ext:`/`sts:` con
 * distintas URIs de namespace según el proveedor tecnológico que los generó,
 * pero el PREFIJO en sí es estable en la práctica (es el que trae el anexo
 * técnico). Este módulo navega por nombre de etiqueta CON su prefijo tal como
 * viene ("cbc:ID"), no por URI de namespace — más simple y suficiente para
 * los cinco tipos de documento de la sección 10.2.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type NodoXml = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: false,
});

export interface ResultadoParseoXml {
  ok: true;
  raiz: NodoXml;
  nombreRaiz: string;
}

export interface ErrorParseoXml {
  ok: false;
  detalle: string;
}

/** Verifica buena formación y parsea. Nunca lanza: el llamador decide qué hacer con el error. */
export function parsearXml(xml: string): ResultadoParseoXml | ErrorParseoXml {
  if (xml.trim() === '') {
    return { ok: false, detalle: 'el documento XML está vacío' };
  }

  const validacion = XMLValidator.validate(xml, {
    allowBooleanAttributes: true,
  });
  if (validacion !== true) {
    return { ok: false, detalle: `XML mal formado: ${validacion.err.msg} (línea ${validacion.err.line})` };
  }

  let arbol: NodoXml;
  try {
    arbol = parser.parse(xml) as NodoXml;
  } catch (e) {
    return { ok: false, detalle: `error al parsear XML: ${e instanceof Error ? e.message : String(e)}` };
  }

  // La raíz es la primera clave que no sea la declaración `?xml`.
  const claves = Object.keys(arbol).filter((k) => k !== '?xml');
  const primera = claves[0];
  if (claves.length === 0 || primera === undefined) {
    return { ok: false, detalle: 'el XML no tiene elemento raíz' };
  }

  return { ok: true, raiz: arbol[primera] as NodoXml, nombreRaiz: quitarPrefijo(primera) };
}

/** "cbc:ID" -> "ID". Para comparar nombres de elemento sin depender del prefijo declarado. */
export function quitarPrefijo(nombre: string): string {
  const i = nombre.indexOf(':');
  return i === -1 ? nombre : nombre.slice(i + 1);
}

/**
 * Busca el primer hijo directo de `nodo` cuyo nombre local (sin prefijo)
 * coincida con `nombreLocal`. No busca en profundidad: UBL es explícito sobre
 * la jerarquía y buscar en profundidad podría emparejar el elemento de otra
 * sección con el mismo nombre local (p. ej. "ID" aparece decenas de veces).
 */
export function hijo(nodo: unknown, nombreLocal: string): NodoXml | undefined {
  if (nodo === null || typeof nodo !== 'object') return undefined;
  const obj = nodo as NodoXml;
  for (const clave of Object.keys(obj)) {
    if (quitarPrefijo(clave) === nombreLocal) {
      const valor = obj[clave];
      // Si hay varias ocurrencias, fast-xml-parser las agrupa en un array: se
      // toma la primera para las búsquedas "singulares".
      return (Array.isArray(valor) ? valor[0] : valor) as NodoXml;
    }
  }
  return undefined;
}

/** Como `hijo`, pero devuelve TODAS las ocurrencias (para listas: líneas, TaxSubtotal...). */
export function hijos(nodo: unknown, nombreLocal: string): NodoXml[] {
  if (nodo === null || typeof nodo !== 'object') return [];
  const obj = nodo as NodoXml;
  for (const clave of Object.keys(obj)) {
    if (quitarPrefijo(clave) === nombreLocal) {
      const valor = obj[clave];
      return Array.isArray(valor) ? (valor as NodoXml[]) : [valor as NodoXml];
    }
  }
  return [];
}

/** Sigue una ruta de nombres locales, hijo tras hijo. */
export function ruta(nodo: unknown, ...pasos: string[]): NodoXml | undefined {
  let actual: unknown = nodo;
  for (const paso of pasos) {
    actual = hijo(actual, paso);
    if (actual === undefined) return undefined;
  }
  return actual as NodoXml;
}

/** Texto de un nodo hoja: fast-xml-parser deja `{ '#text': '...' }` cuando el elemento tiene atributos. */
export function texto(nodo: unknown): string | null {
  if (nodo === null || nodo === undefined) return null;
  if (typeof nodo === 'string') return nodo;
  if (typeof nodo === 'number' || typeof nodo === 'boolean') return String(nodo);
  if (typeof nodo === 'object') {
    const obj = nodo as NodoXml;
    if (typeof obj['#text'] === 'string') return obj['#text'];
    if (typeof obj['#text'] === 'number') return String(obj['#text']);
  }
  return null;
}

/** Atributo de un nodo (p. ej. `schemeName` de `cbc:UUID`). */
export function atributo(nodo: unknown, nombre: string): string | null {
  if (nodo === null || typeof nodo !== 'object') return null;
  const valor = (nodo as NodoXml)[`@_${nombre}`];
  return typeof valor === 'string' ? valor : null;
}

/** Texto de un hijo directo, en un solo paso. */
export function textoHijo(nodo: unknown, nombreLocal: string): string | null {
  return texto(hijo(nodo, nombreLocal));
}

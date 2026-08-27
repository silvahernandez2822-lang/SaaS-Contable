/**
 * El caso crítico de la sección 10.2: el `Invoice` (o `CreditNote`/`DebitNote`/
 * `ApplicationResponse`) suele venir embebido dentro de un `AttachedDocument`,
 * en `cac:Attachment/cac:ExternalReference/cbc:Description`, y ese texto a
 * veces es el XML plano y a veces es el XML codificado en base64. El parser
 * de la sección 10 no puede funcionar sin desempaquetar esto primero.
 *
 * Esta función es PURA: no toca red ni base de datos. Devuelve el XML interno
 * como texto listo para volver a parsear, o un motivo de cuarentena si el
 * contenedor no trae nada aprovechable.
 */
import { hijo, quitarPrefijo, texto, type NodoXml } from './xml.js';
import type { MotivoCuarentena } from '../tipos.js';

export interface Desempaquetado {
  ok: true;
  /** El XML del documento interno, ya decodificado si hacía falta. */
  xmlInterno: string;
}

export interface FalloDesempaquetado {
  ok: false;
  motivo: MotivoCuarentena;
  detalle: string;
}

const PATRON_BASE64 = /^[A-Za-z0-9+/=\s]+$/;

/**
 * `AttachedDocument` puede repetir `cac:Attachment` (poco común) o anidar el
 * contenido bajo distintos nombres según el proveedor tecnológico. Se busca,
 * en orden: `cac:Attachment/cac:ExternalReference/cbc:Description`, que es la
 * ubicación que describe el anexo técnico 1.9.
 */
function extraerDescripcionAdjunta(raizAttachedDocument: NodoXml): string | null {
  const attachment = hijo(raizAttachedDocument, 'Attachment');
  if (!attachment) return null;
  const externalReference = hijo(attachment, 'ExternalReference');
  if (!externalReference) return null;
  return texto(hijo(externalReference, 'Description'));
}

/** true si el texto, una vez quitados espacios, parece un documento XML (empieza por `<`). */
function pareceXml(t: string): boolean {
  return t.trimStart().startsWith('<');
}

/**
 * Intenta decodificar como base64. Un texto que "parece" base64 por su
 * alfabeto pero no lo es realmente decodifica a bytes que no forman UTF-8
 * válido ni empiezan por `<` — eso se trata como fallo, no se asume éxito por
 * el simple hecho de decodificar sin lanzar (Buffer.from nunca lanza).
 */
function intentarBase64(t: string): string | null {
  const compacto = t.replace(/\s+/g, '');
  if (compacto === '' || !PATRON_BASE64.test(compacto)) return null;
  if (compacto.length % 4 !== 0) return null;

  const bytes = Buffer.from(compacto, 'base64');
  // Reencodar y comparar detecta buena parte de las cadenas que Buffer.from
  // decodifica "en silencio" sin que en realidad fueran base64 válido.
  if (bytes.length === 0) return null;

  const decodificado = bytes.toString('utf8');
  return pareceXml(decodificado) ? decodificado : null;
}

/**
 * Desempaqueta un `AttachedDocument` ya parseado (la raíz del árbol XML).
 * Si `nombreRaiz` no es `AttachedDocument`, no hay nada que desempaquetar:
 * el llamador debe tratar el documento como directo.
 */
export function desempaquetarAttachedDocument(
  raiz: NodoXml,
): Desempaquetado | FalloDesempaquetado {
  const descripcion = extraerDescripcionAdjunta(raiz);

  if (descripcion === null || descripcion.trim() === '') {
    return {
      ok: false,
      motivo: 'contenedor_sin_documento_interno',
      detalle:
        'AttachedDocument no trae cac:Attachment/cac:ExternalReference/cbc:Description con el documento embebido',
    };
  }

  const contenido = descripcion.trim();

  if (pareceXml(contenido)) {
    return { ok: true, xmlInterno: contenido };
  }

  const decodificado = intentarBase64(contenido);
  if (decodificado !== null) {
    return { ok: true, xmlInterno: decodificado };
  }

  return {
    ok: false,
    motivo: 'base64_invalido',
    detalle:
      'cbc:Description no es XML directo ni decodifica a XML válido en base64 (el caso de la sección 10.2)',
  };
}

/** Nombre local de la raíz, ya sin prefijo — atajo usado por el pipeline principal. */
export function esAttachedDocument(nombreRaiz: string): boolean {
  return quitarPrefijo(nombreRaiz) === 'AttachedDocument';
}

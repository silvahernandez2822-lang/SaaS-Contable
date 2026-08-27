import { createHash } from 'node:crypto';

/** sha256 hex de los bytes exactos recibidos. Es lo que `source_document.hash_contenido` guarda. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

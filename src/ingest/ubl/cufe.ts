/**
 * CUFE (Código Único de Facturación Electrónica) — sección 10.2.
 *
 * El CUFE es un hash SHA-384 (96 caracteres hex) que combina datos de la
 * factura con la clave técnica de control. Este módulo SOLO extrae el valor
 * que el emisor ya calculó y lo trae en el XML; no lo calcula ni lo verifica
 * criptográficamente (verificarlo exigiría reproducir la fórmula exacta del
 * anexo técnico con la clave técnica del emisor, que este sistema no posee —
 * ver la limitación documentada en `docs/ingest-correo.md`).
 *
 * Ubicación real, según las muestras públicas de la DIAN: `cbc:UUID`, hijo
 * directo de la raíz del documento (Invoice/CreditNote/DebitNote), con
 * `schemeName="CUFE-SHA384"` (o `CUDE-SHA384` para el histórico de nota). Se
 * busca por el atributo, no por el nombre del esquema exacto, porque distintos
 * proveedores tecnológicos han usado variantes del literal.
 */
import { hijo, atributo, texto, type NodoXml } from './xml.js';

const PATRON_CUFE_SHA384 = /^[0-9a-f]{96}$/i;

export interface ExtraccionCufe {
  cufe: string | null;
  /** false si se encontró un cbc:UUID pero su forma no es un SHA-384 de 96 hex. */
  formatoValido: boolean;
}

export function extraerCufe(raizDocumento: NodoXml): ExtraccionCufe {
  const nodoUuid = hijo(raizDocumento, 'UUID');
  const valor = texto(nodoUuid);

  if (valor === null || valor.trim() === '') {
    return { cufe: null, formatoValido: false };
  }

  const cufe = valor.trim();
  return { cufe, formatoValido: PATRON_CUFE_SHA384.test(cufe) };
}

/** El esquema declarado en el atributo, cuando existe. Informativo, no se usa para decidir. */
export function esquemaCufe(raizDocumento: NodoXml): string | null {
  const nodoUuid = hijo(raizDocumento, 'UUID');
  return atributo(nodoUuid, 'schemeName');
}

/**
 * Forma normalizada de un correo entrante, INDEPENDIENTE del proveedor.
 *
 * El proveedor de inbound email real no está contratado (sección 10.1: hoy
 * solo hay buzón de correo como vía principal, sin integración). Por eso el
 * contrato se divide en dos:
 *
 *  - `CorreoEntrante`: la forma neutra que este pipeline entiende.
 *  - `ProveedorCorreoEntrante`: el puerto que un adaptador concreto (SendGrid
 *    Inbound Parse, Mailgun Routes, SES + SNS, Postmark...) debe implementar
 *    para traducir SU payload de webhook a `CorreoEntrante`.
 *
 * Nada aquí abre un socket ni hace una petición HTTP: eso es del endpoint de
 * A6. Este módulo solo normaliza y valida la FORMA de los datos, ya en
 * memoria.
 */

export interface AdjuntoCorreo {
  nombreArchivo: string | null;
  contentType: string | null;
  /** Contenido del adjunto codificado en base64, tal como la mayoría de proveedores de inbound email lo entregan. */
  contenidoBase64: string;
}

export interface CorreoEntrante {
  messageId: string | null;
  remitenteEmail: string;
  remitenteNombre: string | null;
  /** Direcciones destinatarias del correo. La primera que matchee un buzón dedicado es la que se usa. */
  destinatarios: string[];
  asunto: string | null;
  /** Cabeceras crudas del correo, en minúscula. Se usa para leer `authentication-results`. */
  headers: Record<string, string>;
  adjuntos: AdjuntoCorreo[];
  /** Tamaño total del mensaje en bytes, si el proveedor lo informa. */
  tamanoBytes: number | null;
}

/**
 * Puerto que cualquier adaptador de proveedor debe implementar. Ningún
 * proveedor concreto se contrata ni se codifica aquí (instrucción explícita:
 * "no inventes credenciales ni contrates nada").
 */
export interface ProveedorCorreoEntrante {
  /** Nombre del proveedor, para trazabilidad en el log. */
  nombre: string;
  /** Traduce el payload crudo del webhook de ESE proveedor a la forma neutra. */
  normalizar(payloadCrudo: unknown): CorreoEntrante;
}

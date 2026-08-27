/**
 * Límites operativos del canal de correo (sección 10.3): tamaño y tasa por
 * buzón.
 *
 * Estos NO son valores tributarios (Regla de Oro 2 no aplica: no son una
 * tarifa, base, UVT ni calendario fiscal) — son parámetros de ingeniería del
 * canal de ingesta, por lo que sí pueden vivir como constantes de código, tal
 * como el resto del proyecto usa constantes para cosas como timeouts o
 * tamaños de página. Si el negocio pide hacerlos configurables por empresa
 * más adelante, se moverían a `company_setting` (007_conceptos.sql).
 */

/** Tamaño máximo de un correo completo (cuerpo + adjuntos), en bytes. */
export const TAMANO_MAXIMO_CORREO_BYTES = 25 * 1024 * 1024; // 25 MB

/** Tamaño máximo de UN adjunto individual, en bytes. */
export const TAMANO_MAXIMO_ADJUNTO_BYTES = 10 * 1024 * 1024; // 10 MB

/** Máximo de correos aceptados por buzón dentro de la ventana. */
export const LIMITE_CORREOS_POR_VENTANA = 60;

/** Ventana deslizante para el límite de tasa, en minutos. */
export const VENTANA_LIMITE_TASA_MINUTOS = 60;

export function excedeTamanoCorreo(bytes: number): boolean {
  return bytes > TAMANO_MAXIMO_CORREO_BYTES;
}

export function excedeTamanoAdjunto(bytes: number): boolean {
  return bytes > TAMANO_MAXIMO_ADJUNTO_BYTES;
}

/** Dado el conteo de correos ya recibidos en la ventana, decide si el nuevo excede el límite. */
export function excedeLimiteTasa(
  conteoEnVentana: number,
  limite: number = LIMITE_CORREOS_POR_VENTANA,
): boolean {
  return conteoEnVentana >= limite;
}

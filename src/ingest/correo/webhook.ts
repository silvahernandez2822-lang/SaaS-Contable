/**
 * Manejador del payload del webhook de correo entrante — la mitad "probable
 * sin red" de la sección 10.1.
 *
 * `manejarWebhookCorreo` es una función PURA: recibe el `unknown` que
 * llegaría en el body de una petición HTTP (ya traducido a la forma neutra
 * `CorreoEntrante` por el adaptador del proveedor, o directamente en esa
 * forma si el llamador la construye a mano en una prueba) y devuelve un
 * resultado validado, o un motivo de rechazo. No abre conexiones, no golpea
 * la base de datos, no hace DNS. El endpoint HTTP real y la cola son de A6;
 * esto es lo que ese endpoint invoca antes de encolar nada.
 */
import { z } from 'zod';
import type { CorreoEntrante, ProveedorCorreoEntrante } from './tipos';

const AdjuntoSchema = z.object({
  nombreArchivo: z.string().nullable().optional().default(null),
  contentType: z.string().nullable().optional().default(null),
  contenidoBase64: z.string().min(1, 'el adjunto no puede venir vacío'),
});

const CorreoEntranteSchema = z.object({
  messageId: z.string().nullable().optional().default(null),
  remitenteEmail: z.string().min(3, 'remitenteEmail es obligatorio'),
  remitenteNombre: z.string().nullable().optional().default(null),
  destinatarios: z.array(z.string()).min(1, 'el correo debe traer al menos un destinatario'),
  asunto: z.string().nullable().optional().default(null),
  headers: z.record(z.string(), z.string()).default({}),
  adjuntos: z.array(AdjuntoSchema).default([]),
  tamanoBytes: z.number().int().nonnegative().nullable().optional().default(null),
});

export type ResultadoWebhook =
  | { ok: true; correo: CorreoEntrante }
  | { ok: false; detalle: string };

/**
 * Valida y normaliza el payload de un webhook YA en la forma neutra (por
 * ejemplo, porque el adaptador del proveedor ya tradujo su formato propio).
 * Nunca lanza: un payload malformado es un resultado `{ ok: false }`, no una
 * excepción — el correo malformado también hay que poder registrarlo con su
 * motivo (sección 10.3), no perderlo en un 500.
 */
export function manejarWebhookCorreo(payloadCrudo: unknown): ResultadoWebhook {
  const analisis = CorreoEntranteSchema.safeParse(payloadCrudo);
  if (!analisis.success) {
    const detalle = analisis.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, detalle: `payload de webhook inválido: ${detalle}` };
  }
  return { ok: true, correo: analisis.data };
}

/** Aplica el adaptador de un proveedor concreto y luego la misma validación. */
export function manejarWebhookConAdaptador(
  proveedor: ProveedorCorreoEntrante,
  payloadCrudo: unknown,
): ResultadoWebhook {
  let correo: CorreoEntrante;
  try {
    correo = proveedor.normalizar(payloadCrudo);
  } catch (e) {
    return {
      ok: false,
      detalle: `el adaptador de ${proveedor.nombre} no pudo normalizar el payload: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  return manejarWebhookCorreo(correo);
}

const PATRON_BUZON_DEDICADO = /^empresa-[^@]+@inbox\./i;

/**
 * Elige, de los destinatarios, la dirección que corresponde a un buzón
 * dedicado (`empresa-{identificador}@inbox.dominio.com`, sección 10.1). Si
 * ninguno matchea el patrón, se usa el primer destinatario tal cual —
 * `persistencia.ts` lo buscará contra `company.buzon_email` y, si no
 * corresponde a ninguna empresa, registrará el correo como rechazado sin
 * perderlo.
 */
export function elegirBuzonDestino(correo: CorreoEntrante): string {
  const dedicado = correo.destinatarios.find((d) => PATRON_BUZON_DEDICADO.test(d));
  return (dedicado ?? correo.destinatarios[0] ?? '').toLowerCase();
}

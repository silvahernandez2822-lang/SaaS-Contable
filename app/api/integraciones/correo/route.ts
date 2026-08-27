/**
 * A13 — Endpoint HTTP del webhook de correo (Ola 2, sección 13.3).
 *
 * n8n (fuera de este repositorio) es quien recibe el correo real del
 * proveedor de inbound email, lo traduce a la forma neutra `CorreoEntrante`
 * y hace este POST con el token de integración de la firma. TODO lo que
 * decide y calcula vive en `src/integraciones/ingest-correo.ts` — esta ruta
 * es una traducción HTTP <-> función, nada más:
 *
 *   - Cuerpo del POST: `CorreoEntrante` (ver `src/ingest/correo/tipos.ts`).
 *   - Cabecera `Authorization: Bearer <token>`: el token de integración del
 *     canal `correo` (ver `docs/reportes/ola2-a13.md`, "Configuración
 *     manual de despliegue").
 *
 * Reintentos: si esta ruta responde 5xx (error no anticipado) o no responde,
 * n8n reintenta con backoff (nodo HTTP Request, sección 13.1 "reintentos y
 * manejo de fallos del ingest" — eso es orquestación de n8n, no de este
 * archivo). Un 4xx (401, 422) es una respuesta DEFINITIVA — reintentarla no
 * cambia nada sin que un humano intervenga, así que el workflow no debe
 * reintentarla (ver `n8n/ingest-correo.workflow.json`).
 */
import { procesarWebhookCorreo, TokenIntegracionInvalidoError } from '../../../../src/integraciones/index';
import { obtenerDb } from '../../../lib/db';
import { AutenticacionIntegracionAusenteError, extraerTokenBearer, respuestaError } from '../../../lib/integraciones-auth';

export async function POST(request: Request): Promise<Response> {
  let token: string;
  try {
    token = extraerTokenBearer(request);
  } catch (error) {
    if (error instanceof AutenticacionIntegracionAusenteError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    throw error;
  }

  let payloadCrudo: unknown;
  try {
    payloadCrudo = await request.json();
  } catch {
    return respuestaError(422, 'payload_invalido', 'El cuerpo de la petición no es JSON válido.');
  }

  const db = await obtenerDb();
  try {
    const resultado = await procesarWebhookCorreo(db, {
      token,
      payloadCrudo,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
    });

    if (resultado.ok) {
      return Response.json(resultado, { status: 200 });
    }

    // 4xx = definitivo, no reintentar. 401 solo para no_autenticado.
    const status = resultado.motivo === 'no_autenticado' ? 401 : 422;
    return Response.json(resultado, { status });
  } catch (error) {
    if (error instanceof TokenIntegracionInvalidoError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    // Cualquier otro error es responsabilidad de la aplicación, no del
    // remitente: 5xx, para que n8n SÍ reintente.
    return respuestaError(500, 'error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * A13 — "Facturas pendientes de revisión" (sección 13.1). Solo lectura: ver
 * `src/integraciones/notificaciones.ts`. n8n decide cómo avisar; esta ruta
 * solo contesta qué hay que avisar, para UNA empresa (`?companyId=`).
 */
import { listarFacturasPendientesParaNotificar, TokenIntegracionInvalidoError } from '../../../../../src/integraciones/index';
import { AutenticacionIntegracionAusenteError, conSesionSistema, respuestaError } from '../../../../lib/integraciones-auth';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const companyId = url.searchParams.get('companyId');
  if (!companyId) return respuestaError(422, 'falta_company_id', 'El parámetro "companyId" es obligatorio.');
  const diasMinimosParam = url.searchParams.get('diasMinimos');
  const diasMinimos = diasMinimosParam ? Number(diasMinimosParam) : undefined;

  try {
    const facturas = await conSesionSistema(request, 'correo', companyId, (tx) =>
      listarFacturasPendientesParaNotificar(tx, diasMinimos === undefined ? {} : { diasMinimos }),
    );
    return Response.json({ ok: true, facturas });
  } catch (error) {
    if (error instanceof AutenticacionIntegracionAusenteError || error instanceof TokenIntegracionInvalidoError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    return respuestaError(500, 'error', error instanceof Error ? error.message : String(error));
  }
}

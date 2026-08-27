/**
 * A13 — "Buzón que falla" (sección 13.1). Solo lectura: ver
 * `src/integraciones/notificaciones.ts`.
 */
import { listarBuzonesConFallas, TokenIntegracionInvalidoError } from '../../../../../src/integraciones/index';
import { AutenticacionIntegracionAusenteError, conSesionSistema, respuestaError } from '../../../../lib/integraciones-auth';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const companyId = url.searchParams.get('companyId');
  if (!companyId) return respuestaError(422, 'falta_company_id', 'El parámetro "companyId" es obligatorio.');
  const ventanaHorasParam = url.searchParams.get('ventanaHoras');
  const ventanaHoras = ventanaHorasParam ? Number(ventanaHorasParam) : undefined;

  try {
    const buzones = await conSesionSistema(request, 'correo', companyId, (tx) =>
      listarBuzonesConFallas(tx, ventanaHoras === undefined ? {} : { ventanaHoras }),
    );
    return Response.json({ ok: true, buzones });
  } catch (error) {
    if (error instanceof AutenticacionIntegracionAusenteError || error instanceof TokenIntegracionInvalidoError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    return respuestaError(500, 'error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * A13 — "Vencimiento tributario próximo" (sección 13.1). Solo lectura: ver
 * `src/integraciones/notificaciones.ts`. Filtra fechas ya cargadas por A1 en
 * `tax_calendar`; no calcula ningún vencimiento nuevo.
 */
import { listarVencimientosProximos, TokenIntegracionInvalidoError } from '../../../../../src/integraciones/index.js';
import { AutenticacionIntegracionAusenteError, conSesionSistema, respuestaError } from '../../../../lib/integraciones-auth.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const companyId = url.searchParams.get('companyId');
  if (!companyId) return respuestaError(422, 'falta_company_id', 'El parámetro "companyId" es obligatorio.');
  const diasVentanaParam = url.searchParams.get('diasVentana');
  const diasVentana = diasVentanaParam ? Number(diasVentanaParam) : undefined;

  try {
    const vencimientos = await conSesionSistema(request, 'correo', companyId, (tx) =>
      listarVencimientosProximos(tx, diasVentana === undefined ? {} : { diasVentana }),
    );
    return Response.json({ ok: true, vencimientos });
  } catch (error) {
    if (error instanceof AutenticacionIntegracionAusenteError || error instanceof TokenIntegracionInvalidoError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    return respuestaError(500, 'error', error instanceof Error ? error.message : String(error));
  }
}

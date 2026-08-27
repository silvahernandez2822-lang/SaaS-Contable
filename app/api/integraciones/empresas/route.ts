/**
 * A13 — Lista las empresas activas de la firma del token (Ola 2, sección 13.1).
 *
 * Insumo para que n8n itere "una llamada por empresa" contra los endpoints de
 * notificaciones (`/api/integraciones/notificaciones/*`): cada uno exige una
 * empresa elegida (RLS de tenant+empresa, D-021/D-022), igual que la bandeja
 * multi-empresa de A7. Esta ruta sí puede responder con una sesión "de
 * firma" (sin empresa): `company` tiene RLS de tenant, no de tenant+empresa.
 */
import { listarEmpresasActivasDeLaFirma, TokenIntegracionInvalidoError } from '../../../../src/integraciones/index';
import { AutenticacionIntegracionAusenteError, conSesionSistema, respuestaError } from '../../../lib/integraciones-auth';

export async function GET(request: Request): Promise<Response> {
  try {
    const empresas = await conSesionSistema(request, 'correo', null, async (tx) => {
      const { rows } = await tx.query<{ tenant_id: string }>('SELECT app.current_tenant_id() AS tenant_id');
      const tenantId = rows[0]!.tenant_id;
      return listarEmpresasActivasDeLaFirma(tx, tenantId);
    });
    return Response.json({ ok: true, empresas });
  } catch (error) {
    if (error instanceof AutenticacionIntegracionAusenteError || error instanceof TokenIntegracionInvalidoError) {
      return respuestaError(401, 'no_autenticado', error.message);
    }
    return respuestaError(500, 'error', error instanceof Error ? error.message : String(error));
  }
}

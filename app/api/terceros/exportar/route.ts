/**
 * D-084 · TAREA 2 — Descarga del maestro de terceros en Excel.
 *
 *   GET /api/terceros/exportar
 *
 * Responde el `.xlsx` con las cuatro hojas de `generarMaestroTerceros`:
 * Terceros (valor vigente), Atributos fiscales (historial completo), Actividad
 * económica (historial completo) y Papel de trabajo.
 *
 * SEGURIDAD — igual criterio que `app/api/reportes/[libro]/route.ts`:
 *   · La empresa sale EXCLUSIVAMENTE de `conSesion` (cookie + autorización de
 *     la base). No hay ningún parámetro de empresa: la RLS de las tres tablas
 *     de terceros garantiza que no se exporte ni una fila de otra empresa.
 *   · Sin cookie de sesión / sesión vencida: 401.
 *   · Sin el permiso `tercero.leer`: 403 — lo comprueba el servicio central de
 *     permisos (`exigirPermiso`), esta ruta solo traduce el error a HTTP.
 */
import { conSesion, SesionNoPresenteError } from '../../../lib/sesion';
import { SesionInvalidaError, EmpresaNoAutorizadaError } from '../../../../src/db/tenant-context';
import { PermisoInsuficienteError, exigirPermiso, PERMISOS } from '../../../../src/auth/permisos';
import { ContextoSinEmpresaError } from '../../../../src/services/terceros';
import { generarMaestroTerceros } from '../../../../src/reports/terceros-maestro';
import { libroABuffer } from '../../../../src/reports/excel';

export const dynamic = 'force-dynamic';

function json(status: number, motivo: string, detalle: string): Response {
  return Response.json({ ok: false, motivo, detalle }, { status });
}

export async function GET(): Promise<Response> {
  try {
    const workbook = await conSesion(async (tx) => {
      await exigirPermiso(tx, PERMISOS.TERCERO_LEER);
      return generarMaestroTerceros(tx);
    });
    const buffer = await libroABuffer(workbook);
    const fecha = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="terceros_${fecha}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      return json(401, 'no_autenticado', error.message);
    }
    if (error instanceof EmpresaNoAutorizadaError || error instanceof ContextoSinEmpresaError) {
      return json(403, 'empresa_no_autorizada', error.message);
    }
    if (error instanceof PermisoInsuficienteError) {
      return json(403, 'permiso_insuficiente', error.message);
    }
    console.error('[terceros/exportar] fallo técnico', error);
    return json(
      500,
      'error',
      'La exportación de terceros no se pudo generar por un problema técnico. El detalle quedó en el registro del servidor.',
    );
  }
}

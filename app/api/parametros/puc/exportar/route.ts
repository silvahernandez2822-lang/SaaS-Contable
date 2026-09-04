/**
 * D-089 · TAREA 5 (lado UI) — Descarga del PUC efectivo en Excel.
 *
 *   GET /api/parametros/puc/exportar
 *
 * CONTRATO ACORDADO CON A9 (implementa el generador; A8 solo pone el enlace y
 * este stub):
 *   · Devuelve un `.xlsx` del PUC EFECTIVO de la empresa en sesión (precedencia
 *     empresa > firma > genérico ya resuelta, D-064).
 *   · Hojas mínimas (sección 11.2):
 *       - "Datos": una fila por cuenta — codigo, nombre, nivel, naturaleza,
 *         imputable, estado, alcance, en_uso (nº conceptos), partidas_ledger,
 *         mapeo NIIF.
 *       - "Papel de trabajo": encabezado empresa / NIT / fecha de generación /
 *         responsable.
 *       - "Parámetros": modo del PUC (genérico+propio / solo propio) y totales
 *         del resumen, para que el archivo sea autoexplicativo.
 *   · Nombre de archivo: `puc_<AAAA-MM-DD>.xlsx`.
 *
 * SEGURIDAD — idéntico criterio que `app/api/terceros/exportar/route.ts`:
 *   · La empresa sale EXCLUSIVAMENTE de `conSesion` (cookie + autorización de la
 *     base). No hay parámetro de empresa: la RLS de `account` /
 *     `v_account_efectivo` aísla.
 *   · Sin sesión: 401. Sin el permiso `parametro.puc.leer`: 403.
 *
 * TODO(A9, D-089): implementar `src/reports/puc-efectivo.ts` y reemplazar el
 * 501 de abajo por la descarga real (mismo patrón que `generarMaestroTerceros`
 * + `libroABuffer`).
 */
import { conSesion, SesionNoPresenteError } from '../../../../lib/sesion';
import { SesionInvalidaError, EmpresaNoAutorizadaError } from '../../../../../src/db/tenant-context';
import { PermisoInsuficienteError, exigirPermiso, PERMISOS } from '../../../../../src/auth/permisos';
import { ContextoSinEmpresaError } from '../../../../../src/services/puc';
import { generarLibroPucEfectivo } from '../../../../../src/reports/puc-efectivo';
import { libroABuffer } from '../../../../../src/reports/excel';

export const dynamic = 'force-dynamic';

function json(status: number, motivo: string, detalle: string): Response {
  return Response.json({ ok: false, motivo, detalle }, { status });
}

export async function GET(): Promise<Response> {
  try {
    const workbook = await conSesion(async (tx) => {
      await exigirPermiso(tx, PERMISOS.PARAMETRO_PUC_LEER);
      return generarLibroPucEfectivo(tx);
    });
    const buffer = await libroABuffer(workbook);
    const fecha = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="puc_${fecha}.xlsx"`,
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
    console.error('[parametros/puc/exportar] fallo técnico', error);
    return json(500, 'error', 'No se pudo procesar la solicitud de exportación del PUC.');
  }
}

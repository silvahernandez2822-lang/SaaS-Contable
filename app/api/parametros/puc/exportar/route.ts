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
 * RASTRO EXPORT (V-54, cierre) — mismo patrón que `/api/reportes/[libro]`
 * (`app.registrar_exportacion`, migración 140): se escribe DENTRO de la misma
 * transacción y sesión que autorizó la lectura, después de generar el libro y
 * antes de devolverlo. Si el rastro no se puede escribir, el archivo no se
 * entrega — igual que en la ruta de reportes. `app.registrar_exportacion`
 * exige además `reporte.exportar`, y esta ruta lo comprueba también en JS
 * ANTES de generar nada (mismo patrón que cada `generarXxx` de
 * `src/reports/libros.ts`), para fallar con un 403 legible en vez del error
 * crudo de Postgres que la función dispararía si este paso se saltara.
 * Descargar el PUC completo de una empresa es la misma clase de extracción en
 * bloque que un libro, y queda sujeta al mismo permiso, sumado a
 * `parametro.puc.leer` que ya exigía esta ruta. Antes de este cierre,
 * `auxiliar_causacion` y `solo_lectura` podían descargar el PUC con solo
 * `parametro.puc.leer`; ahora necesitan además `reporte.exportar` — el modelo
 * de permisos es granular por usuario (ver D-090), así que una firma que lo
 * necesite se lo otorga a un usuario puntual sin tocar código.
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
      // Mismo patrón que cada `generarXxx` de `src/reports/libros.ts`: se
      // exige `reporte.exportar` aquí, en JS, ANTES de generar nada, para que
      // falle con un `PermisoInsuficienteError` legible y un 403 limpio — y no
      // con el error crudo de Postgres (SE002) que dispara internamente
      // `app.registrar_exportacion` si este paso se saltara.
      await exigirPermiso(tx, PERMISOS.REPORTE_EXPORTAR);
      const resultado = await generarLibroPucEfectivo(tx);
      // Rastro EXPORT de la 14.1 (V-54): dentro de la misma transacción, o el
      // archivo no se entrega. Ver la nota de cabecera.
      await tx.query('SELECT app.registrar_exportacion($1, $2::jsonb)', ['puc-efectivo', '{}']);
      return resultado;
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

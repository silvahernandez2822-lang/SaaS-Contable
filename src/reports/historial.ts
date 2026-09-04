/**
 * A9 — D-091 · TAREA 5. Historial de reportes exportados.
 *
 * Mismo patrón que `src/services/carga-masiva/historial.ts` (D-090, TAREA 3):
 * lee `audit_log` bajo RLS, sin tabla ni pantalla propias de auditoría. La
 * diferencia es la fila que se lee — aquí `accion = 'EXPORT' AND entidad =
 * 'reporte'`, escrita por `app.registrar_exportacion` (migración 140) desde
 * las TRES rutas que hoy dejan ese rastro: `/api/reportes/[libro]`,
 * `/api/parametros/puc/exportar` y `/api/terceros/exportar` (cierre de V-54).
 *
 * NO hay filtro de aplicación: esto corre dentro de `conSesion` y la RLS de
 * `audit_log` (`012_rls.sql`, `audit_log_rls`) ya exige
 * `tenant_id = app.current_tenant_id()` y
 * `company_id IS NULL OR company_id = app.current_company_id()` — verificado
 * leyendo la política, no solo copiado del comentario que la describe (mismo
 * criterio que D-090).
 */
import type { SqlClient } from '../db/types';

export interface FilaHistorialReporte {
  id: string;
  ocurridoEn: string;
  usuarioNombre: string | null;
  usuarioEmail: string | null;
  /** El slug del reporte (`entidad_id`): `'libro-diario'`, `'puc-efectivo'`, `'terceros-maestro'`... */
  reporteSlug: string;
  /** `valor_nuevo->>'periodo'`, tal como lo registró la ruta que generó el archivo. */
  periodo: string | null;
}

export interface HistorialReportePagina {
  filas: FilaHistorialReporte[];
  total: number;
  pagina: number;
  porPagina: number;
}

const POR_PAGINA_POR_DEFECTO = 25;

/**
 * `pagina` es 1-based, con el mismo saneo defensivo que
 * `listarHistorialCargaMasiva` (D-090, V-52): `Number.isFinite` antes de
 * acotar, para que un parámetro de URL manipulado (`NaN`, `Infinity`) nunca
 * llegue al `OFFSET` como un `bigint` inválido.
 */
function entero(valor: number | undefined, porDefecto: number, minimo: number, maximo: number): number {
  const n = Math.trunc(Number(valor ?? porDefecto));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

export async function listarHistorialReportes(
  tx: SqlClient,
  opciones: { pagina?: number; porPagina?: number } = {},
): Promise<HistorialReportePagina> {
  const pagina = entero(opciones.pagina, 1, 1, 1_000_000);
  const porPagina = entero(opciones.porPagina, POR_PAGINA_POR_DEFECTO, 1, 200);
  const offset = (pagina - 1) * porPagina;

  const { rows: totalRows } = await tx.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM audit_log WHERE accion = 'EXPORT' AND entidad = 'reporte'`,
  );
  const total = Number(totalRows[0]?.total ?? '0');

  const { rows } = await tx.query<{
    id: string;
    ocurrido_en: string;
    usuario_nombre: string | null;
    usuario_email: string | null;
    entidad_id: string | null;
    periodo: string | null;
  }>(
    `SELECT al.id::text,
            al.ocurrido_en::text,
            u.nombre_completo AS usuario_nombre,
            u.email           AS usuario_email,
            al.entidad_id,
            al.valor_nuevo->>'periodo' AS periodo
       FROM audit_log al
       LEFT JOIN "user" u ON u.id = al.user_id
      WHERE al.accion = 'EXPORT' AND al.entidad = 'reporte'
      ORDER BY al.ocurrido_en DESC, al.id DESC
      LIMIT $1 OFFSET $2`,
    [porPagina, offset],
  );

  const filas: FilaHistorialReporte[] = rows.map((r) => ({
    id: r.id,
    ocurridoEn: r.ocurrido_en,
    usuarioNombre: r.usuario_nombre,
    usuarioEmail: r.usuario_email,
    reporteSlug: r.entidad_id ?? 'desconocido',
    periodo: r.periodo,
  }));

  return { filas, total, pagina, porPagina };
}

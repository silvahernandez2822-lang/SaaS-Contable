/**
 * A8 — D-090 · TAREA 3. Historial de cargas masivas.
 *
 * Lee `audit_log WHERE accion = 'CARGA_MASIVA'` (escrita por
 * `app.registrar_carga_masiva`, migración 170 — ver `importar.ts`). NO hay
 * filtro de aplicación por tenant/empresa: la RLS de `audit_log` (012_rls.sql,
 * `audit_log_rls`) ya exige `tenant_id = app.current_tenant_id()` y
 * `company_id IS NULL OR company_id = app.current_company_id()`, así que basta
 * con correr dentro de `conSesion` para que la fila de otra firma u otra
 * empresa nunca llegue aquí (Regla de Oro 7).
 *
 * `entidad` guarda la TABLA física (`definicion.tabla`, p. ej. `third_party`),
 * no la clave del catálogo de `DEFINICIONES` (p. ej. `third_party`
 * coincide, pero `third_party_fiscal_attribute` también apunta a su propia
 * tabla — ver `importarConDefinicion` en `importar.ts`). La clave de
 * `DEFINICIONES` SÍ viaja, dentro de `valor_nuevo->>'catalogo'`, así que el
 * título legible se resuelve desde ahí con `definicionPorClave`, no desde
 * `entidad`. Si un día una definición cambiara su `tabla` sin cambiar su
 * `clave`, este historial seguiría resolviendo el título correcto porque no
 * depende de `entidad` para eso.
 */
import type { SqlClient } from '../../db/types';
import { definicionPorClave } from './definiciones';

export interface FilaHistorialCarga {
  id: string;
  ocurridoEn: string;
  usuarioNombre: string | null;
  usuarioEmail: string | null;
  catalogoClave: string | null;
  catalogoTitulo: string;
  entidad: string;
  archivo: string | null;
  filasOk: number | null;
  filasError: number | null;
}

export interface HistorialCargaPagina {
  filas: FilaHistorialCarga[];
  total: number;
  pagina: number;
  porPagina: number;
}

const POR_PAGINA_POR_DEFECTO = 25;

/**
 * `pagina` es 1-based. `porPagina` tiene un tope defensivo (200) para que un
 * parámetro de la URL manipulado a mano no dispare un `LIMIT` descomunal.
 *
 * A14 (compuerta de D-090, V-52): el saneo original era `Math.max(1,
 * Math.trunc(x))`, y eso NO sanea `NaN` ni `Infinity` — `Math.max(1, NaN)` es
 * `NaN`, que llegaba al `OFFSET` y hacía reventar la consulta con «invalid
 * input syntax for type bigint». Hoy la página lo filtra antes con
 * `Number.isFinite`, pero un servicio que se anuncia como defensivo tiene que
 * serlo con quien sea que lo llame, no solo con su único llamador de hoy.
 */
function entero(valor: number | undefined, porDefecto: number, minimo: number, maximo: number): number {
  const n = Math.trunc(Number(valor ?? porDefecto));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

export async function listarHistorialCargaMasiva(
  tx: SqlClient,
  opciones: { pagina?: number; porPagina?: number } = {},
): Promise<HistorialCargaPagina> {
  // Tope de página: con 200 por página son 200 millones de filas de auditoría,
  // más de las que ninguna firma tendrá. Sin tope, un `pagina` gigantesco
  // produce un `offset` que ya no es un entero exacto en JavaScript y se
  // serializa en notación científica: otro `bigint` inválido.
  const pagina = entero(opciones.pagina, 1, 1, 1_000_000);
  const porPagina = entero(opciones.porPagina, POR_PAGINA_POR_DEFECTO, 1, 200);
  const offset = (pagina - 1) * porPagina;

  const { rows: totalRows } = await tx.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM audit_log WHERE accion = 'CARGA_MASIVA'`,
  );
  const total = Number(totalRows[0]?.total ?? '0');

  const { rows } = await tx.query<{
    id: string;
    ocurrido_en: string;
    usuario_nombre: string | null;
    usuario_email: string | null;
    entidad: string;
    entidad_id: string | null;
    catalogo: string | null;
    filas_ok: number | null;
    filas_error: number | null;
  }>(
    `SELECT al.id::text,
            al.ocurrido_en::text,
            u.nombre_completo AS usuario_nombre,
            u.email           AS usuario_email,
            al.entidad,
            al.entidad_id,
            al.valor_nuevo->>'catalogo'                     AS catalogo,
            (al.valor_nuevo->>'filas_ok')::int              AS filas_ok,
            (al.valor_nuevo->>'filas_error')::int           AS filas_error
       FROM audit_log al
       LEFT JOIN "user" u ON u.id = al.user_id
      WHERE al.accion = 'CARGA_MASIVA'
      ORDER BY al.ocurrido_en DESC, al.id DESC
      LIMIT $1 OFFSET $2`,
    [porPagina, offset],
  );

  const filas: FilaHistorialCarga[] = rows.map((r) => {
    const definicion = r.catalogo ? definicionPorClave(r.catalogo) : undefined;
    return {
      id: r.id,
      ocurridoEn: r.ocurrido_en,
      usuarioNombre: r.usuario_nombre,
      usuarioEmail: r.usuario_email,
      catalogoClave: r.catalogo,
      catalogoTitulo: definicion?.titulo ?? r.entidad,
      entidad: r.entidad,
      archivo: r.entidad_id,
      filasOk: r.filas_ok,
      filasError: r.filas_error,
    };
  });

  return { filas, total, pagina, porPagina };
}

/**
 * A5 — El catálogo CERRADO de conceptos (sección 8.4).
 *
 * «El LLM devuelve un `concepto_id` de un catálogo cerrado, no texto libre.»
 *
 * Esta función arma la lista de opciones que viaja en el prompt y que después
 * se usa para VALIDAR la respuesta. Lo que el modelo conteste y no esté aquí
 * se descarta sin más: no se crea un concepto nuevo, no se busca el parecido,
 * no se interpreta. La línea se va a revisión humana.
 *
 * Lo que NO viaja al modelo: cuentas PUC, punteros a reglas de retención,
 * banderas de ReteICA. El modelo no necesita nada de eso para decir «esto es
 * mantenimiento de equipos», y mandárselo sería invitarlo a opinar sobre el
 * cálculo, que no es suyo (Regla de Oro 4). Menos contexto es además menos
 * tokens: es el mismo interés.
 */
import type { SqlClient } from '../db/types';
import type { ConceptoCatalogo } from './tipos';

/** Naturalezas que tienen sentido al clasificar una factura de compra. */
export const NATURALEZAS_COMPRA = ['compra', 'otro'] as const;

export interface OpcionesCatalogo {
  tenantId: string;
  companyId: string;
  /** Cuántos conceptos como máximo. Acota el costo por llamada. */
  limite?: number | null;
  naturalezas?: readonly string[];
}

/**
 * Conceptos activos visibles para la empresa: los suyos, los de su firma y los
 * del catálogo base. Orden estable por código — el prompt tiene que ser
 * byte a byte el mismo en cada reproceso (sección 8.4).
 */
export async function cargarCatalogo(
  tx: SqlClient,
  opciones: OpcionesCatalogo,
): Promise<ConceptoCatalogo[]> {
  const naturalezas = opciones.naturalezas ?? NATURALEZAS_COMPRA;
  const { rows } = await tx.query<{
    id: string;
    codigo: string;
    nombre: string;
    descripcion: string | null;
  }>(
    `SELECT DISTINCT ON (codigo) id, codigo, nombre, descripcion
       FROM concepto_causacion
      WHERE activo
        AND naturaleza = ANY($3::text[])
        AND (tenant_id  IS NULL OR tenant_id  = $1)
        AND (company_id IS NULL OR company_id = $2)
      ORDER BY codigo, (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC`,
    [opciones.tenantId, opciones.companyId, [...naturalezas]],
  );

  const catalogo = rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    descripcion: r.descripcion,
  }));

  const limite = opciones.limite;
  return limite !== null && limite !== undefined && limite > 0
    ? catalogo.slice(0, limite)
    : catalogo;
}

/** Índice código → concepto, para validar la respuesta contra el catálogo. */
export function indicePorCodigo(
  catalogo: readonly ConceptoCatalogo[],
): Map<string, ConceptoCatalogo> {
  return new Map(catalogo.map((c) => [c.codigo, c]));
}

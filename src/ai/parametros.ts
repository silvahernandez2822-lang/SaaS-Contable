/**
 * A5 — Parámetros configurables del subsistema (sección 8.3, último párrafo).
 *
 * «Parámetros configurables de este subsistema: umbral de auto-aprobación,
 *  umbral de propuesta, si la memoria es por empresa o compartida a nivel de
 *  firma, y antigüedad tras la cual una entrada de memoria se revalida.»
 *
 * Los cuatro viven en `parametro_clasificacion`, con tres niveles de alcance
 * (plataforma → firma → empresa). AQUÍ NO HAY NI UN VALOR POR DEFECTO. Si un
 * parámetro no está en la tabla, esta función devuelve `null` y el flujo se
 * niega a proponer nada: la conducta es la misma que ya tiene el motor de A3
 * cuando le falta una regla de redondeo (V-6). Un umbral inventado en el
 * código sería un umbral que nadie puede auditar ni cambiar.
 */
import type { SqlClient } from '../db/types.js';

export const CLAVE = {
  UMBRAL_AUTO_APROBACION: 'umbral_auto_aprobacion_milesimas',
  UMBRAL_PROPUESTA: 'umbral_propuesta_milesimas',
  MEMORIA_ALCANCE: 'memoria_alcance',
  MEMORIA_REVALIDAR_DIAS: 'memoria_revalidar_tras_dias',
  PROMPT_CODIGO: 'prompt_codigo',
  PROMPT_VERSION: 'prompt_version',
  PRECIO_ENTRADA: 'precio_micros_usd_por_millon_entrada',
  PRECIO_SALIDA: 'precio_micros_usd_por_millon_salida',
  COSTO_MAXIMO_DOCUMENTO: 'costo_maximo_micros_usd_por_documento',
  CATALOGO_MAXIMO: 'catalogo_maximo_conceptos',
} as const;

export type AlcanceMemoria = 'empresa' | 'firma';

export interface ParametrosClasificacion {
  umbralAutoAprobacion: number | null;
  umbralPropuesta: number | null;
  alcanceMemoria: AlcanceMemoria;
  revalidarTrasDias: number | null;
  promptCodigo: string | null;
  promptVersion: number | null;
  precioEntradaPorMillon: number | null;
  precioSalidaPorMillon: number | null;
  costoMaximoPorDocumento: number | null;
  catalogoMaximo: number | null;
  /** Claves que nadie definió. Se reportan; no se rellenan. */
  faltantes: string[];
}

interface FilaParametro {
  clave: string;
  valor: unknown;
}

function aEntero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor);
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) return Number.parseInt(valor, 10);
  return null;
}

function aTexto(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

/**
 * Lee los parámetros vigentes para una empresa, resolviendo la precedencia
 * empresa → firma → plataforma.
 *
 * Filtra por tenant y empresa de forma explícita, además de la RLS, porque
 * el worker de clasificación corre en contexto de administración (igual que
 * `procesarJobCausacion`) y ahí no hay política que lo respalde.
 */
export async function cargarParametros(
  tx: SqlClient,
  alcance: { tenantId: string; companyId: string },
): Promise<ParametrosClasificacion> {
  const claves = Object.values(CLAVE);
  const { rows } = await tx.query<FilaParametro>(
    `SELECT DISTINCT ON (clave) clave, valor
       FROM parametro_clasificacion
      WHERE clave = ANY($1::text[])
        AND (tenant_id  IS NULL OR tenant_id  = $2)
        AND (company_id IS NULL OR company_id = $3)
      ORDER BY clave, (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC`,
    [claves, alcance.tenantId, alcance.companyId],
  );

  const mapa = new Map<string, unknown>();
  for (const fila of rows) mapa.set(fila.clave, fila.valor);

  const alcanceMemoriaCrudo = aTexto(mapa.get(CLAVE.MEMORIA_ALCANCE));
  const parametros: ParametrosClasificacion = {
    umbralAutoAprobacion: aEntero(mapa.get(CLAVE.UMBRAL_AUTO_APROBACION)),
    umbralPropuesta: aEntero(mapa.get(CLAVE.UMBRAL_PROPUESTA)),
    // Ante un valor desconocido se elige SIEMPRE el alcance más estrecho.
    alcanceMemoria: alcanceMemoriaCrudo === 'firma' ? 'firma' : 'empresa',
    revalidarTrasDias: aEntero(mapa.get(CLAVE.MEMORIA_REVALIDAR_DIAS)),
    promptCodigo: aTexto(mapa.get(CLAVE.PROMPT_CODIGO)),
    promptVersion: aEntero(mapa.get(CLAVE.PROMPT_VERSION)),
    precioEntradaPorMillon: aEntero(mapa.get(CLAVE.PRECIO_ENTRADA)),
    precioSalidaPorMillon: aEntero(mapa.get(CLAVE.PRECIO_SALIDA)),
    costoMaximoPorDocumento: aEntero(mapa.get(CLAVE.COSTO_MAXIMO_DOCUMENTO)),
    catalogoMaximo: aEntero(mapa.get(CLAVE.CATALOGO_MAXIMO)),
    faltantes: claves.filter((c) => !mapa.has(c)),
  };
  return parametros;
}

/** ¿Hay con qué decidir un umbral? Sin esto, todo va a revisión humana. */
export function umbralesUtilizables(p: ParametrosClasificacion): boolean {
  return (
    p.umbralAutoAprobacion !== null &&
    p.umbralPropuesta !== null &&
    p.umbralPropuesta <= p.umbralAutoAprobacion
  );
}

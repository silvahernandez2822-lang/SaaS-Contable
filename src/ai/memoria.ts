/**
 * A5 — Memoria de decisiones (sección 8.3): el ahorro real de tokens.
 *
 * Clave `(company_id, tercero_id, patrón_normalizado)` → `concepto_id`, con
 * contador de aciertos y fecha de última confirmación. La tabla la creó A2 en
 * la Ola 0; lo que vive aquí es el ACCESO: la consulta que se hace ANTES de
 * pensar en llamar al modelo, y el registro de la decisión humana que hace que
 * la próxima factura igual no cueste un token.
 *
 * NADIE ESCRIBE MEMORIA SIN UN HUMANO DETRÁS. El paso 6 de la sección 8.3 es
 * explícito: la memoria se graba «cuando el humano aprueba o corrige». Una
 * propuesta del modelo, por alto que sea su score, NO se graba: se propone. Si
 * se grabara sola, un error del modelo se volvería permanente y silencioso,
 * y a partir de ahí ya no habría ni llamada ni revisión que lo detectara.
 */
import type { SqlClient } from '../db/types';
import { VERSION_NORMALIZADOR, patronCanonico, patronesDeMemoria } from './normalizar';
import type { AlcanceMemoria } from './parametros';

export interface EntradaMemoria {
  id: string;
  conceptoId: string;
  conceptoCodigo: string;
  patron: string;
  normalizadorVersion: number;
  aciertos: number;
  correcciones: number;
  ultimaConfirmacionEn: string;
  /** true si la entrada es de otra empresa de la misma firma (alcance 'firma'). */
  compartida: boolean;
  /** true si `ultima_confirmacion_en` superó la antigüedad de revalidación. */
  vencida: boolean;
}

export interface BusquedaMemoria {
  tenantId: string;
  companyId: string;
  terceroId: string;
  descripcion: string | null;
  alcance: AlcanceMemoria;
  /** Antigüedad tras la cual la entrada se revalida. `null` = nunca vence. */
  revalidarTrasDias: number | null;
  /** Reloj inyectable, para que las pruebas de vencimiento no dependan del día. */
  ahora?: Date;
}

interface FilaMemoria {
  id: string;
  concepto_causacion_id: string;
  concepto_codigo: string;
  patron_descripcion: string;
  normalizador_version: number;
  aciertos: number;
  correcciones: number;
  ultima_confirmacion_en: string;
  company_id: string;
  dias_desde_confirmacion: number;
}

/**
 * PASO 2 DE LA SECCIÓN 8.3 — la consulta que va ANTES del LLM.
 *
 * Busca con los dos patrones (el de la sección 8.3 y el mínimo de la Ola 1) y
 * prefiere, en este orden: la entrada de la propia empresa, la escrita con el
 * normalizador más nuevo, y la confirmada más recientemente.
 *
 * Con alcance 'firma' puede devolver una entrada de otra empresa de la MISMA
 * firma —jamás de otra firma: eso lo impide la política RLS, no este `WHERE`—.
 * En ese caso el concepto no se puede reutilizar por id (los conceptos son de
 * cada empresa): se vuelve a resolver por CÓDIGO dentro del alcance de la
 * empresa actual, y si no existe ahí, la búsqueda cuenta como fallo.
 */
export async function buscarEnMemoria(
  tx: SqlClient,
  b: BusquedaMemoria,
): Promise<EntradaMemoria | null> {
  const patrones = patronesDeMemoria(b.descripcion);
  if (patrones.length === 0) patrones.push(patronCanonico(b.descripcion));
  const preferido = patrones[0]!;
  const ahora = b.ahora ?? new Date();

  const { rows } = await tx.query<FilaMemoria>(
    `SELECT m.id,
            m.concepto_causacion_id,
            c.codigo AS concepto_codigo,
            m.patron_descripcion,
            m.normalizador_version,
            m.aciertos,
            m.correcciones,
            m.ultima_confirmacion_en::text AS ultima_confirmacion_en,
            m.company_id,
            ($6::timestamptz::date - m.ultima_confirmacion_en::date) AS dias_desde_confirmacion
       FROM memoria_clasificacion m
       JOIN concepto_causacion c ON c.id = m.concepto_causacion_id
       JOIN third_party tp       ON tp.id = m.third_party_id
      WHERE m.tenant_id = $1
        AND m.activo
        AND m.patron_descripcion = ANY($4::text[])
        AND (
              (m.company_id = $2 AND m.third_party_id = $3)
              OR ($5 AND tp.numero_documento = (SELECT numero_documento FROM third_party WHERE id = $3))
            )
      ORDER BY (m.company_id = $2) DESC,
               (m.patron_descripcion = $7) DESC,
               m.normalizador_version DESC,
               m.ultima_confirmacion_en DESC
      LIMIT 1`,
    [
      b.tenantId,
      b.companyId,
      b.terceroId,
      patrones,
      b.alcance === 'firma',
      ahora.toISOString(),
      preferido,
    ],
  );

  const fila = rows[0];
  if (!fila) return null;

  const compartida = fila.company_id !== b.companyId;
  let conceptoId = fila.concepto_causacion_id;

  if (compartida) {
    // El concepto de otra empresa no sirve: se vuelve a resolver por código
    // dentro del alcance de la empresa actual.
    const { rows: propios } = await tx.query<{ id: string }>(
      `SELECT id FROM concepto_causacion
        WHERE codigo = $1 AND activo
          AND (tenant_id  IS NULL OR tenant_id  = $2)
          AND (company_id IS NULL OR company_id = $3)
        ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC
        LIMIT 1`,
      [fila.concepto_codigo, b.tenantId, b.companyId],
    );
    const propio = propios[0];
    if (!propio) return null;
    conceptoId = propio.id;
  }

  const dias = Number(fila.dias_desde_confirmacion);
  return {
    id: fila.id,
    conceptoId,
    conceptoCodigo: fila.concepto_codigo,
    patron: fila.patron_descripcion,
    normalizadorVersion: Number(fila.normalizador_version),
    aciertos: Number(fila.aciertos),
    correcciones: Number(fila.correcciones),
    ultimaConfirmacionEn: fila.ultima_confirmacion_en,
    compartida,
    vencida: b.revalidarTrasDias !== null && dias > b.revalidarTrasDias,
  };
}

/**
 * Suma un acierto. Solo lo llama el worker de clasificación, que corre en
 * contexto de administración: `memoria_clasificacion` tiene trigger de permiso
 * ('concepto.editar', migración 016) y trigger de auditoría, así que este
 * UPDATE deja rastro y no lo puede hacer cualquiera desde una sesión.
 */
export async function contarAcierto(tx: SqlClient, memoriaId: string): Promise<void> {
  await tx.query(`UPDATE memoria_clasificacion SET aciertos = aciertos + 1 WHERE id = $1`, [
    memoriaId,
  ]);
}

export interface DecisionHumana {
  tenantId: string;
  companyId: string;
  terceroId: string;
  /** La descripción original; el patrón lo calcula esta función, no el llamador. */
  descripcion?: string | null;
  /** O el patrón ya normalizado, si viene de una fila de la cola. */
  patron?: string;
  conceptoId: string;
  usuarioId: string | null;
  /** Qué había propuesto la IA. Si coincide es aprobación; si no, corrección. */
  conceptoPropuestoId?: string | null;
  accountId?: string | null;
  costCenterId?: string | null;
}

export interface ResultadoDecision {
  memoriaId: string;
  origen: 'aprobacion_humana' | 'correccion_humana';
  aciertos: number;
  correcciones: number;
}

/**
 * PASO 6 DE LA SECCIÓN 8.3 — «cuando el humano aprueba o corrige, la decisión
 * se graba en memoria».
 *
 * Es un upsert sobre la clave natural `(company_id, third_party_id,
 * patron_descripcion)`, que es exactamente la restricción `UNIQUE` que ya
 * impone la base: dos aprobaciones simultáneas de la misma línea no crean dos
 * entradas contradictorias, la segunda actualiza la primera.
 */
export async function registrarDecisionHumana(
  tx: SqlClient,
  d: DecisionHumana,
): Promise<ResultadoDecision> {
  const patron = d.patron ?? patronCanonico(d.descripcion ?? null);
  const esCorreccion =
    d.conceptoPropuestoId !== undefined &&
    d.conceptoPropuestoId !== null &&
    d.conceptoPropuestoId !== d.conceptoId;
  const origen = esCorreccion ? 'correccion_humana' : 'aprobacion_humana';
  const sumaAcierto = esCorreccion ? 0 : 1;
  const sumaCorreccion = esCorreccion ? 1 : 0;

  const { rows } = await tx.query<{ id: string; aciertos: number; correcciones: number }>(
    `INSERT INTO memoria_clasificacion (
        tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id,
        account_id, cost_center_id, aciertos, correcciones, ultima_confirmacion_en,
        confirmado_por, origen, activo, normalizador_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, true, $12)
     ON CONFLICT (company_id, third_party_id, patron_descripcion) DO UPDATE
        SET concepto_causacion_id  = EXCLUDED.concepto_causacion_id,
            account_id             = COALESCE(EXCLUDED.account_id, memoria_clasificacion.account_id),
            cost_center_id         = COALESCE(EXCLUDED.cost_center_id, memoria_clasificacion.cost_center_id),
            aciertos               = memoria_clasificacion.aciertos + $8,
            correcciones           = memoria_clasificacion.correcciones + $9,
            ultima_confirmacion_en = now(),
            confirmado_por         = EXCLUDED.confirmado_por,
            origen                 = EXCLUDED.origen,
            activo                 = true,
            normalizador_version   = EXCLUDED.normalizador_version
     RETURNING id, aciertos, correcciones`,
    [
      d.tenantId,
      d.companyId,
      d.terceroId,
      patron,
      d.conceptoId,
      d.accountId ?? null,
      d.costCenterId ?? null,
      sumaAcierto,
      sumaCorreccion,
      d.usuarioId,
      origen,
      VERSION_NORMALIZADOR,
    ],
  );

  const fila = rows[0]!;
  return {
    memoriaId: fila.id,
    origen,
    aciertos: Number(fila.aciertos),
    correcciones: Number(fila.correcciones),
  };
}

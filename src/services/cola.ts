/**
 * A6 — Cola asíncrona de causación sobre la misma PostgreSQL (sección 5).
 *
 * Envoltorio TypeScript de la API mínima que vive en
 * `db/migrations/040_cola_documentos.sql` (`app.encolar_causacion`,
 * `app.reclamar_siguiente_job`, `app.completar_job`, `app.fallar_job`,
 * `app.reencolar_job`). La atomicidad frente a trabajadores concurrentes la
 * da esa migración (`FOR UPDATE SKIP LOCKED` en una sola sentencia); este
 * archivo no repite esa lógica en TypeScript.
 *
 * QUIÉN LLAMA QUÉ:
 *  - `encolarCausacion` la llama la sesión normal de quien ingesta el
 *    documento (`tx` ya viene de `withSessionContext`, D-021), en la MISMA
 *    transacción que inserta el `source_document`.
 *  - `reclamarSiguienteJob` / `completarJob` / `fallarJob` las llama el
 *    worker, en `withAdminContext` (ve todas las firmas; ver el comentario de
 *    cabecera de la migración 040 para por qué eso es "tarea de plataforma" y
 *    no "servir una petición de usuario").
 *  - `reencolarJob` la llama una sesión normal con el permiso
 *    `documento.reprocesar`: es una acción humana explícita, no del worker.
 */
import type { SqlClient } from '../db/types';

export type EstadoJob = 'pendiente' | 'en_proceso' | 'completado' | 'agotado';

export interface DocumentProcessingJob {
  id: string;
  tenantId: string;
  companyId: string;
  sourceDocumentId: string;
  tipo: 'causacion';
  estado: EstadoJob;
  intentos: number;
  maxIntentos: number;
  disponibleEn: string;
  payload: Record<string, unknown>;
  resultado: Record<string, unknown> | null;
  ultimoError: string | null;
  tomadoPor: string | null;
  tomadoEn: string | null;
  completadoEn: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FilaJob {
  id: string | null;
  tenant_id: string | null;
  company_id: string | null;
  source_document_id: string | null;
  tipo: string | null;
  estado: string | null;
  intentos: number | null;
  max_intentos: number | null;
  disponible_en: string | null;
  payload: Record<string, unknown> | null;
  resultado: Record<string, unknown> | null;
  ultimo_error: string | null;
  tomado_por: string | null;
  tomado_en: string | null;
  completado_en: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapFila(f: FilaJob): DocumentProcessingJob | null {
  if (f.id === null) return null; // reclamar_siguiente_job sin trabajos disponibles.
  return {
    id: f.id,
    tenantId: f.tenant_id!,
    companyId: f.company_id!,
    sourceDocumentId: f.source_document_id!,
    tipo: 'causacion',
    estado: f.estado as EstadoJob,
    intentos: Number(f.intentos),
    maxIntentos: Number(f.max_intentos),
    disponibleEn: f.disponible_en!,
    payload: f.payload ?? {},
    resultado: f.resultado,
    ultimoError: f.ultimo_error,
    tomadoPor: f.tomado_por,
    tomadoEn: f.tomado_en,
    completadoEn: f.completado_en,
    createdAt: f.created_at!,
    updatedAt: f.updated_at!,
  };
}

/**
 * Encola (o recupera, si ya existía) el trabajo de causación de un documento.
 * Idempotente por construcción: `document_processing_job_doc_tipo_uq` (D-003).
 */
export async function encolarCausacion(
  tx: SqlClient,
  sourceDocumentId: string,
  opciones: { maxIntentos?: number } = {},
): Promise<DocumentProcessingJob> {
  const { rows } = await tx.query<FilaJob>('SELECT * FROM app.encolar_causacion($1, $2)', [
    sourceDocumentId,
    opciones.maxIntentos ?? 5,
  ]);
  const job = mapFila(rows[0]!);
  if (!job) throw new Error('app.encolar_causacion no devolvió una fila.');
  return job;
}

/**
 * Reclama el siguiente trabajo pendiente y visible, o `null` si no hay
 * ninguno. Debe llamarse con `tx` en contexto de administración
 * (`withAdminContext`): la función de base de datos ve la cola de todas las
 * firmas a propósito (ver cabecera de este módulo).
 */
export async function reclamarSiguienteJob(
  tx: SqlClient,
  workerId: string,
): Promise<DocumentProcessingJob | null> {
  const { rows } = await tx.query<FilaJob>('SELECT * FROM app.reclamar_siguiente_job($1)', [
    workerId,
  ]);
  return rows[0] ? mapFila(rows[0]) : null;
}

/** Marca un trabajo como completado con éxito. `tx` en contexto de administración. */
export async function completarJob(
  tx: SqlClient,
  jobId: string,
  resultado: Record<string, unknown> | null = null,
): Promise<void> {
  await tx.query('SELECT app.completar_job($1, $2::jsonb)', [
    jobId,
    resultado === null ? null : JSON.stringify(resultado),
  ]);
}

// -----------------------------------------------------------------------------
// Backoff exponencial con tope. Son constantes TÉCNICAS de operación de cola,
// no valores tributarios (Regla de Oro 2 es sobre tarifas, bases, UVT y
// calendarios fiscales — A14 audita eso, no la política de reintentos de un
// mecanismo de infraestructura). Se mantienen como enteros para no chocar con
// el barrido de fracciones decimales de `tests/adversarial/valores-tributarios.test.ts`.
// -----------------------------------------------------------------------------

/** Espera base antes del primer reintento. */
const BACKOFF_BASE_SEGUNDOS = 30;
/** Límite para que un documento problemático no espere más de una hora entre intentos. */
const BACKOFF_MAXIMO_SEGUNDOS = 3600;

/** Backoff exponencial: 30s, 60s, 120s, 240s, ... hasta el tope de una hora. */
export function calcularBackoffSegundos(intentosRealizados: number): number {
  const exponente = Math.max(intentosRealizados - 1, 0);
  const segundos = BACKOFF_BASE_SEGUNDOS * Math.pow(2, exponente);
  return Math.min(segundos, BACKOFF_MAXIMO_SEGUNDOS);
}

/**
 * Registra un fallo del trabajo `job` (ya reclamado, con sus `intentos` ya
 * incrementados por `reclamarSiguienteJob`). Reintenta con backoff si quedan
 * intentos; si no, la fila queda `agotado` (la cola de fallidos: se consulta
 * con `estado = 'agotado'`, no se reintenta sola). `tx` en contexto de
 * administración.
 */
export async function fallarJob(
  tx: SqlClient,
  job: Pick<DocumentProcessingJob, 'id' | 'intentos'>,
  error: unknown,
): Promise<DocumentProcessingJob> {
  const mensaje = error instanceof Error ? error.message : String(error);
  const backoff = calcularBackoffSegundos(job.intentos);
  const { rows } = await tx.query<FilaJob>(
    'SELECT * FROM app.fallar_job($1, $2, $3)',
    [job.id, mensaje, backoff],
  );
  const fallado = mapFila(rows[0]!);
  if (!fallado) throw new Error(`app.fallar_job no encontró el trabajo ${job.id}.`);
  return fallado;
}

/**
 * Reencola manualmente un trabajo agotado o completado (p. ej. tras
 * clasificar a mano un documento que había quedado sin concepto). Exige el
 * permiso `documento.reprocesar`: `tx` debe venir de una sesión normal
 * (`withSessionContext`), nunca de `withAdminContext`.
 */
export async function reencolarJob(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<DocumentProcessingJob> {
  const { rows } = await tx.query<FilaJob>('SELECT * FROM app.reencolar_job($1)', [
    sourceDocumentId,
  ]);
  const job = mapFila(rows[0]!);
  if (!job) throw new Error('app.reencolar_job no devolvió una fila.');
  return job;
}

/** Consulta el estado actual del trabajo de un documento, si existe. RLS de `tx` decide qué se ve. */
export async function estadoJobDeDocumento(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<DocumentProcessingJob | null> {
  const { rows } = await tx.query<FilaJob>(
    `SELECT * FROM document_processing_job WHERE source_document_id = $1 AND tipo = 'causacion'`,
    [sourceDocumentId],
  );
  return rows[0] ? mapFila(rows[0]) : null;
}

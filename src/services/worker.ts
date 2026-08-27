/**
 * A6 — Bucle del worker de la cola (sección 5: sin Redis, sin broker; la cola
 * vive en la misma PostgreSQL).
 *
 * Este archivo es deliberadamente pequeño: toda la garantía de que dos
 * trabajadores concurrentes no procesen el mismo documento vive en
 * `app.reclamar_siguiente_job` (`FOR UPDATE SKIP LOCKED`, una sola sentencia,
 * `db/migrations/040_cola_documentos.sql`). Aquí solo se decide qué hacer con
 * lo reclamado y qué hacer si falla.
 *
 * QUIÉN LO EJECUTA: A15 decide el mecanismo de host (un proceso Node de larga
 * duración, un cron cada minuto en el tier económico, una función programada
 * de n8n de A13...). Cualquiera de esos mecanismos llama
 * `ejecutarCicloCola` repetidamente; este módulo no asume ninguno.
 */
import type { DbHandle, SqlClient } from '../db/types.js';
import { withAdminContext } from '../db/tenant-context.js';
import { reclamarSiguienteJob, fallarJob, type DocumentProcessingJob } from './cola.js';
import { procesarJobCausacion } from './causacion.js';

export type ResultadoCiclo =
  | { hizoAlgo: false }
  | { hizoAlgo: true; jobId: string; ok: true }
  | { hizoAlgo: true; jobId: string; ok: false; error: string; agotado: boolean };

/**
 * Un ciclo: reclama a lo sumo un trabajo y lo procesa hasta el final (éxito,
 * revisión manual, o fallo con reintento/agotamiento).
 *
 * TRES TRANSACCIONES A PROPÓSITO, no una:
 *  1. Reclamar (`reclamarSiguienteJob`) se COMMITEA solo. Si no, un fallo del
 *     procesamiento revertiría también el incremento de `intentos` —
 *     borraría la cuenta del reintento que se supone que acaba de pasar— y
 *     un documento roto reintentaría para siempre sin agotar nunca la cola de
 *     fallidos.
 *  2. Procesar (`procesarJobCausacion`) va en SU PROPIA transacción: si algo
 *     dentro falla a mitad de camino, esa transacción se revierte completa
 *     (nada de un asiento a medio construir), pero el trabajo sigue
 *     'en_proceso' con su intento ya contado desde el paso 1.
 *  3. Si el paso 2 falla, `fallarJob` corre en una transacción nueva para
 *     dejar el registro del error y decidir el backoff — tiene que poder
 *     escribir aunque la transacción del paso 2 se haya revertido.
 */
export async function ejecutarCicloCola(db: DbHandle, workerId: string): Promise<ResultadoCiclo> {
  const job: DocumentProcessingJob | null = await withAdminContext(db, (tx: SqlClient) =>
    reclamarSiguienteJob(tx, workerId),
  );
  if (!job) return { hizoAlgo: false };

  try {
    await withAdminContext(db, (tx: SqlClient) => procesarJobCausacion(tx, job));
    return { hizoAlgo: true, jobId: job.id, ok: true };
  } catch (error) {
    const fallado = await withAdminContext(db, (tx: SqlClient) => fallarJob(tx, job, error));
    return {
      hizoAlgo: true,
      jobId: fallado.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      agotado: fallado.estado === 'agotado',
    };
  }
}

/**
 * Corre ciclos hasta que la cola quede vacía o se alcance `maxCiclos` (red de
 * seguridad para que un flujo de trabajos que se reencolan entre sí no
 * bloquee el proceso para siempre). Útil para un cron que quiere vaciar la
 * cola de una vez, no solo tomar un trabajo.
 */
export async function vaciarCola(
  db: DbHandle,
  workerId: string,
  maxCiclos = 100,
): Promise<{ procesados: number; fallidos: number }> {
  let procesados = 0;
  let fallidos = 0;
  for (let i = 0; i < maxCiclos; i += 1) {
    const resultado = await ejecutarCicloCola(db, workerId);
    if (!resultado.hizoAlgo) break;
    if (resultado.ok) procesados += 1;
    else fallidos += 1;
  }
  return { procesados, fallidos };
}

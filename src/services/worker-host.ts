/**
 * A15 — el bucle que de verdad drena la cola, separado de `instrumentation.ts`
 * para que Next.js pueda dejarlo fuera del bundle del edge runtime (ver el
 * comentario en `instrumentation.ts`). Este módulo solo se importa desde ahí,
 * y solo cuando `NEXT_RUNTIME === 'nodejs'`.
 *
 * Apagado explícito para pruebas (`VITEST`) y configurable por si un
 * operador quiere desactivarlo (`WORKER_COLA_DESHABILITADO=1`) o ajustar su
 * frecuencia (`WORKER_COLA_INTERVALO_MS`, ver `.env.example`).
 */
import { obtenerDb } from '../../app/lib/db';
import { ejecutarCicloCola } from './worker';

function arrancar(): void {
  if (process.env.VITEST) return;
  if (process.env.WORKER_COLA_DESHABILITADO === '1') return;

  const intervaloMs = Number.parseInt(process.env.WORKER_COLA_INTERVALO_MS ?? '', 10) || 5000;
  const workerId = `web-${process.pid}`;

  const ciclo = async (): Promise<void> => {
    try {
      const db = await obtenerDb();
      // Drena todo lo que haya en cola antes de volver a esperar: si llegaron
      // 50 facturas de una vez, no hay razón para esperar 50 intervalos.
      let resultado = await ejecutarCicloCola(db, workerId);
      while (resultado.hizoAlgo) {
        // eslint-disable-next-line no-await-in-loop
        resultado = await ejecutarCicloCola(db, workerId);
      }
    } catch (error) {
      // Un ciclo que falla NO debe tumbar el proceso web: se registra y se
      // reintenta en el siguiente intervalo.
      console.error('[worker-cola] ciclo falló:', error instanceof Error ? error.message : error);
    } finally {
      setTimeout(() => void ciclo(), intervaloMs);
    }
  };

  setTimeout(() => void ciclo(), intervaloMs);
}

arrancar();

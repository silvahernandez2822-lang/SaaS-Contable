/**
 * A15 — quién ejecuta la cola de causación en producción.
 *
 * `src/services/worker.ts` deja la decisión explícita a este agente: "un
 * proceso Node de larga duración, un cron cada minuto en el tier económico, o
 * una función programada de n8n de A13". Con Render Starter (Ola 0/1,
 * `docs/reportes/entorno-y-despliegue-a15.md`) el proceso web YA es un
 * proceso Node de larga duración (no serverless, no cold start) — la opción
 * de costo cero es que ese mismo proceso también drene su propia cola, sin
 * levantar un segundo servicio pago solo para el worker (recomendación de la
 * Ola 0, techo de USD 20/mes en fase inicial).
 *
 * `register()` lo llama Next.js UNA sola vez por instancia de servidor, antes
 * de atender la primera petición. El `import()` dinámico dentro del `if` es
 * el patrón documentado por Next.js para que el bundle del edge runtime NO
 * incluya código de Node (`process.pid`, `setTimeout` de servidor, drivers de
 * base de datos): sin este patrón, Turbopack advierte porque analiza la
 * función completa aunque el `return` temprano nunca deje llegar ahí en
 * tiempo de ejecución.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./src/services/worker-host');
  }
}

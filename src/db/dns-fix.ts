/**
 * D-080 — Forzar resolución DNS IPv4-primero en cada proceso Node.
 *
 * En Windows, Node puede resolver el host de Neon por IPv6 antes que por IPv4
 * y fallar con `ENOTFOUND` cuando el IPv6 no está bien enrutado, aunque el
 * sistema operativo y el navegador resuelvan bien el mismo dominio. Con
 * `ipv4first` la conexión a Postgres deja de depender de que el IPv6 local
 * funcione.
 *
 * Este módulo es de EFECTO SECUNDARIO: se importa como PRIMERA línea de cada
 * punto de entrada (cada uno es un proceso Node independiente):
 *   - instrumentation.ts            (npm run dev / next start)
 *   - src/db/migrate-cli.ts         (npm run migrate)
 *   - src/db/seed-cli.ts            (npm run seed)
 *   - src/bootstrap/arranque-cli.ts (npm run arranque)
 *   - src/bootstrap/datos-ejemplo-cli.ts (npm run datos-ejemplo)
 *
 * El `import()` es dinámico y va dentro de un `try` porque `instrumentation.ts`
 * también se evalúa en el edge runtime de Next.js, donde `node:dns` no existe:
 * ahí simplemente no hace nada.
 */
import('node:dns')
  .then((dns) => {
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv4first');
    }
  })
  .catch(() => {
    // Runtime sin `node:dns` (edge). No hay nada que ajustar.
  });

export {};

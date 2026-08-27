/**
 * A8 — Conexión de base de datos para las rutas de Next.js.
 *
 * Singleton perezoso: Next.js recicla el proceso entre peticiones (en
 * desarrollo y en el runtime de Node de producción), así que abrir una
 * conexión por request sería tan caro como innecesario. `createDb()` decide
 * sola PGlite vs. Postgres real según `DATABASE_URL` (ver `src/db/client.ts`):
 * esta capa no lo vuelve a decidir.
 *
 * NUNCA se usa esta conexión con `withAdminContext` para servir una petición
 * de usuario (D-004): toda ruta de `app/parametros/**` pasa por
 * `withSessionContext` (`app/lib/sesion.ts`), que fija el rol `app_user` y
 * exige un token de sesión válido.
 */
import { createDb } from '../../src/db/client';
import type { DbHandle } from '../../src/db/types';

let promesa: Promise<DbHandle> | null = null;

export function obtenerDb(): Promise<DbHandle> {
  promesa ??= createDb();
  return promesa;
}

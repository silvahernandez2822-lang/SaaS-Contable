#!/usr/bin/env node
import './dns-fix';
/**
 * CLI de datos paramétricos — `npm run seed`
 *
 * D-015: los catálogos de A1 son globales (`tenant_id IS NULL`) y ninguna
 * política RLS deja escribir ahí como `app_user`. Contra un Postgres real,
 * `DATABASE_URL` debe apuntar a un rol superusuario, dueño del esquema, o con
 * BYPASSRLS — el mismo requisito que ya vale para `npm run migrate`. Nunca al
 * rol de login de la aplicación.
 *
 * Sin DATABASE_URL levanta PGlite en memoria (aplica migraciones + seeds y
 * los descarta al terminar); sirve para verificar que los seeds corren sin
 * error, igual que `migrate-cli.ts --dry` verifica el esquema.
 *
 * Opciones:
 *   --list    solo lista los archivos de seed en el orden en que se aplicarían
 *   --dir=X   directorio de seeds alterno
 */
import { createDb } from './client';
import { migrate } from './migrate';
import { DEFAULT_SEEDS_DIR, cargarSeeds, seed } from './seed';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const list = args.includes('--list');
  const dirArg = args.find((a) => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice('--dir='.length) : DEFAULT_SEEDS_DIR;

  const url = process.env.DATABASE_URL;
  const db = await createDb();

  console.log(
    url
      ? 'Motor: Postgres (DATABASE_URL) — debe ser un rol superusuario/BYPASSRLS (D-015)'
      : 'Motor: PGlite en memoria (sin DATABASE_URL; se descarta al terminar)',
  );
  console.log(`Seeds: ${dir}`);

  try {
    if (list) {
      const archivos = await cargarSeeds(dir);
      console.log(`Archivos (${archivos.length}):`);
      for (const a of archivos) console.log(`  ${a.ruta}`);
      return;
    }

    // Contra Postgres real se asume que el esquema ya está migrado. Contra
    // PGlite en memoria no hay nada que migrar todavía, así que se aplica
    // aquí para que el comando sirva de punta a punta sin pasos previos.
    if (!url) {
      await migrate(db);
    }

    const resultado = await seed(db, { dir, logger: (m) => console.log(m) });
    console.log(`Listo: ${resultado.aplicados.length} archivo(s) de seed aplicado(s).`);

    // A15 (D-057): las tablas paramétricas (PUC, tarifas, municipios) se
    // consultan en JOIN dentro del motor de reglas; sin estadísticas frescas
    // tras cargarlas de una sola vez, el planificador arranca a ciegas.
    if (resultado.aplicados.length > 0) {
      await db.exec('ANALYZE');
      console.log('Estadísticas actualizadas (ANALYZE).');
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('\nEl seed falló:\n');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

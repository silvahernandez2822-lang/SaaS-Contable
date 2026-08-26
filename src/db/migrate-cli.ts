#!/usr/bin/env node
/**
 * CLI de migraciones — `npm run migrate`
 *
 * Sin DATABASE_URL levanta PGlite en memoria, lo que solo sirve para verificar
 * que las migraciones aplican sin error (útil en CI y al desarrollar el
 * esquema). Con DATABASE_URL migra ese Postgres real.
 *
 * Opciones:
 *   --dry     solo lista las migraciones pendientes
 *   --dir=X   directorio de migraciones alterno
 */
import { createDb } from './client.js';
import { DEFAULT_MIGRATIONS_DIR, migracionesPendientes, migrate } from './migrate.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const dirArg = args.find((a) => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice('--dir='.length) : DEFAULT_MIGRATIONS_DIR;

  const url = process.env.DATABASE_URL;
  const db = await createDb();

  console.log(
    url
      ? `Motor: Postgres (DATABASE_URL)`
      : 'Motor: PGlite en memoria (sin DATABASE_URL; se descarta al terminar)',
  );
  console.log(`Migraciones: ${dir}`);

  try {
    if (dry) {
      const pendientes = await migracionesPendientes(db, dir);
      if (pendientes.length === 0) {
        console.log('No hay migraciones pendientes.');
      } else {
        console.log(`Pendientes (${pendientes.length}):`);
        for (const p of pendientes) console.log(`  ${p}`);
      }
      return;
    }

    const resultado = await migrate(db, { dir, logger: (m) => console.log(m) });
    if (resultado.aplicadas.length === 0) {
      console.log(`Sin cambios. ${resultado.yaAplicadas.length} migraciones ya estaban aplicadas.`);
    } else {
      console.log(
        `Listo: ${resultado.aplicadas.length} migración(es) aplicada(s), ` +
          `${resultado.yaAplicadas.length} ya estaban.`,
      );
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('\nLa migración falló:\n');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

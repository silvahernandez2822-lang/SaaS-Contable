import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SqlClient } from './types';

/**
 * Runner de migraciones (D-002: SQL plano, sin ORM).
 *
 * Reglas:
 *  - Los archivos se llaman `NNN_nombre.sql` y se aplican en orden numérico.
 *  - Cada migración corre dentro de su propia transacción.
 *  - Una migración ya aplicada NO se edita: el runner guarda su checksum y
 *    aborta si cambia. Para modificar el esquema se agrega una migración nueva.
 */

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../db/migrations', import.meta.url),
);

export interface MigrationFile {
  version: number;
  nombre: string;
  archivo: string;
  ruta: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  aplicadas: string[];
  yaAplicadas: string[];
}

const NOMBRE_MIGRACION = /^(\d{3,})_([A-Za-z0-9_-]+)\.sql$/;

/** Normaliza saltos de línea para que el checksum no dependa del checkout. */
function checksumDe(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function cargarMigraciones(
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationFile[]> {
  const entradas = await readdir(dir);
  const archivos = entradas.filter((f) => NOMBRE_MIGRACION.test(f)).sort();

  const migraciones: MigrationFile[] = [];
  for (const archivo of archivos) {
    const m = NOMBRE_MIGRACION.exec(archivo);
    if (!m) continue;
    const ruta = path.join(dir, archivo);
    const sql = await readFile(ruta, 'utf8');
    migraciones.push({
      version: Number(m[1]),
      nombre: m[2] ?? archivo,
      archivo,
      ruta,
      sql,
      checksum: checksumDe(sql),
    });
  }

  migraciones.sort((a, b) => a.version - b.version);

  const vistas = new Set<number>();
  for (const mig of migraciones) {
    if (vistas.has(mig.version)) {
      throw new Error(`Versión de migración duplicada: ${mig.version} (${mig.archivo})`);
    }
    vistas.add(mig.version);
  }

  return migraciones;
}

async function crearTablaControl(db: SqlClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version     integer PRIMARY KEY,
      nombre      text NOT NULL,
      archivo     text NOT NULL,
      checksum    text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now(),
      duracion_ms integer
    );
  `);
}

export interface MigrateOptions {
  dir?: string;
  logger?: (mensaje: string) => void;
}

export async function migrate(
  db: SqlClient,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const log = options.logger ?? (() => {});

  await crearTablaControl(db);

  const migraciones = await cargarMigraciones(dir);
  const { rows: aplicadasEnBd } = await db.query<{
    version: number;
    archivo: string;
    checksum: string;
  }>('SELECT version, archivo, checksum FROM schema_migration ORDER BY version');

  const porVersion = new Map(aplicadasEnBd.map((r) => [Number(r.version), r]));

  // Una migración aplicada es inmutable (convención de ESTADO_PROYECTO.md).
  for (const mig of migraciones) {
    const previa = porVersion.get(mig.version);
    if (previa && previa.checksum !== mig.checksum) {
      throw new Error(
        `La migración ${mig.archivo} ya fue aplicada y su contenido cambió ` +
          `(checksum ${previa.checksum.slice(0, 12)} -> ${mig.checksum.slice(0, 12)}). ` +
          'Las migraciones aplicadas no se editan: agregue una migración nueva.',
      );
    }
  }

  const aplicadas: string[] = [];
  const yaAplicadas: string[] = [];

  for (const mig of migraciones) {
    if (porVersion.has(mig.version)) {
      yaAplicadas.push(mig.archivo);
      continue;
    }
    const inicio = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.exec(mig.sql);
        await tx.query(
          `INSERT INTO schema_migration (version, nombre, archivo, checksum, duracion_ms)
           VALUES ($1, $2, $3, $4, $5)`,
          [mig.version, mig.nombre, mig.archivo, mig.checksum, Date.now() - inicio],
        );
      });
    } catch (error) {
      const causa = error instanceof Error ? error.message : String(error);
      throw new Error(`Falló la migración ${mig.archivo}: ${causa}`, { cause: error });
    }
    aplicadas.push(mig.archivo);
    log(`  aplicada ${mig.archivo} (${Date.now() - inicio} ms)`);
  }

  return { aplicadas, yaAplicadas };
}

/** Migraciones pendientes, sin aplicarlas. */
export async function migracionesPendientes(
  db: SqlClient,
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  await crearTablaControl(db);
  const migraciones = await cargarMigraciones(dir);
  const { rows } = await db.query<{ version: number }>('SELECT version FROM schema_migration');
  const aplicadas = new Set(rows.map((r) => Number(r.version)));
  return migraciones.filter((m) => !aplicadas.has(m.version)).map((m) => m.archivo);
}

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SqlClient } from './types.js';

/**
 * Cargador de datos paramétricos normativos (Agente A1, sección 7).
 *
 * NO es un runner de migraciones: no toca el esquema, no lleva tabla de
 * control ni checksum inmutable. Cada archivo `.sql` bajo `db/seeds/` es
 * DATO, se aplica con `INSERT ... WHERE NOT EXISTS (...)` y por eso es
 * idempotente por diseño — correrlo dos veces no duplica filas ni choca con
 * el trigger de vigencia (`PR002`, no-solape).
 *
 * Orden de aplicación: alfabético por ruta relativa. Los directorios
 * `tanda1/` (mínimo para los 20 casos dorados) se aplican antes que
 * `tanda2/` (resto de la sección 6) porque "tanda1" ordena antes que
 * "tanda2"; dentro de cada tanda, el prefijo numérico de cada archivo
 * (010_, 020_, ...) fija el orden de dependencias (PUC y catálogos antes que
 * las reglas que los referencian).
 *
 * D-015: los catálogos que puebla A1 son globales (`tenant_id IS NULL`) y
 * ninguna política RLS permite escribir ahí como `app_user`. Este cargador
 * debe invocarse SIEMPRE dentro de `asAdmin` (superusuario / BYPASSRLS),
 * nunca con una sesión de tenant.
 */

export const DEFAULT_SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

export interface SeedFile {
  ruta: string;
  archivo: string;
  sql: string;
}

export interface SeedOptions {
  dir?: string;
  logger?: (mensaje: string) => void;
}

export interface SeedResult {
  aplicados: string[];
}

async function listarSqlRecursivo(dir: string, base = dir): Promise<SeedFile[]> {
  const entradas = await readdir(dir, { withFileTypes: true });
  const archivos: SeedFile[] = [];
  for (const entrada of entradas) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...(await listarSqlRecursivo(ruta, base)));
    } else if (entrada.isFile() && entrada.name.endsWith('.sql')) {
      const sql = await readFile(ruta, 'utf8');
      archivos.push({ ruta: path.relative(base, ruta).replace(/\\/g, '/'), archivo: entrada.name, sql });
    }
  }
  return archivos.sort((a, b) => a.ruta.localeCompare(b.ruta));
}

/** Lista los archivos de seed en el orden en que se aplicarían, sin ejecutarlos. */
export async function cargarSeeds(dir: string = DEFAULT_SEEDS_DIR): Promise<SeedFile[]> {
  return listarSqlRecursivo(dir);
}

/**
 * Aplica todos los archivos de `db/seeds/` (o `dir`) en orden. Cada archivo
 * corre en su propia transacción: si uno falla, los anteriores quedan
 * aplicados (son idempotentes, así que reintentar es seguro) y el error
 * identifica exactamente cuál falló.
 */
export async function seed(db: SqlClient, options: SeedOptions = {}): Promise<SeedResult> {
  const dir = options.dir ?? DEFAULT_SEEDS_DIR;
  const log = options.logger ?? (() => {});

  const archivos = await listarSqlRecursivo(dir);
  const aplicados: string[] = [];

  for (const archivo of archivos) {
    try {
      await db.transaction(async (tx) => {
        await tx.exec(archivo.sql);
      });
    } catch (error) {
      const causa = error instanceof Error ? error.message : String(error);
      throw new Error(`Falló el seed ${archivo.ruta}: ${causa}`, { cause: error });
    }
    aplicados.push(archivo.ruta);
    log(`  aplicado ${archivo.ruta}`);
  }

  return { aplicados };
}

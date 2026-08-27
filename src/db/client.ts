import { PGlite } from '@electric-sql/pglite';
import type { DbHandle, QueryResult, SqlClient } from './types';

/**
 * Crea el cliente de base de datos.
 *
 * - Si hay `DATABASE_URL` (o se pasa `databaseUrl`), se conecta a ese Postgres
 *   real con postgres.js.
 * - Si no, levanta una instancia de PGlite (PostgreSQL 18.3 compilado a WASM,
 *   en proceso, sin servidor). Es la ruta por defecto de las pruebas: no
 *   requiere Docker ni psql (D-003).
 *
 * Las mismas migraciones `.sql` se aplican a ambos.
 */
export interface CreateDbOptions {
  /** Cadena de conexión. Por defecto `process.env.DATABASE_URL`. */
  databaseUrl?: string | undefined;
  /** Directorio de datos de PGlite. Sin él, la BD vive solo en memoria. */
  dataDir?: string | undefined;
}

export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (url && url.trim() !== '') {
    return createPostgresDb(url);
  }
  return createPgliteDb(options.dataDir);
}

// -----------------------------------------------------------------------------
// PGlite
// -----------------------------------------------------------------------------

type PgliteLike = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
};

function wrapPglite(inner: PgliteLike, nested: boolean): SqlClient {
  const client: SqlClient = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      const result = await inner.query<T>(text, params ? [...params] : undefined);
      return { rows: result.rows };
    },
    async exec(text: string): Promise<void> {
      await inner.exec(text);
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      if (nested) {
        // Ya estamos dentro de una transacción: se reutiliza.
        return fn(client);
      }
      const db = inner as unknown as {
        transaction<R>(cb: (tx: PgliteLike) => Promise<R>): Promise<R>;
      };
      return db.transaction(async (tx) => fn(wrapPglite(tx, true)));
    },
  };
  return client;
}

export async function createPgliteDb(dataDir?: string | undefined): Promise<DbHandle> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const base = wrapPglite(pg as unknown as PgliteLike, false);
  return {
    driver: 'pglite',
    query: base.query,
    exec: base.exec,
    transaction: base.transaction,
    async close() {
      await pg.close();
    },
  };
}

// -----------------------------------------------------------------------------
// postgres.js — se importa de forma diferida para que la ruta PGlite no
// necesite cargar el driver de red.
// -----------------------------------------------------------------------------

type PostgresTag = {
  unsafe(
    text: string,
    params?: unknown[],
    options?: { simple?: boolean },
  ): PromiseLike<unknown[]> & { simple(): Promise<unknown[]> };
  begin<T>(cb: (tx: PostgresTag) => Promise<T>): Promise<T>;
  end(opts?: { timeout?: number }): Promise<void>;
};

function wrapPostgres(sql: PostgresTag, nested: boolean): SqlClient {
  const client: SqlClient = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      // `simple: false` explícito: sin parámetros postgres.js elegiría el
      // protocolo simple, cuyo formato de resultado difiere.
      const rows = (await sql.unsafe(text, params ? [...params] : [], {
        simple: false,
      })) as unknown as T[];
      return { rows: [...rows] };
    },
    async exec(text: string): Promise<void> {
      // `.simple()` fuerza el protocolo simple, único que admite varias
      // sentencias en un mismo envío (necesario para las migraciones).
      await sql.unsafe(text).simple();
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      if (nested) return fn(client);
      return sql.begin(async (tx) => fn(wrapPostgres(tx, true)));
    },
  };
  return client;
}

export async function createPostgresDb(databaseUrl: string): Promise<DbHandle> {
  const { default: postgres } = await import('postgres');
  // Nota (D-005): postgres.js entrega `int8` como string y `numeric` como
  // string. Es lo correcto para centavos y tarifas: convertirlos a Number
  // perdería precisión. PGlite se comporta igual con numeric.
  const sql = postgres(databaseUrl, {
    max: 5,
    onnotice: () => {},
  }) as unknown as PostgresTag;

  const base = wrapPostgres(sql, false);
  return {
    driver: 'postgres',
    query: base.query,
    exec: base.exec,
    transaction: base.transaction,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

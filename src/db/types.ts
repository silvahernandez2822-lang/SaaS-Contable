/**
 * Contrato mínimo de acceso a datos.
 *
 * La suite de pruebas corre sobre PGlite (PostgreSQL 18.3 en WASM) y producción
 * sobre un Postgres gestionado. Ambas implementan esta misma interfaz, así que
 * ni las pruebas ni los servicios saben cuál está debajo (D-003).
 */

export interface QueryResult<T> {
  rows: T[];
}

export interface SqlClient {
  /** Consulta parametrizada. Los parámetros van como $1, $2, ... */
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;

  /** Ejecuta una o varias sentencias sin parámetros (DDL, migraciones). */
  exec(text: string): Promise<void>;

  /**
   * Abre una transacción. Si `fn` lanza, se hace ROLLBACK.
   * Si ya se está dentro de una transacción, reutiliza la actual.
   */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

export interface DbHandle extends SqlClient {
  readonly driver: 'pglite' | 'postgres';
  close(): Promise<void>;
}

/**
 * Error de PostgreSQL tal como lo entregan PGlite y postgres.js: ambos exponen
 * `code` con el SQLSTATE. Las pruebas de la compuerta verifican ESE código,
 * porque un rechazo que no venga del motor no cuenta (D-003).
 */
export interface PostgresError extends Error {
  code?: string;
  severity?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

export function isPostgresError(e: unknown): e is PostgresError {
  return e instanceof Error && typeof (e as PostgresError).code === 'string';
}

/** SQLSTATE propios del dominio. Definidos en db/migrations/001_fundacion.sql. */
export const SQLSTATE = {
  LEDGER_INMUTABLE: 'LG001',
  ASIENTO_DESBALANCEADO: 'LG002',
  ASIENTO_SIN_PARTIDAS: 'LG003',
  CUENTA_NO_IMPUTABLE: 'LG004',
  PERIODO_CERRADO: 'LG005',
  ASIENTO_SIN_APROBACION: 'LG006',
  ASIENTO_DEBE_NACER_BORRADOR: 'LG007',
  REVERSA_INVALIDA: 'LG008',
  VIGENCIA_INMUTABLE: 'PR001',
  VIGENCIA_SOLAPADA: 'PR002',
  VIGENCIA_NO_BORRABLE: 'PR003',
  AUDITORIA_INMUTABLE: 'AU001',
  /**
   * La fila referenciada existe, pero pertenece a otra firma o a otra empresa
   * (018). Las comprobaciones de clave foránea no pasan por RLS, así que sin
   * este guardia el ledger podría referenciar un plan de cuentas ajeno (D-032).
   */
  FK_ALCANCE_AJENO: 'AL001',
  /** Seguridad (A12, migraciones 015 y 016). */
  SESION_INVALIDA: 'SE001',
  PERMISO_INSUFICIENTE: 'SE002',
  EMPRESA_NO_AUTORIZADA: 'SE003',
  MFA_REQUERIDO: 'SE004',
  CREDENCIAL_INVALIDA: 'SE005',
  /** SQLSTATE estándar de PostgreSQL usados por las pruebas. */
  RLS_VIOLATION: '42501',
  UNIQUE_VIOLATION: '23505',
  NOT_NULL_VIOLATION: '23502',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

export type SqlState = (typeof SQLSTATE)[keyof typeof SQLSTATE];

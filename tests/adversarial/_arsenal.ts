/**
 * Utilidades propias de A14. No se apoyan en las aserciones de A2 ni de A12.
 *
 * La única pieza que se comparte con ellos es el harness de base de datos
 * (`tests/helpers/db.ts`), porque levantar una segunda copia de las migraciones
 * probaría un esquema distinto del que se despliega. A cambio, la primera
 * batería de `compuerta-ola0.test.ts` audita el harness ANTES de confiar en él:
 * si `asTenant` no estuviera degradando de verdad a `app_user`, todo lo demás
 * sería un falso PASS y hay que enterarse ahí, no al final.
 */
import type { SqlClient } from '../../src/db/types';
import { isPostgresError } from '../../src/db/types';

export interface RechazoDelMotor {
  code: string;
  message: string;
}

/**
 * Ejecuta `fn` y exige que PostgreSQL la rechace. Devuelve el SQLSTATE.
 *
 * Diferencia deliberada con `esperarErrorPg` de A2: aquí NO se pasa el SQLSTATE
 * esperado. Primero se comprueba que el rechazo viene del motor, y la prueba
 * decide después qué código acepta. Así una prueba no puede "pasar" porque el
 * código que buscaba coincidiera con el de un error accidental de sintaxis: el
 * SQLSTATE se compara contra una lista cerrada y explícita en cada caso.
 */
export async function rechazoDelMotor(
  fn: () => Promise<unknown>,
  descripcion: string,
): Promise<RechazoDelMotor> {
  let capturado: unknown;
  let lanzo = false;
  try {
    await fn();
  } catch (e) {
    lanzo = true;
    capturado = e;
  }

  if (!lanzo) {
    throw new Error(
      `FALSO PASS: se esperaba que el MOTOR rechazara ${descripcion}, y la operación tuvo éxito.`,
    );
  }
  if (!isPostgresError(capturado) || typeof capturado.code !== 'string') {
    throw new Error(
      `FALSO PASS: ${descripcion} fue rechazada, pero por TypeScript, no por PostgreSQL. ` +
        `Llegó: ${capturado instanceof Error ? `${capturado.name}: ${capturado.message}` : String(capturado)}. ` +
        'Una garantía que sostiene un throw de la aplicación no es una garantía de la base de datos.',
    );
  }
  return { code: capturado.code, message: capturado.message };
}

/** Igual que la anterior, pero exigiendo uno de varios SQLSTATE aceptables. */
export async function rechazoConCodigo(
  fn: () => Promise<unknown>,
  codigosAceptables: readonly string[],
  descripcion: string,
): Promise<RechazoDelMotor> {
  const r = await rechazoDelMotor(fn, descripcion);
  if (!codigosAceptables.includes(r.code)) {
    throw new Error(
      `${descripcion}: el motor rechazó con SQLSTATE ${r.code}, que no está entre ` +
        `[${codigosAceptables.join(', ')}]. Mensaje: ${r.message}`,
    );
  }
  return r;
}

/** Fotografía completa de una fila, para comparar byte a byte más tarde. */
export async function fotoDeFila(
  tx: SqlClient,
  tabla: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await tx.query<{ fila: Record<string, unknown> }>(
    `SELECT to_jsonb(t.*) AS fila FROM ${tabla} t WHERE t.id = $1`,
    [id],
  );
  return rows[0]?.fila ?? null;
}

/** Todas las tablas de `public` que llevan la columna indicada. */
export async function tablasCon(tx: SqlClient, columna: string): Promise<string[]> {
  const { rows } = await tx.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = $1 AND t.table_type = 'BASE TABLE'
      ORDER BY 1`,
    [columna],
  );
  return rows.map((r) => r.table_name);
}

/** Identificador SQL seguro para interpolar (las tablas salen del catálogo). */
export function comillas(identificador: string): string {
  return `"${identificador.replace(/"/g, '""')}"`;
}

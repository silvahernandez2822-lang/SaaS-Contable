/**
 * Emisión y cierre de sesiones — Agente A12.
 *
 * El token es el ÚNICO secreto que viaja al cliente: 32 bytes de
 * `randomBytes`, en base64url. De él, la base de datos guarda solo
 * `sha256(token)` en `app.session_context`; el token en claro no se almacena en
 * ninguna parte. Un volcado de la base no permite reconstruir sesiones vivas.
 *
 * El hash se calcula exactamente igual en los dos lados:
 *   TypeScript:  createHash('sha256').update(token, 'utf8').digest('hex')
 *   PostgreSQL:  encode(sha256(convert_to(token,'utf8')), 'hex')
 * Hay una prueba que compara ambos resultados, para que no se separen.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SqlClient } from '../db/types';
import { withAuthContext } from '../db/tenant-context';

/** Vigencia por defecto de una sesión: 8 horas, la jornada de trabajo. */
export const MINUTOS_SESION_POR_DEFECTO = 480;
/** Tope duro impuesto también en `app.abrir_sesion` (SE001). */
export const MINUTOS_SESION_MAXIMO = 1440;

/** Token opaco de sesión. 32 bytes = 256 bits de entropía. */
export function generarTokenSesion(): string {
  return randomBytes(32).toString('base64url');
}

/** Mismo cálculo que `app.hash_token` en la base de datos. */
export function hashTokenSesion(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface DatosSesion {
  sessionId: string;
  token: string;
  expiraEn: Date;
  userId: string;
  tenantId: string;
  mfaSuperado: boolean;
}

export interface OpcionesAbrirSesion {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  mfaSuperado?: boolean;
  minutos?: number;
}

/**
 * Emite una sesión. Corre con el rol `app_auth`: `app_user` no tiene EXECUTE
 * sobre `app.abrir_sesion`, precisamente para que una inyección SQL dentro de
 * una petición ya autenticada no pueda fabricarse una sesión (D-023).
 *
 * `app.abrir_sesion` valida el usuario contra el espejo `app.usuario` y deriva
 * el tenant de ahí: nunca acepta un tenant que le pase el llamador.
 */
export async function abrirSesion(
  db: SqlClient,
  opciones: OpcionesAbrirSesion,
): Promise<DatosSesion> {
  const token = generarTokenSesion();
  const minutos = opciones.minutos ?? MINUTOS_SESION_POR_DEFECTO;

  return withAuthContext(db, async (tx) => {
    const { rows } = await tx.query<{ session_id: string }>(
      'SELECT app.abrir_sesion($1, $2, $3::inet, $4, $5, $6) AS session_id',
      [
        opciones.userId,
        token,
        opciones.ip ?? null,
        opciones.userAgent ?? null,
        opciones.mfaSuperado ?? false,
        minutos,
      ],
    );
    const sessionId = rows[0]!.session_id;

    const { rows: detalle } = await tx.query<{
      tenant_id: string;
      user_id: string;
      expira_en: string | Date;
      mfa_superado: boolean;
    }>(
      `SELECT (app.sesion_actual()).tenant_id    AS tenant_id,
              (app.sesion_actual()).user_id      AS user_id,
              (app.sesion_actual()).expira_en    AS expira_en,
              (app.sesion_actual()).mfa_superado AS mfa_superado`,
    );
    const d = detalle[0]!;

    return {
      sessionId,
      token,
      expiraEn: d.expira_en instanceof Date ? d.expira_en : new Date(d.expira_en),
      userId: d.user_id,
      tenantId: d.tenant_id,
      mfaSuperado: d.mfa_superado,
    };
  });
}

/** Cierra la sesión del token dado. `false` si ya estaba cerrada o no existe. */
export async function cerrarSesion(db: SqlClient, token: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE app_user');
    const { rows } = await tx.query<{ cerrada: boolean }>(
      'SELECT app.cerrar_sesion($1) AS cerrada',
      [token],
    );
    return rows[0]?.cerrada === true;
  });
}

/** Revoca todas las sesiones vivas de un usuario. Devuelve cuántas cerró. */
export async function revocarSesionesDeUsuario(db: SqlClient, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE app_user');
    const { rows } = await tx.query<{ n: number | string }>(
      'SELECT app.revocar_sesiones_de_usuario($1) AS n',
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  });
}

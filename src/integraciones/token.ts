/**
 * A13 — Tokens de integración (Ola 2, sección 13.3).
 *
 * Envoltorio TypeScript de las funciones SQL de `090_a13_sesion_sistema_
 * integraciones.sql`. Todo lo que valida identidad y alcance vive en la base
 * (D-021/D-023): estas funciones no deciden nada, solo empaquetan.
 *
 * `crearTokenIntegracion`/`revocarTokenIntegracion`/`listarTokensIntegracion`
 * se llaman desde una sesión NORMAL ya autenticada (un humano con
 * `usuario.administrar`), con `tx` ya situado en su empresa/firma — igual que
 * cualquier otro servicio de `src/services`. `autenticarTokenIntegracion` es
 * la excepción: corre en el camino de autenticación (`app_auth`), igual que
 * `buscarCredencial` en `src/auth/autenticacion.ts`.
 */
import type { SqlClient } from '../db/types.js';
import { withAuthContext } from '../db/tenant-context.js';
import { generarTokenSesion, hashTokenSesion } from '../auth/sesion.js';

export type CanalIntegracion = 'correo';

export interface TokenIntegracionEmitido {
  id: string;
  /** El secreto en claro. Se devuelve UNA sola vez; la base solo guarda su hash. */
  token: string;
}

/** Emite (o rota) el token del canal indicado para la firma en sesión. */
export async function crearTokenIntegracion(
  tx: SqlClient,
  input: { userId: string; canal: CanalIntegracion; nombre: string },
): Promise<TokenIntegracionEmitido> {
  const token = generarTokenSesion();
  const { rows } = await tx.query<{ id: string }>(
    'SELECT app.crear_token_integracion($1, $2, $3, $4) AS id',
    [input.userId, input.canal, input.nombre, token],
  );
  return { id: rows[0]!.id, token };
}

/** Revoca un token. `true` si había uno vivo con ese id en la firma en sesión. */
export async function revocarTokenIntegracion(tx: SqlClient, id: string): Promise<boolean> {
  const { rows } = await tx.query<{ revocado: boolean }>(
    'SELECT app.revocar_token_integracion($1) AS revocado',
    [id],
  );
  return rows[0]?.revocado === true;
}

export interface TokenIntegracionResumen {
  id: string;
  canal: CanalIntegracion;
  nombre: string;
  creadoEn: string;
  ultimoUsoEn: string | null;
  revocadoEn: string | null;
}

/** Tokens de la firma en sesión. Nunca incluye el secreto: ya no existe en claro en ningún lado. */
export async function listarTokensIntegracion(tx: SqlClient): Promise<TokenIntegracionResumen[]> {
  const { rows } = await tx.query<{
    id: string;
    canal: CanalIntegracion;
    nombre: string;
    creado_en: string;
    ultimo_uso_en: string | null;
    revocado_en: string | null;
  }>('SELECT * FROM app.listar_tokens_integracion()');
  return rows.map((r) => ({
    id: r.id,
    canal: r.canal,
    nombre: r.nombre,
    creadoEn: r.creado_en,
    ultimoUsoEn: r.ultimo_uso_en,
    revocadoEn: r.revocado_en,
  }));
}

export interface IdentidadIntegracion {
  userId: string;
  tenantId: string;
  canal: CanalIntegracion;
}

/**
 * Autentica un token de integración (rol `app_auth`, camino de autenticación).
 * `null` si el token es ausente, no existe, está revocado o el usuario de
 * sistema no está activo — nunca se distingue el motivo hacia afuera (mismo
 * criterio que `iniciarSesion`: el detalle solo queda en el registro interno).
 */
export async function autenticarTokenIntegracion(
  db: SqlClient,
  token: string,
): Promise<IdentidadIntegracion | null> {
  if (!token || token.trim() === '') return null;
  return withAuthContext(db, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; tenant_id: string; canal: CanalIntegracion }>(
      'SELECT * FROM app.autenticar_token_integracion($1)',
      [token],
    );
    const fila = rows[0];
    if (!fila) return null;
    return { userId: fila.user_id, tenantId: fila.tenant_id, canal: fila.canal };
  });
}

/** Mismo cálculo que la base (`app.hash_token`), para comparar en pruebas sin exponer el secreto. */
export function hashTokenIntegracion(token: string): string {
  return hashTokenSesion(token);
}

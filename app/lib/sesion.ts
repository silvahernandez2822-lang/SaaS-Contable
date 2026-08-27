/**
 * A8 — Contexto de sesión para las rutas de `app/parametros/**`.
 *
 * ADVERTENCIA DE ALCANCE: en esta ola todavía no existe una pantalla de
 * login (es trabajo de A12/A7). Esta capa NO inventa autenticación propia:
 * simplemente traduce la cookie de sesión — con el nombre y las propiedades
 * (`HttpOnly; Secure; SameSite=Lax`) que ya documenta
 * `src/auth/autenticacion.ts` — al contrato `SessionContext` que
 * `withSessionContext` exige (`src/db/tenant-context.ts`). Cuando A12/A7
 * entreguen el login, solo hace falta que escriban esa misma cookie; esta
 * capa no cambia.
 *
 * LA GARANTÍA DE SEGURIDAD NO ESTÁ AQUÍ. Si la cookie falta, es inválida o
 * pertenece a una sesión vencida, `withSessionContext` lo detecta contra la
 * base de datos (`SesionInvalidaError`) — nunca se confía en el contenido de
 * la cookie por sí solo (D-020/D-021).
 */
import { cookies, headers } from 'next/headers';
import { obtenerDb } from './db.js';
import { withSessionContext, type SessionContext } from '../../src/db/tenant-context.js';
import type { SqlClient } from '../../src/db/types.js';

export const COOKIE_SESSION_TOKEN = 'session_token';
/** Empresa que el usuario eligió en el selector de la interfaz. Vacía u
 * omitida = sesión "de firma", sin empresa (edición de parámetros
 * compartidos entre empresas — ver sección 6.2 y D-015). */
export const COOKIE_COMPANY_ID = 'company_id';

export class SesionNoPresenteError extends Error {
  constructor() {
    super('No hay una sesión iniciada. Inicie sesión para administrar parámetros.');
    this.name = 'SesionNoPresenteError';
  }
}

/** `companyIdOverride === undefined` lee la empresa de la cookie (el
 * comportamiento histórico de `conSesion`); cualquier otro valor (incluida
 * `''`, sesión "de firma") lo reemplaza. Usado por A7 para la bandeja
 * multi-empresa (`app/lib/bandeja.ts`), que necesita abrir una sesión POR
 * EMPRESA sin depender de cuál esté seleccionada en la cookie. */
async function contextoDesdeRequest(companyIdOverride?: string | null): Promise<SessionContext> {
  const jarra = await cookies();
  const cabeceras = await headers();
  const sessionToken = jarra.get(COOKIE_SESSION_TOKEN)?.value ?? '';
  if (!sessionToken) throw new SesionNoPresenteError();
  const companyId = companyIdOverride !== undefined ? companyIdOverride : jarra.get(COOKIE_COMPANY_ID)?.value || null;
  return {
    sessionToken,
    companyId,
    ip: (cabeceras.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
    userAgent: cabeceras.get('user-agent'),
  };
}

/** Ejecuta `fn` dentro de una transacción con la sesión de la cookie ya
 * verificada y el rol `app_user` activo. Es el único punto de entrada que
 * las páginas y acciones de servidor de `app/parametros/**` deben usar. */
export async function conSesion<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  const db = await obtenerDb();
  const ctx = await contextoDesdeRequest();
  return withSessionContext(db, ctx, fn);
}

/** Igual que `conSesion`, pero con la empresa fijada explícitamente en vez de
 * leerla de la cookie (`''` = sesión de firma, sin empresa). A7 la usa para
 * abrir, dentro de la MISMA petición, una sesión por cada una de las 30-60
 * empresas accesibles (D-021/D-022: la empresa la autoriza la base en cada
 * llamada, nunca un parámetro de aplicación que "recuerde" varias a la vez). */
export async function conSesionEmpresa<T>(companyId: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  const db = await obtenerDb();
  const ctx = await contextoDesdeRequest(companyId);
  return withSessionContext(db, ctx, fn);
}

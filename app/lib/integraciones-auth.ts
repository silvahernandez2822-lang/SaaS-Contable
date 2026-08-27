/**
 * A13 — Autenticación por token para las rutas HTTP de `app/api/integraciones/**`.
 *
 * Traduce la cabecera `Authorization: Bearer <token>` al mismo mecanismo que
 * `procesarWebhookCorreo` usa internamente (`abrirSesionSistema`, cierre de
 * V-9): abre una sesión de sistema REAL, ejecuta la consulta de solo lectura
 * dentro de ella y la cierra siempre, sin importar el desenlace. No inventa
 * ninguna autenticación propia — es la MISMA capa que `app/lib/sesion.ts` de
 * A8 para el login humano, pero para el canal de correo.
 */
import { obtenerDb } from './db';
import { withSessionContext } from '../../src/db/tenant-context';
import type { SqlClient } from '../../src/db/types';
import {
  abrirSesionSistema,
  cerrarSesionSistema,
  TokenIntegracionInvalidoError,
  type CanalIntegracion,
} from '../../src/integraciones/index';

export class AutenticacionIntegracionAusenteError extends Error {
  constructor() {
    super('Falta la cabecera "Authorization: Bearer <token>".');
    this.name = 'AutenticacionIntegracionAusenteError';
  }
}

export function extraerTokenBearer(request: Request): string {
  const cabecera = request.headers.get('authorization') ?? '';
  const [esquema, token] = cabecera.split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !token) {
    throw new AutenticacionIntegracionAusenteError();
  }
  return token;
}

/**
 * Autentica el token, ejecuta `fn` dentro de una sesión de sistema situada en
 * `companyId` (o "de firma", sin empresa, si `companyId` es null) y cierra la
 * sesión siempre. `TokenIntegracionInvalidoError` se deja subir: la ruta
 * HTTP la traduce a 401.
 */
export async function conSesionSistema<T>(
  request: Request,
  canal: CanalIntegracion,
  companyId: string | null,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  const token = extraerTokenBearer(request);
  const db = await obtenerDb();
  const sesion = await abrirSesionSistema(db, token, canal, {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  });
  try {
    return await withSessionContext(db, { sessionToken: sesion.token, companyId }, fn);
  } finally {
    await cerrarSesionSistema(db, sesion.token);
  }
}

export function respuestaError(status: number, motivo: string, detalle?: string): Response {
  return Response.json({ ok: false, motivo, detalle }, { status });
}

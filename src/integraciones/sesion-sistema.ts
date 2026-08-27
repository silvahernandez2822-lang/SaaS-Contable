/**
 * A13 — Sesión de sistema para canales de integración (Ola 2, cierre de V-9).
 *
 * Esto NO es un mecanismo de contexto nuevo. Es un segundo camino de PRIMER
 * FACTOR (un token de integración en vez de una contraseña humana) que
 * termina exactamente en `abrirSesion` (`src/auth/sesion.ts`, A12), sin
 * tocarla ni una línea. La sesión que resulta es indistinguible, para el
 * resto del sistema, de la que abre un humano: mismas tres funciones de
 * contexto (`current_tenant_id`/`current_company_id`/`current_user_id`),
 * misma tabla `app.session_context`, mismo `withSessionContext` (D-021).
 *
 * Vida corta a propósito (`MINUTOS_SESION_INTEGRACION`): un correo se procesa
 * en segundos: no hay razón para que su sesión sobreviva minutos después,
 * así que `procesarWebhookCorreo` (`./ingest-correo.ts`) la cierra ella misma
 * al terminar, en vez de esperar a que expire.
 */
import type { SqlClient } from '../db/types.js';
import { abrirSesion, cerrarSesion, type DatosSesion } from '../auth/sesion.js';
import { autenticarTokenIntegracion, type CanalIntegracion } from './token.js';

/** Vigencia corta: una sesión de integración vive lo que dura procesar UNA llamada. */
export const MINUTOS_SESION_INTEGRACION = 10;

export class TokenIntegracionInvalidoError extends Error {
  constructor() {
    super('El token de integración es inválido, está revocado o el canal no coincide.');
    this.name = 'TokenIntegracionInvalidoError';
  }
}

export interface SesionSistema extends DatosSesion {
  canal: CanalIntegracion;
}

export interface OpcionesSesionSistema {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Autentica el token y abre una sesión de sistema para su firma. Lanza
 * `TokenIntegracionInvalidoError` si el token no identifica ningún canal
 * vivo — nunca abre una sesión "a medias" ni acepta un tenant que no venga
 * de la propia credencial verificada.
 */
export async function abrirSesionSistema(
  db: SqlClient,
  token: string,
  canalEsperado: CanalIntegracion,
  opciones: OpcionesSesionSistema = {},
): Promise<SesionSistema> {
  const identidad = await autenticarTokenIntegracion(db, token);
  if (!identidad || identidad.canal !== canalEsperado) {
    throw new TokenIntegracionInvalidoError();
  }

  const sesion = await abrirSesion(db, {
    userId: identidad.userId,
    ip: opciones.ip ?? null,
    userAgent: opciones.userAgent ?? null,
    mfaSuperado: false,
    minutos: MINUTOS_SESION_INTEGRACION,
  });

  // Defensa en profundidad: abrirSesion deriva el tenant de app.usuario, que
  // es la misma fuente que ya validó autenticarTokenIntegracion. Si alguna
  // vez difirieran, es un error de programación, no una decisión de negocio
  // que este archivo deba tolerar en silencio.
  if (sesion.tenantId !== identidad.tenantId) {
    throw new Error('Inconsistencia de tenant entre el token de integración y la sesión emitida.');
  }

  return { ...sesion, canal: identidad.canal };
}

/** Cierra la sesión de sistema. Se llama siempre, incluso si el procesamiento falló (least exposure). */
export async function cerrarSesionSistema(db: SqlClient, token: string): Promise<void> {
  await cerrarSesion(db, token);
}

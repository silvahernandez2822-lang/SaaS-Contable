/**
 * Flujo de autenticación — Agente A12.
 *
 * Orden de comprobaciones, y por qué:
 *  1. Se busca la credencial por correo (rol `app_auth`, política acotada).
 *  2. Se verifica el bloqueo por intentos fallidos ANTES de derivar la clave:
 *     así el bloqueo también frena el gasto de CPU de scrypt.
 *  3. Se deriva y compara la contraseña SIEMPRE, incluso cuando el usuario no
 *     existe, contra un registro señuelo. Sin eso, el tiempo de respuesta
 *     delata qué correos están registrados.
 *  4. Si el usuario tiene MFA habilitado, se exige el código TOTP.
 *  5. Solo entonces se emite la sesión.
 *
 * Todo fallo deja un `ACCESO_DENEGADO` en `audit_log` con usuario (cuando se
 * conoce), correo intentado, motivo, IP y marca de tiempo — en su propia
 * transacción, para que sobreviva al rechazo.
 *
 * El motivo del fallo NUNCA se le devuelve al cliente con detalle: hacia afuera
 * siempre es "credenciales inválidas". El detalle queda en la auditoría.
 */
import type { SqlClient } from '../db/types.js';
import { withAuthContext } from '../db/tenant-context.js';
import { hashearPassword, verificarPassword } from './password.js';
import { verificarCodigoTotp } from './totp.js';
import { descifrar } from './cifrado.js';
import { abrirSesion, MINUTOS_SESION_POR_DEFECTO } from './sesion.js';
import type { DatosSesion } from './sesion.js';

export type MotivoFallo =
  | 'usuario_inexistente'
  | 'usuario_inactivo'
  | 'usuario_bloqueado'
  | 'password_incorrecta'
  | 'mfa_requerido'
  | 'mfa_incorrecto'
  | 'sin_credencial';

export class CredencialInvalidaError extends Error {
  /** Motivo real. Para la auditoría y las pruebas, nunca para la respuesta HTTP. */
  readonly motivo: MotivoFallo;
  constructor(motivo: MotivoFallo) {
    super('Credenciales inválidas.');
    this.name = 'CredencialInvalidaError';
    this.motivo = motivo;
  }
}

export class MfaRequeridoError extends Error {
  constructor() {
    super('Este usuario exige un código de segundo factor.');
    this.name = 'MfaRequeridoError';
  }
}

interface Credencial {
  user_id: string;
  tenant_id: string;
  email: string;
  estado: string;
  password_hash: string | null;
  password_algoritmo: string | null;
  mfa_habilitado: boolean;
  mfa_secret_cifrado: string | null;
  mfa_secret_alg: string | null;
  intentos_fallidos: number;
  bloqueado_hasta: string | Date | null;
}

/**
 * Registro señuelo con los parámetros vigentes, derivado una sola vez por
 * proceso. Se compara contra él cuando el usuario no existe para que el tiempo
 * de respuesta no distinga un correo registrado de uno que no lo está.
 */
let senuelo: Promise<string> | null = null;
function registroSenuelo(): Promise<string> {
  senuelo ??= hashearPassword('senuelo-sin-valor-de-autenticacion');
  return senuelo;
}

export interface OpcionesInicioSesion {
  email: string;
  password: string;
  codigoTotp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  minutos?: number;
  /** Clave de aplicación para descifrar el secreto TOTP (ver cifrado.ts). */
  claveCifrado?: Buffer;
  /** Solo para pruebas deterministas del TOTP. */
  ahora?: number;
}

async function registrarFallo(
  db: SqlClient,
  datos: {
    email: string;
    tenantId: string | null;
    userId: string | null;
    motivo: MotivoFallo;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  // Transacción propia: el rastro debe quedar aunque el inicio de sesión falle.
  await withAuthContext(db, async (tx) => {
    await tx.query('SELECT app.registrar_login_fallido($1, $2, $3, $4, $5::inet, $6)', [
      datos.email,
      datos.tenantId,
      datos.userId,
      datos.motivo,
      datos.ip ?? null,
      datos.userAgent ?? null,
    ]);
  });
}

async function buscarCredencial(db: SqlClient, email: string): Promise<Credencial | null> {
  return withAuthContext(db, async (tx) => {
    const { rows } = await tx.query<Credencial>('SELECT * FROM app.buscar_credencial($1)', [
      email.toLowerCase(),
    ]);
    return rows[0] ?? null;
  });
}

/**
 * Inicia sesión. Devuelve el token que el servidor entrega al cliente
 * (cookie `HttpOnly; Secure; SameSite=Lax`) y con el que se arma el contexto de
 * cada petición mediante `withSessionContext`.
 */
export async function iniciarSesion(
  db: SqlClient,
  opciones: OpcionesInicioSesion,
): Promise<DatosSesion> {
  const email = (opciones.email ?? '').trim().toLowerCase();
  const credencial = await buscarCredencial(db, email);

  const fallar = async (motivo: MotivoFallo): Promise<never> => {
    await registrarFallo(db, {
      email,
      tenantId: credencial?.tenant_id ?? null,
      userId: credencial?.user_id ?? null,
      motivo,
      ip: opciones.ip ?? null,
      userAgent: opciones.userAgent ?? null,
    });
    throw new CredencialInvalidaError(motivo);
  };

  if (!credencial) {
    // Se paga el mismo costo que en el camino normal antes de responder.
    await verificarPassword(opciones.password ?? '', await registroSenuelo());
    return fallar('usuario_inexistente');
  }

  const bloqueado = credencial.bloqueado_hasta
    ? new Date(credencial.bloqueado_hasta).getTime() > Date.now()
    : false;
  if (bloqueado) return fallar('usuario_bloqueado');

  if (credencial.estado !== 'activo') return fallar('usuario_inactivo');
  if (!credencial.password_hash) return fallar('sin_credencial');

  const correcta = await verificarPassword(opciones.password ?? '', credencial.password_hash);
  if (!correcta) return fallar('password_incorrecta');

  if (credencial.mfa_habilitado) {
    if (!credencial.mfa_secret_cifrado) return fallar('sin_credencial');
    if (!opciones.codigoTotp) return fallar('mfa_requerido');

    const clave = opciones.claveCifrado;
    if (!clave) {
      throw new Error(
        'Falta la clave de cifrado de aplicación para descifrar el secreto de MFA ' +
          '(claveCifrado / APP_ENCRYPTION_KEY).',
      );
    }
    const secreto = descifrar(credencial.mfa_secret_cifrado, clave);
    const desfase = verificarCodigoTotp(secreto, opciones.codigoTotp, {
      ...(opciones.ahora === undefined ? {} : { ahora: opciones.ahora }),
    });
    if (desfase === null) return fallar('mfa_incorrecto');
  }

  return abrirSesion(db, {
    userId: credencial.user_id,
    ip: opciones.ip ?? null,
    userAgent: opciones.userAgent ?? null,
    mfaSuperado: credencial.mfa_habilitado,
    minutos: opciones.minutos ?? MINUTOS_SESION_POR_DEFECTO,
  });
}

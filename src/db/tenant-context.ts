import type { SqlClient } from './types.js';

/**
 * Contexto de sesión (D-004, corregido por D-021 — cierre de D-020).
 *
 * Hasta la migración 014 el contexto era `app.tenant_id`, una GUC que cualquier
 * rol puede fijar: el aislamiento dependía de que la aplicación se portara bien.
 * Desde 015 el contexto se DERIVA de un token de sesión que la base verifica
 * contra `app.session_context`, tabla del esquema `app` sobre la que el rol de
 * aplicación no tiene ningún privilegio.
 *
 * Lo único que la sesión SQL presenta es el token. El tenant y el usuario los
 * decide la base de datos; la empresa la PIDE el cliente y la AUTORIZA la base.
 * Fijar `app.tenant_id` a mano ya no tiene ningún efecto.
 */

export interface SessionContext {
  /** Token opaco emitido por el servidor al autenticar. Nunca lo elige el cliente. */
  sessionToken: string;
  /** Empresa sobre la que se quiere operar. La base verifica el acceso. */
  companyId?: string | null;
  /** IP del cliente, tal como la ve el servidor. Va al audit_log. */
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** Rol de base de datos. Por defecto `app_user`. */
  role?: string;
}

/** @deprecated Alias histórico. El contexto ya no se arma con tenantId. */
export type TenantContext = SessionContext;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

export const ROL_APLICACION = 'app_user';
export const ROL_AUTENTICACION = 'app_auth';

/** La sesión no existe, venció o fue revocada. */
export class SesionInvalidaError extends Error {
  constructor(mensaje = 'La sesión no es válida, venció o fue revocada.') {
    super(mensaje);
    this.name = 'SesionInvalidaError';
  }
}

/** La sesión pidió una empresa sobre la que no tiene acceso vigente. */
export class EmpresaNoAutorizadaError extends Error {
  readonly companyId: string;
  constructor(companyId: string) {
    super(
      `La sesión no tiene acceso vigente a la empresa ${companyId}. ` +
        'El intento quedó registrado en audit_log como ACCESO_DENEGADO.',
    );
    this.name = 'EmpresaNoAutorizadaError';
    this.companyId = companyId;
  }
}

function exigirUuid(valor: string | null | undefined, campo: string): string {
  if (valor == null || valor === '') return '';
  if (!UUID.test(valor)) {
    throw new Error(`${campo} no es un UUID válido: ${JSON.stringify(valor)}`);
  }
  return valor;
}

function exigirRol(role: string): string {
  if (!IDENTIFICADOR.test(role)) {
    throw new Error(`Nombre de rol inválido: ${JSON.stringify(role)}`);
  }
  return role;
}

/** Fija el rol y el contexto dentro de una transacción ya abierta. */
async function fijarContexto(tx: SqlClient, ctx: SessionContext, companyId: string): Promise<void> {
  await tx.exec(`SET LOCAL ROLE ${exigirRol(ctx.role ?? ROL_APLICACION)}`);
  await tx.query(
    `SELECT set_config('app.session_token', $1, true),
            set_config('app.company_id',    $2, true),
            set_config('app.ip',            $3, true),
            set_config('app.user_agent',    $4, true),
            set_config('app.request_id',    $5, true)`,
    [ctx.sessionToken, companyId, ctx.ip ?? '', ctx.userAgent ?? '', ctx.requestId ?? ''],
  );
}

/**
 * Abre una transacción con el contexto de la sesión puesto y verificado.
 *
 * Verifica dos cosas contra la base de datos, no contra la aplicación:
 *  1. que el token resuelva a una sesión vigente (si no, `SesionInvalidaError`);
 *  2. que la empresa pedida esté autorizada para esa sesión (si no, deja el
 *     rastro `ACCESO_DENEGADO` en `audit_log`, en su propia transacción para
 *     que sobreviva al rechazo, y lanza `EmpresaNoAutorizadaError`).
 */
export async function withSessionContext<T>(
  db: SqlClient,
  ctx: SessionContext,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  if (!ctx.sessionToken || ctx.sessionToken.trim() === '') {
    throw new SesionInvalidaError('No se presentó ningún token de sesión.');
  }
  const companyId = exigirUuid(ctx.companyId, 'companyId');

  const marcador = Symbol('empresa-no-autorizada');
  type Fallo = { [k: symbol]: true; companyId: string };

  try {
    return await db.transaction(async (tx) => {
      await fijarContexto(tx, ctx, companyId);

      const { rows } = await tx.query<{ tenant_id: string | null; company_id: string | null }>(
        'SELECT app.current_tenant_id() AS tenant_id, app.current_company_id() AS company_id',
      );
      const resuelto = rows[0];
      if (!resuelto || resuelto.tenant_id == null) {
        throw new SesionInvalidaError();
      }
      if (companyId !== '' && resuelto.company_id !== companyId) {
        // Se lanza para deshacer la transacción; el rastro se escribe aparte.
        throw { [marcador]: true, companyId } as Fallo;
      }

      return fn(tx);
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as Fallo)[marcador] === true) {
      const fallida = (error as Fallo).companyId;
      // Transacción propia: el registro de auditoría debe sobrevivir al rechazo.
      await db.transaction(async (tx) => {
        await fijarContexto(tx, ctx, '');
        await tx.query('SELECT app.registrar_acceso_denegado($1, $2, $3)', [
          'company',
          fallida,
          'la sesión pidió operar sobre una empresa sobre la que no tiene acceso vigente',
        ]);
      });
      throw new EmpresaNoAutorizadaError(fallida);
    }
    throw error;
  }
}

/** @deprecated Nombre histórico de `withSessionContext`. */
export const withTenantContext = withSessionContext;

/**
 * Contexto del camino de autenticación: rol `app_auth`, que puede leer la
 * credencial de un correo concreto y emitir sesiones, y no tiene GRANT sobre
 * ninguna tabla de negocio. Separarlo de `app_user` es lo que impide que una
 * inyección SQL en una petición normal se fabrique una sesión (D-023).
 */
export async function withAuthContext<T>(
  db: SqlClient,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${ROL_AUTENTICACION}`);
    return fn(tx);
  });
}

/**
 * Contexto de administración: sin SET ROLE, para migraciones, seeds y tareas de
 * plataforma. Requiere un rol superusuario o con BYPASSRLS, porque escribe las
 * filas globales de los catálogos (tenant_id IS NULL) que ninguna política RLS
 * permite escribir desde la aplicación.
 *
 * Jamás debe usarse para servir una petición de usuario.
 */
export async function withAdminContext<T>(
  db: SqlClient,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}

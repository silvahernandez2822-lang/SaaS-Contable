/**
 * A13 — Registro de llamadas de integración (sección 13.3, `integration_call_log`).
 *
 * Dos caminos, porque una llamada sin token válido no tiene tenant al que
 * atribuírsele (mismo problema que ya resolvió `audit_log` para
 * `ACCESO_DENEGADO`, 015/016):
 *
 *  - `registrarLlamada` corre DENTRO de una sesión de sistema ya abierta
 *    (`tx` de `withSessionContext`, rol `app_user`): la llamada SÍ tiene
 *    tenant, y puede o no tener empresa todavía resuelta.
 *  - `registrarLlamadaNoAutenticada` corre en el camino de autenticación
 *    (rol `app_auth`, `withAuthContext`): la llamada no superó ni el primer
 *    factor, así que tenant_id/company_id quedan NULL — la política de la
 *    migración 091 no deja insertar nada más ancho desde `app_auth`.
 */
import type { SqlClient } from '../db/types.js';
import { withAuthContext } from '../db/tenant-context.js';

export type CanalLlamada = 'correo' | 'notificaciones' | 'mantenimiento';
export type ResultadoLlamada = 'ok' | 'rechazado' | 'no_autenticado' | 'error' | 'buzon_no_reconocido';

export interface DatosLlamada {
  companyId?: string | null;
  canal: CanalLlamada;
  endpoint: string;
  resultado: ResultadoLlamada;
  httpStatus?: number | null;
  detalle?: string | null;
  duracionMs?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Registra una llamada ENTRANTE ya atribuida a una firma (sesión de sistema activa). */
export async function registrarLlamada(tx: SqlClient, datos: DatosLlamada): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO integration_call_log
       (tenant_id, company_id, direccion, canal, endpoint, resultado, http_status,
        detalle, duracion_ms, ip, user_agent, request_id)
     VALUES (app.current_tenant_id(), $1, 'entrante', $2, $3, $4, $5, $6, $7, $8::inet, $9, $10)
     RETURNING id`,
    [
      datos.companyId ?? null,
      datos.canal,
      datos.endpoint,
      datos.resultado,
      datos.httpStatus ?? null,
      datos.detalle ?? null,
      datos.duracionMs ?? null,
      datos.ip ?? null,
      datos.userAgent ?? null,
      datos.requestId ?? null,
    ],
  );
  return rows[0]!.id;
}

/** Registra una llamada ENTRANTE que no superó la autenticación: sin tenant, sin datos del correo. */
export async function registrarLlamadaNoAutenticada(
  db: SqlClient,
  datos: Pick<DatosLlamada, 'canal' | 'endpoint' | 'ip' | 'userAgent' | 'requestId' | 'detalle'>,
): Promise<void> {
  await withAuthContext(db, async (tx) => {
    await tx.query(
      `INSERT INTO integration_call_log
         (tenant_id, company_id, direccion, canal, endpoint, resultado, detalle, ip, user_agent, request_id)
       VALUES (NULL, NULL, 'entrante', $1, $2, 'no_autenticado', $3, $4::inet, $5, $6)`,
      [
        datos.canal,
        datos.endpoint,
        datos.detalle ?? null,
        datos.ip ?? null,
        datos.userAgent ?? null,
        datos.requestId ?? null,
      ],
    );
  });
}

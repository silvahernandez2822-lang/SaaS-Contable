'use server';

/**
 * A12 — Selector de empresa de la portada.
 *
 * El `company_id` que llega de este formulario NO es una afirmación de acceso:
 * es una PETICIÓN. Lo dice D-022 y lo impone la base — `app.current_company_id()`
 * devuelve NULL si la sesión no tiene un acceso vigente sobre esa empresa, la
 * RLS deja de ver nada y el intento queda en `audit_log` como `ACCESO_DENEGADO`.
 * Por eso esta acción puede escribir la cookie sin comprobar nada por su cuenta:
 * escribirla no autoriza, solo recuerda cuál pidió el usuario.
 *
 * Aun así se valida la FORMA (UUID) antes de guardarla, para que una cookie
 * basura falle aquí con un mensaje claro y no dentro de `withSessionContext`.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_COMPANY_ID } from './lib/sesion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function elegirEmpresaAction(formData: FormData): Promise<void> {
  const valor = formData.get('companyId');
  const companyId = typeof valor === 'string' ? valor.trim() : '';

  const jarra = await cookies();
  if (companyId === '') {
    // Sesión "de firma": parámetros compartidos entre empresas (D-015).
    jarra.delete(COOKIE_COMPANY_ID);
  } else if (UUID.test(companyId)) {
    jarra.set(COOKIE_COMPANY_ID, companyId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  redirect('/');
}

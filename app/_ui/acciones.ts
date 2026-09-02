'use server';

/**
 * D-077 · Ola 5 (front) — Acciones del shell de la aplicación.
 *
 * `cambiarEmpresaActivaAction` es idéntica en efecto a `elegirEmpresaAction` de
 * la portada (`app/acciones.ts`, D-022): reescribe la cookie `company_id` con la
 * empresa que pidió el usuario en el selector del shell. Lo único que añade es
 * que vuelve a la pantalla en la que estaba (`destino`), no a la portada, para
 * que cambiar de empresa desde la bandeja te deje en la bandeja.
 *
 * NO AUTORIZA NADA. Escribir la cookie no da acceso: `app.current_company_id()`
 * devuelve NULL si la sesión no tiene un acceso vigente sobre esa empresa, la
 * RLS deja de ver nada y el intento queda en `audit_log`. Por eso basta con
 * validar la FORMA (UUID) aquí.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_COMPANY_ID } from '../lib/sesion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo rutas internas: nunca un destino absoluto que pudiera sacar del sitio. */
function destinoSeguro(valor: FormDataEntryValue | null): string {
  const s = typeof valor === 'string' ? valor.trim() : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

export async function cambiarEmpresaActivaAction(formData: FormData): Promise<void> {
  const valor = formData.get('companyId');
  const companyId = typeof valor === 'string' ? valor.trim() : '';
  const destino = destinoSeguro(formData.get('destino'));

  const jarra = await cookies();
  if (companyId === '') {
    jarra.delete(COOKIE_COMPANY_ID);
  } else if (UUID.test(companyId)) {
    jarra.set(COOKIE_COMPANY_ID, companyId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  redirect(destino);
}

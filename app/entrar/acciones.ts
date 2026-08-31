'use server';

/**
 * A12 — Inicio y cierre de sesión por la interfaz.
 *
 * Es la única puerta de entrada humana al producto. No inventa autenticación:
 * llama a `iniciarSesion` (`src/auth/autenticacion.ts`), que es quien busca la
 * credencial con el rol `app_auth`, deriva scrypt en tiempo constante, exige el
 * TOTP cuando el usuario tiene MFA y emite la sesión con `app.abrir_sesion`.
 *
 * Lo que esta capa aporta, y nada más:
 *  - trasladar el token opaco a la cookie `session_token`
 *    (`HttpOnly; SameSite=Lax; Secure` fuera de desarrollo), que es el contrato
 *    que `app/lib/sesion.ts` ya espera;
 *  - devolver SIEMPRE el mismo mensaje al usuario, pase lo que pase. El motivo
 *    real (usuario inexistente, contraseña incorrecta, MFA, bloqueo) queda en
 *    `audit_log` y nunca viaja al navegador: si viajara, el formulario sería un
 *    oráculo de qué correos existen y de cuáles tienen MFA.
 *
 * La duración de la cookie se toma de la sesión que emitió la base de datos, no
 * de una constante de esta capa: la autoridad sobre el vencimiento es
 * `app.session_context.expira_en` (015), con su tope duro de 24 h.
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { obtenerDb } from '../lib/db';
import { COOKIE_COMPANY_ID, COOKIE_SESSION_TOKEN } from '../lib/sesion';
import { iniciarSesion } from '../../src/auth/autenticacion';
import { cerrarSesion } from '../../src/auth/sesion';
import { claveDeEntorno } from '../../src/auth/cifrado';

/** Mensaje único hacia el navegador. Cualquier otro sería un oráculo. */
const MENSAJE_GENERICO = 'Correo, contraseña o código incorrectos.';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

/** `Secure` siempre salvo en desarrollo, donde no hay TLS en localhost. */
async function esProduccion(): Promise<boolean> {
  return process.env.NODE_ENV === 'production';
}

export async function entrarAction(formData: FormData): Promise<void> {
  const email = leer(formData, 'email');
  const password = leer(formData, 'password');
  const codigoTotp = leer(formData, 'codigoTotp');

  const cabeceras = await headers();
  const ip = (cabeceras.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const userAgent = cabeceras.get('user-agent');

  // La clave de cifrado solo hace falta si el usuario tiene MFA. Si no está
  // configurada, no se cae aquí: se deja pasar y `iniciarSesion` decide.
  let clave: Buffer | undefined;
  try {
    clave = claveDeEntorno();
  } catch {
    clave = undefined;
  }

  let destino = '/';
  try {
    const db = await obtenerDb();
    const sesion = await iniciarSesion(db, {
      email,
      password,
      codigoTotp: codigoTotp || null,
      ip,
      userAgent,
      ...(clave === undefined ? {} : { claveCifrado: clave }),
    });

    const jarra = await cookies();
    const seguro = await esProduccion();
    jarra.set(COOKIE_SESSION_TOKEN, sesion.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: seguro,
      path: '/',
      expires: sesion.expiraEn,
    });
    // Al entrar no hay empresa elegida todavía: se limpia lo que hubiera de
    // una sesión anterior para no arrastrar la empresa de otro usuario.
    jarra.delete(COOKIE_COMPANY_ID);
  } catch {
    destino = `/entrar?error=${encodeURIComponent(MENSAJE_GENERICO)}`;
  }

  redirect(destino);
}

export async function salirAction(): Promise<void> {
  const jarra = await cookies();
  const token = jarra.get(COOKIE_SESSION_TOKEN)?.value ?? '';
  if (token !== '') {
    try {
      const db = await obtenerDb();
      await cerrarSesion(db, token);
    } catch {
      // Aunque la revocación falle, la cookie se borra igual: nunca se deja al
      // usuario "dentro" porque la base no respondiera.
    }
  }
  jarra.delete(COOKIE_SESSION_TOKEN);
  jarra.delete(COOKIE_COMPANY_ID);
  redirect('/entrar');
}

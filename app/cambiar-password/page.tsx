/**
 * A16 — Cambiar la propia contraseña (Ola 4, D-069).
 *
 * Es la otra mitad del botón «fijar contraseña» del administrador. Sin esta
 * pantalla, la bandera `debe_cambiar_password` sería un adorno: el
 * administrador que le fija una contraseña a alguien la conoce, y esa
 * contraseña seguiría valiendo indefinidamente. Con las dos piezas juntas, la
 * contraseña que fija un administrador sirve para UNA entrada.
 *
 * La portada (`/`) redirige aquí mientras la bandera esté puesta. No es una
 * medida de seguridad —quien tiene sesión válida puede llamar a las acciones de
 * servidor de todos modos— sino la forma de que la obligación se cumpla en la
 * práctica sin bloquear un sistema entero por una bandera.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { conSesionEmpresa, SesionNoPresenteError } from '../lib/sesion';
import { SesionInvalidaError } from '../../src/db/tenant-context';
import { estadoDeMiCredencial } from '../../src/services/administracion';
import { MensajeError } from '../parametros/_componentes';
import { cambiarMiPasswordAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaCambiarPassword({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;

  let credencial;
  try {
    // Sesión "de firma" (sin empresa): cambiar la propia contraseña no depende
    // de qué empresa se esté mirando, y así funciona también para un usuario
    // recién creado que todavía no tiene acceso a ninguna.
    credencial = await conSesionEmpresa('', (tx) => estadoDeMiCredencial(tx));
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      redirect('/entrar');
    }
    throw error;
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '24px' }}>
      <h1>Cambiar mi contraseña</h1>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p role="status" style={{ border: '1px solid #15803d', color: '#15803d', padding: '8px 12px' }}>
          {decodeURIComponent(cadena(sp, 'ok'))}
        </p>
      )}

      {credencial?.debeCambiarPassword && (
        <p role="alert" style={{ border: '2px solid #b45309', background: '#fffbeb', padding: '12px 16px' }}>
          <strong>Su contraseña actual la fijó un administrador, así que él la conoce.</strong> Cámbiela ahora:
          mientras no lo haga, cualquier cosa que quede en la auditoría a su nombre podría haberla hecho otra
          persona.
        </p>
      )}

      <form action={cambiarMiPasswordAction} style={{ border: '1px solid #334155', padding: 16 }}>
        <div>
          <label>
            Contraseña actual *{' '}
            <input name="actual" type="password" required autoComplete="current-password" size={28} />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            Contraseña nueva *{' '}
            <input name="nueva" type="password" required autoComplete="new-password" size={28} minLength={12} />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            Repita la contraseña nueva *{' '}
            <input name="repetida" type="password" required autoComplete="new-password" size={28} minLength={12} />
          </label>
        </div>
        <p style={{ fontSize: 13, color: '#475569' }}>
          Mínimo 12 caracteres. Se le pide la actual aunque ya tenga la sesión abierta: una sesión ajena
          (un portátil sin bloquear, una cookie filtrada) no debe poder convertirse en el control permanente de
          su cuenta.
        </p>
        <button type="submit">Cambiar contraseña</button>
      </form>

      <p style={{ marginTop: 16 }}>
        <Link href="/">Volver al inicio</Link>
      </p>
    </main>
  );
}

/**
 * A16 — Cambiar la propia contraseña (Ola 4, D-069).
 *
 * D-077 (Ola 5, front): migrada al lenguaje visual del sistema de interfaz. El
 * comportamiento no cambia: la portada (`/`) redirige aquí mientras la bandera
 * `debe_cambiar_password` esté puesta; se pide la contraseña actual aunque haya
 * sesión abierta; mínimo 12 caracteres (lo impone el servicio, no esta pantalla).
 *
 * Fuera del shell: el `Chrome` la excluye (pantalla propia, sin navegación).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { conSesionEmpresa, SesionNoPresenteError } from '../lib/sesion';
import { SesionInvalidaError } from '../../src/db/tenant-context';
import { estadoDeMiCredencial } from '../../src/services/administracion';
import { Boton, Campo, Entrada, MensajeEstado, Panel } from '../_ui/componentes';
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
    credencial = await conSesionEmpresa('', (tx) => estadoDeMiCredencial(tx));
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      redirect('/entrar');
    }
    throw error;
  }

  const error = cadena(sp, 'error');
  const ok = cadena(sp, 'ok');

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-lg font-bold tracking-tight text-texto">Cambiar mi contraseña</h1>

      <div className="mt-4 flex flex-col gap-3">
        {error && (
          <MensajeEstado tipo="error" titulo="No se pudo cambiar la contraseña">
            {decodeURIComponent(error)}
          </MensajeEstado>
        )}
        {ok && (
          <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(ok)} />
        )}
        {credencial?.debeCambiarPassword && (
          <MensajeEstado
            tipo="configuracion"
            titulo="Su contraseña actual la fijó un administrador, así que él la conoce."
          >
            Cámbiela ahora: mientras no lo haga, cualquier cosa que quede en la auditoría a su nombre podría
            haberla hecho otra persona.
          </MensajeEstado>
        )}
      </div>

      <form action={cambiarMiPasswordAction} className="mt-4">
        <Panel titulo="Contraseña">
          <div className="flex flex-col gap-4 p-4">
            <Campo etiqueta="Contraseña actual" requerido>
              <Entrada name="actual" type="password" required autoComplete="current-password" />
            </Campo>
            <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 12 caracteres." requerido>
              <Entrada name="nueva" type="password" required autoComplete="new-password" minLength={12} />
            </Campo>
            <Campo etiqueta="Repita la contraseña nueva" requerido>
              <Entrada name="repetida" type="password" required autoComplete="new-password" minLength={12} />
            </Campo>
            <p className="text-[12px] text-texto-suave">
              Se le pide la actual aunque ya tenga la sesión abierta: una sesión ajena (un portátil sin bloquear,
              una cookie filtrada) no debe poder convertirse en el control permanente de su cuenta.
            </p>
            <div className="flex justify-end">
              <Boton tipo="submit">Cambiar contraseña</Boton>
            </div>
          </div>
        </Panel>
      </form>

      <p className="mt-4 text-[13px]">
        <Link href="/" className="text-primario underline dark:text-primario-tinta-oscura">
          Volver a la portada
        </Link>
      </p>
    </main>
  );
}

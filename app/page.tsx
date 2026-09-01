/**
 * A12 — Portada: elegir empresa y llegar a las pantallas del producto.
 *
 * Es el eslabón que faltaba para poder USAR el sistema: hasta A12 existían
 * `/bandeja`, `/parametros`, `/terceros` y `/reportes`, pero no había forma de
 * iniciar sesión ni de fijar la cookie `company_id` que todas ellas esperan.
 *
 * No hay ninguna decisión de seguridad aquí. Si no hay sesión, `conSesion`
 * lanza y se redirige a `/entrar`; qué empresas se muestran lo decide
 * `app.empresas_accesibles()` a partir del token verificado, nunca esta página.
 *
 * A16 (Ola 4) le añade dos cosas:
 *  · el desvío a `/cambiar-password` mientras la contraseña la haya fijado un
 *    administrador (D-069). No es una medida de seguridad —quien tiene sesión
 *    válida puede llamar a las acciones de servidor igual— sino la forma de que
 *    la obligación se cumpla en la práctica.
 *  · los módulos nuevos en la lista de destinos. La navegación de vuelta ya no
 *    vive aquí: está en el layout raíz (`app/_navegacion.tsx`), donde toda ruta
 *    la hereda por construcción.
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { conSesionEmpresa, COOKIE_COMPANY_ID, SesionNoPresenteError } from './lib/sesion';
import { listarEmpresasAccesibles } from '../src/services/bandeja';
import { estadoDeMiCredencial } from '../src/services/administracion';
import { SesionInvalidaError } from '../src/db/tenant-context';
import { elegirEmpresaAction } from './acciones';
import { salirAction } from './entrar/acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;

export default async function PortadaPage({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const ok = typeof sp.ok === 'string' ? sp.ok : '';

  let empresas;
  let credencial;
  try {
    // Sesión "de firma" (sin empresa): es exactamente para lo que sirve —
    // saber qué empresas hay ANTES de elegir una (D-022).
    [empresas, credencial] = await conSesionEmpresa('', async (tx) => [
      await listarEmpresasAccesibles(tx),
      await estadoDeMiCredencial(tx),
    ] as const);
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      redirect('/entrar');
    }
    throw error;
  }

  if (credencial?.debeCambiarPassword) redirect('/cambiar-password');

  const jarra = await cookies();
  const elegida = jarra.get(COOKIE_COMPANY_ID)?.value ?? '';
  const actual = empresas.find((e) => e.companyId === elegida) ?? null;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px' }}>
      <h1>Contable CO</h1>
      {ok && (
        <p role="status" style={{ border: '1px solid #15803d', color: '#15803d', padding: '8px 12px' }}>
          {decodeURIComponent(ok)}
        </p>
      )}

      <section>
        <h2>Empresa en contexto</h2>
        {empresas.length === 0 ? (
          <p>
            Su usuario no tiene acceso vigente a ninguna empresa-cliente. Pídale al administrador de la firma
            que se lo otorgue.
          </p>
        ) : (
          <form action={elegirEmpresaAction}>
            <label htmlFor="companyId">Trabajar sobre</label>{' '}
            <select id="companyId" name="companyId" defaultValue={elegida}>
              <option value="">— sin empresa (parámetros de la firma) —</option>
              {empresas.map((e) => (
                <option key={e.companyId} value={e.companyId}>
                  {e.razonSocial} (NIT {e.nit}) — rol: {e.rolCodigo}
                </option>
              ))}
            </select>{' '}
            <button type="submit">Elegir</button>
          </form>
        )}
        <p>
          {actual
            ? `Ahora mismo: ${actual.razonSocial}.`
            : 'Ahora mismo: sin empresa. La bandeja y los reportes necesitan una empresa elegida.'}
        </p>
      </section>

      <section>
        <h2>Ir a</h2>
        <ul>
          <li>
            <a href="/bandeja">Bandeja de causación</a> — aprobar o rechazar lo que llegó
          </li>
          <li>
            <a href="/terceros">Terceros</a> — proveedores, atributos fiscales y actividad por municipio
          </li>
          <li>
            <a href="/parametros">Parámetros</a> — tarifas, UVT, ReteICA por municipio
          </li>
          <li>
            <a href="/parametros/puc">Plan de cuentas (PUC)</a> — el genérico y el propio de esta empresa
          </li>
          <li>
            <a href="/carga-masiva">Carga masiva</a> — cargar catálogos completos desde Excel
          </li>
          <li>
            <a href="/reportes">Reportes</a> — libros y papeles de trabajo en Excel
          </li>
          <li>
            <a href="/admin/usuarios">Administración</a> — usuarios, roles, permisos y correcciones por revisar
          </li>
        </ul>
      </section>

      <section>
        <h2>Mi cuenta</h2>
        <p>
          {credencial ? `${credencial.nombreCompleto} <${credencial.email}>` : ''} ·{' '}
          <a href="/cambiar-password">Cambiar mi contraseña</a>
        </p>
        <form action={salirAction}>
          <button type="submit">Cerrar sesión</button>
        </form>
      </section>
    </main>
  );
}

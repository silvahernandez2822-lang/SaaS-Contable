/**
 * A12 — Portada: elegir empresa y llegar a las cuatro pantallas del producto.
 *
 * Es el eslabón que faltaba para poder USAR el sistema: hasta ahora existían
 * `/bandeja`, `/parametros`, `/terceros` y `/reportes`, pero no había forma de
 * iniciar sesión ni de fijar la cookie `company_id` que todas ellas esperan.
 *
 * No hay ninguna decisión de seguridad aquí. Si no hay sesión, `conSesion`
 * lanza y se redirige a `/entrar`; qué empresas se muestran lo decide
 * `app.empresas_accesibles()` a partir del token verificado, nunca esta página.
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { conSesionEmpresa, COOKIE_COMPANY_ID, SesionNoPresenteError } from './lib/sesion';
import { listarEmpresasAccesibles } from '../src/services/bandeja';
import { SesionInvalidaError } from '../src/db/tenant-context';
import { elegirEmpresaAction } from './acciones';
import { salirAction } from './entrar/acciones';

export const dynamic = 'force-dynamic';

export default async function PortadaPage() {
  let empresas;
  try {
    // Sesión "de firma" (sin empresa): es exactamente para lo que sirve —
    // saber qué empresas hay ANTES de elegir una (D-022).
    empresas = await conSesionEmpresa('', (tx) => listarEmpresasAccesibles(tx));
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      redirect('/entrar');
    }
    throw error;
  }

  const jarra = await cookies();
  const elegida = jarra.get(COOKIE_COMPANY_ID)?.value ?? '';
  const actual = empresas.find((e) => e.companyId === elegida) ?? null;

  return (
    <main>
      <h1>Contable CO</h1>

      <section>
        <h2>Empresa en contexto</h2>
        {empresas.length === 0 ? (
          <p>
            Su usuario no tiene acceso vigente a ninguna empresa-cliente. Pídale al administrador
            de la firma que se lo otorgue.
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
            <a href="/parametros">Parámetros</a> — tarifas, UVT, ReteICA por municipio
          </li>
          <li>
            <a href="/terceros">Terceros</a> — proveedores y sus atributos fiscales
          </li>
          <li>
            <a href="/reportes">Reportes</a> — libros y papeles de trabajo en Excel
          </li>
        </ul>
      </section>

      <form action={salirAction}>
        <button type="submit">Cerrar sesión</button>
      </form>
    </main>
  );
}

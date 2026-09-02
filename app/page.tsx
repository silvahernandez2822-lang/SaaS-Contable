/**
 * Inicio — panel real (D-078, Fase 1 de la ola de refinamiento de interfaz).
 *
 * Hasta D-078 esta era la portada plana de A12: elegir empresa y una lista de
 * enlaces en texto. Ahora es el panel que un contador ve al entrar: cuánto
 * trabajo real le espera (facturas listas para aprobar, alertas de datos
 * tributarios pendientes) y acceso directo a los seis módulos, dentro del
 * mismo `AppShell` y kit de `app/_ui/` que ya usan `/bandeja` y `/entrar` —
 * no una pantalla aparte con su propio lenguaje visual.
 *
 * Los NÚMEROS son reales, no maqueta: `obtenerBandejaConsolidada` es
 * literalmente el mismo servicio que agrega `/bandeja` (una sesión real por
 * empresa, D-021/D-022) y `detectarAlertasParametrizacion` es el mismo que usa
 * `/parametros` para su banner de alertas (advertencia 17.5). Nada se calcula
 * dos veces con lógica distinta: se reutiliza tal cual y solo se resume.
 *
 * Ninguna decisión de seguridad ni de negocio nueva: si no hay sesión,
 * `conSesionEmpresa` lanza y se redirige a `/entrar`, igual que antes de
 * D-078; si la contraseña la fijó un administrador, el desvío a
 * `/cambiar-password` (D-069) sigue intacto.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { conSesion, conSesionEmpresa, COOKIE_COMPANY_ID, SesionNoPresenteError } from './lib/sesion';
import { obtenerBandejaConsolidada } from './lib/bandeja';
import { estadoDeMiCredencial } from '../src/services/administracion';
import { detectarAlertasParametrizacion } from '../src/services/parametrizacion';
import { SesionInvalidaError } from '../src/db/tenant-context';
import { cambiarEmpresaActivaAction } from './_ui/acciones';
import { EnlaceBoton, Encabezado, EstadoVacio, MensajeEstado, Panel } from './_ui/componentes';
import {
  IconoAdmin,
  IconoParametros,
  IconoPuc,
  IconoReportes,
  IconoSubir,
  IconoTerceros,
} from './_ui/iconos';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;

/** Los seis módulos que no son la bandeja (ésta ya tiene su propio panel de
 *  resumen arriba, con su propio acceso directo). */
const ACCESOS_RAPIDOS = [
  {
    href: '/terceros',
    texto: 'Terceros',
    descripcion: 'Proveedores, atributos fiscales y actividad por municipio',
    icono: IconoTerceros,
  },
  {
    href: '/parametros',
    texto: 'Parámetros tributarios',
    descripcion: 'Tarifas, UVT, ReteICA por municipio',
    icono: IconoParametros,
  },
  {
    href: '/parametros/puc',
    texto: 'PUC / Plan de cuentas',
    descripcion: 'El genérico de la firma y el propio de cada empresa',
    icono: IconoPuc,
  },
  {
    href: '/carga-masiva',
    texto: 'Carga masiva',
    descripcion: 'Cargar catálogos completos desde Excel',
    icono: IconoSubir,
  },
  { href: '/reportes', texto: 'Reportes', descripcion: 'Libros y papeles de trabajo en Excel', icono: IconoReportes },
  {
    href: '/admin/usuarios',
    texto: 'Administración',
    descripcion: 'Usuarios, roles, permisos y correcciones por revisar',
    icono: IconoAdmin,
  },
] as const;

export default async function InicioPage({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const ok = typeof sp.ok === 'string' ? sp.ok : '';

  let credencial;
  try {
    // Sesión "de firma" (sin empresa, D-022): saber quién es y si le falta
    // cambiar la contraseña no depende de tener una empresa elegida.
    credencial = await conSesionEmpresa('', (tx) => estadoDeMiCredencial(tx));
  } catch (error) {
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      redirect('/entrar');
    }
    throw error;
  }
  if (credencial?.debeCambiarPassword) redirect('/cambiar-password');

  // Mismo agregador que `/bandeja` (D-021/D-022: una sesión real por empresa,
  // en secuencia — el cliente de base de datos no abre transacciones
  // concurrentes entre sí). Nada de esto se recalcula con lógica propia.
  const { empresas, pendientesAprobacion, pendientesRevision } = await obtenerBandejaConsolidada();
  const alertas = await conSesion((tx) => detectarAlertasParametrizacion(tx));

  const jarra = await cookies();
  const elegida = jarra.get(COOKIE_COMPANY_ID)?.value ?? '';
  const actual = empresas.find((e) => e.companyId === elegida) ?? null;
  const alertasAltas = alertas.filter((a) => a.severidad === 'alta').length;

  return (
    <div className="mx-auto max-w-6xl p-5">
      <Encabezado
        titulo={credencial ? `Hola, ${credencial.nombreCompleto}` : 'Inicio'}
        descripcion={
          actual
            ? `Trabajando sobre ${actual.razonSocial} (NIT ${actual.nit}) · ${empresas.length} empresa(s) accesible(s)`
            : `Sin empresa elegida · ${empresas.length} empresa(s) accesible(s)`
        }
      />

      {ok && <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(ok)} />}

      {empresas.length === 0 ? (
        <MensajeEstado tipo="configuracion" titulo="Su usuario no tiene acceso vigente a ninguna empresa-cliente.">
          Pídale al administrador de la firma que se lo otorgue.
        </MensajeEstado>
      ) : !actual ? (
        <Panel
          titulo="Elija una empresa para empezar"
          descripcion="Sin empresa elegida solo puede editar los parámetros compartidos de la firma — la bandeja y los reportes necesitan una empresa."
          className="mb-5"
        >
          <ul className="flex flex-col divide-y divide-borde p-1">
            {empresas.map((e) => (
              <li key={e.companyId}>
                <form action={cambiarEmpresaActivaAction}>
                  <input type="hidden" name="companyId" value={e.companyId} />
                  <input type="hidden" name="destino" value="/" />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-[13px] hover:bg-superficie"
                  >
                    <span>
                      <span className="font-semibold text-texto">{e.razonSocial}</span>{' '}
                      <span className="text-texto-suave tabular-nums">NIT {e.nit}</span>
                    </span>
                    <span className="text-[11px] text-texto-suave">rol {e.rolCodigo}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel
          titulo="Facturas pendientes de aprobación"
          descripcion={`${pendientesAprobacion.length} lista(s) para aprobar · ${pendientesRevision.length} en revisión manual, en sus ${empresas.length} empresa(s)`}
          acciones={
            <EnlaceBoton href="/bandeja" variante="secundario">
              Ir a la bandeja
            </EnlaceBoton>
          }
        >
          {pendientesAprobacion.length === 0 ? (
            <EstadoVacio titulo="Todo al día — no hay facturas pendientes" detalle="Cuando el motor cause nuevas facturas, las verá aquí y en la bandeja." />
          ) : (
            <ul className="divide-y divide-borde">
              {pendientesAprobacion.slice(0, 5).map((doc) => (
                <li key={doc.sourceDocumentId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="truncate">
                    <span className="font-medium text-texto">{doc.companyNombre}</span>{' '}
                    <span className="text-texto-suave">· documento {doc.numeroDocumento}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[11px] text-texto-suave">{doc.fechaHechoEconomico}</span>
                </li>
              ))}
              {pendientesAprobacion.length > 5 && (
                <li className="px-4 py-2 text-[12px] text-texto-suave">
                  y {pendientesAprobacion.length - 5} más en la bandeja
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel
          titulo="Alertas de parámetros"
          descripcion={`${alertas.length} dato(s) pendiente(s) de verificación humana (sección 17.5)${
            alertasAltas > 0 ? ` · ${alertasAltas} de severidad alta` : ''
          }`}
          acciones={
            <EnlaceBoton href="/parametros" variante="secundario">
              Ir a parámetros
            </EnlaceBoton>
          }
        >
          {alertas.length === 0 ? (
            <EstadoVacio
              icono={<IconoParametros width={44} height={44} strokeWidth={1.5} />}
              titulo="Sin alertas de parámetros"
              detalle="Ningún dato tributario está pendiente de verificación humana (sección 17.5)."
            />
          ) : (
            <ul className="divide-y divide-borde">
              {alertas.slice(0, 5).map((a, i) => (
                <li key={`${a.categoria}-${i}`} className="flex items-start gap-2 px-4 py-2.5 text-[13px]">
                  <span
                    className={`mt-[2px] shrink-0 rounded px-1.5 py-[1px] text-[10px] font-bold tracking-wide ${
                      a.severidad === 'alta' ? 'bg-error/12 text-error' : 'bg-pendiente/12 text-pendiente'
                    }`}
                  >
                    {a.severidad === 'alta' ? 'FALTA DATO' : 'VERIFICAR'}
                  </span>
                  <span className="text-texto-suave">{a.mensaje}</span>
                </li>
              ))}
              {alertas.length > 5 && (
                <li className="px-4 py-2 text-[12px] text-texto-suave">y {alertas.length - 5} más en parámetros</li>
              )}
            </ul>
          )}
        </Panel>
      </div>

      <h2 className="mb-2.5 text-seccion font-semibold tracking-tight text-texto">Módulos</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACCESOS_RAPIDOS.map((m) => {
          const Icono = m.icono;
          return (
            <Link
              key={m.href}
              href={m.href}
              className="flex items-start gap-3 rounded-[var(--radius-tarjeta)] border border-borde bg-superficie-elevada p-4 shadow-[var(--shadow-tarjeta)] transition-[border-color,box-shadow] duration-150 hover:border-primario hover:shadow-md dark:hover:border-primario-tinta-oscura"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primario/10 text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura">
                <Icono width={18} height={18} />
              </span>
              <span>
                <span className="block text-cuerpo font-semibold text-texto">{m.texto}</span>
                <span className="mt-[2px] block text-menor text-texto-suave">{m.descripcion}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

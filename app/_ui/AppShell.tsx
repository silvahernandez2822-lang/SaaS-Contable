'use client';

/**
 * D-077 · Ola 5 (front) — Shell de la aplicación real. Migrado desde
 * `app/diseno/_ui/AppShell.tsx` (Dirección A «Consola de operación»).
 *
 * D-082: barra superior y lateral neutras (superficie elevada, borde sutil); el
 * azul de marca queda como ACENTO — el módulo activo lleva fondo azul muy claro,
 * barra vertical de acento e ícono en azul. Toggle de tema claro/oscuro y de
 * densidad en la barra superior. En TODA pantalla interna:
 *
 *  · Selector de empresa activa, siempre visible. Sus opciones son las empresas
 *    accesibles reales de la sesión; elegir una envía el `FormData` de
 *    `cambiarEmpresaActivaAction` (reescribe la cookie `company_id`, D-022).
 *  · Navegación lateral con los módulos reales del producto.
 *  · Breadcrumb automático desde la ruta — reemplaza a `app/_navegacion.tsx`.
 *  · Toggle de densidad accesible globalmente.
 *
 * Es cliente porque necesita la ruta actual (`usePathname`) y estado de UI. No
 * lee datos ni decide permisos: si aquí aparece «Administración» pero la sesión
 * no tiene el permiso, la página de destino lo rechaza igual (lo impone el motor).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { salirAction } from '../entrar/acciones';
import { cambiarEmpresaActivaAction } from './acciones';
import { useDensidad, useEmpresa, useTema } from './contextos';
import {
  IconoAdmin,
  IconoBandeja,
  IconoChevronAbajo,
  IconoLuna,
  IconoMarca,
  IconoParametros,
  IconoPuc,
  IconoReportes,
  IconoSol,
  IconoSubir,
  IconoTerceros,
} from './iconos';

type Modulo = {
  href: string;
  texto: string;
  icono: (p: SVGProps<SVGSVGElement>) => ReactNode;
};

const MODULOS: readonly Modulo[] = [
  { href: '/bandeja', texto: 'Bandeja de causación', icono: IconoBandeja },
  { href: '/terceros', texto: 'Terceros', icono: IconoTerceros },
  { href: '/parametros', texto: 'Parámetros tributarios', icono: IconoParametros },
  { href: '/parametros/puc', texto: 'PUC / Plan de cuentas', icono: IconoPuc },
  { href: '/carga-masiva', texto: 'Carga masiva', icono: IconoSubir },
  { href: '/reportes', texto: 'Reportes', icono: IconoReportes },
  { href: '/admin/usuarios', texto: 'Administración', icono: IconoAdmin },
];

/** Etiqueta legible por segmento de ruta. Fusión de la del prototipo y la de
 *  `app/_navegacion.tsx` (A16), que este shell reemplaza. */
const ETIQUETAS: Record<string, string> = {
  bandeja: 'Bandeja de causación',
  terceros: 'Terceros',
  nuevo: 'Nuevo',
  actividades: 'Actividad económica',
  'atributos-fiscales': 'Atributos fiscales',
  historial: 'Historial',
  parametros: 'Parámetros tributarios',
  puc: 'PUC / Plan de cuentas',
  tarifas: 'Tarifas',
  'valores-base': 'Valores base',
  'reteica-municipios': 'ReteICA por municipio',
  'ica-municipios': 'ICA por municipio',
  reportes: 'Reportes',
  'carga-masiva': 'Carga masiva',
  admin: 'Administración',
  usuarios: 'Usuarios',
  roles: 'Roles y permisos',
  permisos: 'Permisos individuales',
  correcciones: 'Correcciones por revisar',
  retefuente: 'Retefuente',
  retefuente_salarios: 'Retefuente de salarios',
  autorretencion: 'Autorretención',
  reteiva: 'ReteIVA',
  reteica: 'ReteICA',
  iva: 'IVA',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * D-078 · Fase 1 — módulos que TODAVÍA no migraron su cuerpo al kit de
 * `app/_ui/` (ver el corte declarado en D-077). Sus pantallas usan
 * hexadecimales fijos que solo contrastan en modo claro (causa raíz en
 * `globals.css`, sección "ESCOTILLA DE TEMA POR SUBÁRBOL"): mientras estén en
 * esta lista, su contenido se pinta con `data-tema="claro"` fijo, tema aparte
 * del resto de la interfaz. Cuando un módulo migre, se borra su prefijo de
 * aquí — un solo sitio, no un `style` por archivo.
 *
 * D-092: `/admin` salió de la lista, y con él se vació. La escotilla de tema
 * por subárbol se conserva a propósito (`esRutaSinMigrar` y el `data-tema` de
 * abajo): es el mecanismo, no el caso. Volver a necesitarla es añadir un
 * prefijo, no reescribir el shell. */
const PREFIJOS_SIN_MIGRAR = [] as readonly string[];

function esRutaSinMigrar(pathname: string): boolean {
  return PREFIJOS_SIN_MIGRAR.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function etiquetaDe(seg: string): string {
  if (ETIQUETAS[seg]) return ETIQUETAS[seg];
  if (UUID.test(seg)) return 'Detalle';
  return decodeURIComponent(seg);
}

function migasDe(pathname: string): Array<{ href: string; texto: string; ultima: boolean }> {
  const segmentos = pathname.split('/').filter(Boolean);
  return segmentos.map((seg, i) => ({
    href: `/${segmentos.slice(0, i + 1).join('/')}`,
    texto: etiquetaDe(seg),
    ultima: i === segmentos.length - 1,
  }));
}

function moduloActivo(pathname: string, href: string): boolean {
  if (href === '/parametros/puc') return pathname.startsWith(href);
  if (href === '/parametros') {
    return (pathname === href || pathname.startsWith('/parametros/')) && !pathname.startsWith('/parametros/puc');
  }
  if (href === '/admin/usuarios') return pathname.startsWith('/admin');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '·';
  const primera = partes[0]![0] ?? '';
  const ultima = partes.length > 1 ? partes[partes.length - 1]![0] ?? '' : '';
  return (primera + ultima).toUpperCase();
}

function SelectorEmpresa({ destino }: { destino: string }) {
  const { empresas, activa, aviso } = useEmpresa();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        className="flex items-center gap-2.5 rounded-lg border border-borde bg-superficie-elevada px-3 py-1.5 text-left text-cuerpo text-texto transition-colors duration-150 hover:bg-superficie"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${activa ? 'bg-exito' : 'bg-texto-suave/40'}`}
          aria-hidden
        />
        <span className="flex flex-col leading-tight">
          <span className="font-semibold">{activa ? activa.razonSocial : 'Sin empresa (parámetros de la firma)'}</span>
          <span className="text-metadata text-texto-suave tabular-nums">
            {activa ? `NIT ${activa.nit} · rol ${activa.rolCodigo}` : `${empresas.length} empresa(s) accesible(s)`}
          </span>
        </span>
        <IconoChevronAbajo width={14} height={14} className="text-texto-suave" />
      </button>

      {abierto && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 w-96 overflow-hidden rounded-md border border-borde bg-superficie-elevada py-1 shadow-lg"
        >
          <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-texto-suave">
            Empresa activa
          </li>
          <li>
            <form action={cambiarEmpresaActivaAction}>
              <input type="hidden" name="companyId" value="" />
              <input type="hidden" name="destino" value={destino} />
              <button
                type="submit"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-superficie ${
                  activa === null ? 'bg-superficie font-semibold text-texto' : 'text-texto'
                }`}
              >
                <span>— sin empresa (parámetros de la firma) —</span>
              </button>
            </form>
          </li>
          {empresas.map((e) => (
            <li key={e.companyId}>
              <form action={cambiarEmpresaActivaAction}>
                <input type="hidden" name="companyId" value={e.companyId} />
                <input type="hidden" name="destino" value={destino} />
                <button
                  type="submit"
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-superficie ${
                    e.companyId === activa?.companyId ? 'bg-superficie font-semibold text-texto' : 'text-texto'
                  }`}
                >
                  <span className="flex flex-col leading-tight">
                    <span>{e.razonSocial}</span>
                    <span className="text-[11px] text-texto-suave tabular-nums">NIT {e.nit}</span>
                  </span>
                  {e.rolCodigo && <span className="text-[11px] text-texto-suave">rol {e.rolCodigo}</span>}
                </button>
              </form>
            </li>
          ))}
          {/* D-092-bis: sin `documento.leer` la lista no se puede resolver. Decir
              «no tiene acceso a ninguna empresa» era falso y mandaba al usuario
              a pedir un acceso que ya tenía. */}
          {aviso && <li className="px-3 py-2 text-[12px] text-texto-suave">{aviso}</li>}
          {empresas.length === 0 && !aviso && (
            <li className="px-3 py-2 text-[12px] text-texto-suave">
              Su usuario no tiene acceso vigente a ninguna empresa-cliente.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ToggleDensidad() {
  const { densidad, fijar } = useDensidad();
  return (
    <div
      role="group"
      aria-label="Densidad de la interfaz"
      className="flex gap-[2px] rounded-lg border border-borde bg-superficie p-[2px] text-menor"
    >
      {(['comodo', 'compacto'] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => fijar(d)}
          aria-pressed={densidad === d}
          className={`rounded-md px-2.5 py-1 transition-colors duration-150 ${
            densidad === d
              ? 'bg-superficie-elevada font-semibold text-texto shadow-[var(--shadow-tarjeta)]'
              : 'text-texto-suave hover:text-texto'
          }`}
        >
          {d === 'comodo' ? 'Cómodo' : 'Compacto'}
        </button>
      ))}
    </div>
  );
}

/** D-082 · tarea 7. Alterna claro/oscuro por elección explícita. El ícono
 *  muestra el destino del clic: luna en tema claro (ir a oscuro), sol en
 *  oscuro (volver a claro). */
function ToggleTema() {
  const { tema, alternar } = useTema();
  const irA = tema === 'claro' ? 'oscuro' : 'claro';
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={`Cambiar a tema ${irA}`}
      title={`Cambiar a tema ${irA}`}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-borde bg-superficie-elevada text-texto-suave transition-colors duration-150 hover:bg-superficie hover:text-texto"
    >
      {tema === 'claro' ? (
        <IconoLuna width={15} height={15} />
      ) : (
        <IconoSol width={15} height={15} />
      )}
    </button>
  );
}

function MenuUsuario({ usuario }: { usuario: { nombre: string; email: string } }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="flex items-center gap-2 text-cuerpo"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primario/10 text-metadata font-semibold text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura">
          {iniciales(usuario.nombre)}
        </span>
        <span className="text-texto">{usuario.nombre}</span>
        <IconoChevronAbajo width={13} height={13} className="text-texto-suave" />
      </button>
      {abierto && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-borde bg-superficie-elevada py-1 text-[13px] shadow-lg">
          <p className="px-3 py-2 text-[11px] text-texto-suave">{usuario.email}</p>
          <Link href="/" className="block px-3 py-2 text-texto hover:bg-superficie">
            Portada / cambiar empresa
          </Link>
          <Link href="/cambiar-password" className="block px-3 py-2 text-texto hover:bg-superficie">
            Cambiar mi contraseña
          </Link>
          <form action={salirAction} className="border-t border-borde">
            <button type="submit" className="block w-full px-3 py-2 text-left text-error-tinta hover:bg-superficie">
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function AppShell({
  usuario,
  children,
}: {
  usuario: { nombre: string; email: string } | null;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '/';
  const { activa } = useEmpresa();
  const { densidad } = useDensidad();
  const migas = migasDe(pathname);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-superficie text-texto">
      <header className="flex h-14 shrink-0 items-center gap-5 border-b border-borde bg-superficie-elevada px-4 text-texto">
        <Link
          href="/"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-texto"
        >
          <IconoMarca width={20} height={20} className="text-primario dark:text-primario-tinta-oscura" />
          Contable CO
        </Link>
        <SelectorEmpresa destino={pathname} />
        <div className="ml-auto flex items-center gap-3">
          <ToggleDensidad />
          <ToggleTema />
          {usuario && <MenuUsuario usuario={usuario} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Módulos"
          className="flex w-60 shrink-0 flex-col gap-[2px] border-r border-borde bg-superficie-elevada py-3 text-texto-suave"
        >
          <p className="px-4 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-texto-suave/70">
            Módulos
          </p>
          {MODULOS.map((m) => {
            const activo = moduloActivo(pathname, m.href);
            const Icono = m.icono;
            return (
              <Link
                key={m.href}
                href={m.href}
                aria-current={activo ? 'page' : undefined}
                className={`mx-2 flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-cuerpo transition-colors duration-150 ${
                  activo
                    ? 'border-primario bg-primario/8 font-semibold text-primario dark:border-primario-tinta-oscura dark:bg-primario-tinta-oscura/12 dark:text-primario-tinta-oscura'
                    : 'border-transparent text-texto-suave hover:bg-superficie hover:text-texto'
                }`}
              >
                <Icono
                  width={18}
                  height={18}
                  className={activo ? '' : 'text-texto-suave'}
                />
                {m.texto}
              </Link>
            );
          })}
          <div className="mt-auto border-t border-borde px-4 py-3 text-metadata text-texto-suave">
            {activa ? (
              <>
                Empresa: <span className="text-texto">{activa.razonSocial}</span>
              </>
            ) : (
              'Sin empresa en contexto'
            )}
          </div>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-borde bg-superficie-elevada px-5 py-2.5 text-menor text-texto-suave">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li className="flex items-center gap-1.5">
                <Link href="/" className="hover:text-primario dark:hover:text-primario-tinta-oscura">
                  Inicio
                </Link>
                <span className="text-borde">/</span>
              </li>
              {migas.map((m) => (
                <li key={m.href} className="flex items-center gap-1.5">
                  {m.ultima ? (
                    <span aria-current="page" className="font-semibold text-texto">
                      {m.texto}
                    </span>
                  ) : (
                    <Link href={m.href} className="hover:text-primario dark:hover:text-primario-tinta-oscura">
                      {m.texto}
                    </Link>
                  )}
                  {!m.ultima && <span className="text-borde">/</span>}
                </li>
              ))}
            </ol>
          </div>
          <div
            data-densidad={densidad}
            data-tema={esRutaSinMigrar(pathname) ? 'claro' : undefined}
            className="min-h-0 flex-1 overflow-auto bg-superficie text-texto"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

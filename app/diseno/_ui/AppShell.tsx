'use client';

/**
 * D-075 · Ola 5 — Shell del sistema de interfaz. Dirección A, «Consola de
 * operación»: barra superior y lateral en el azul de marca, densidad compacta
 * disponible, y —lo que el encargo exige en TODA pantalla interna—:
 *
 *  · Selector de empresa activa, siempre visible (arriba a la izquierda).
 *  · Navegación lateral con los 6 módulos.
 *  · Breadcrumb automático desde la ruta — ninguna pantalla es un callejón sin
 *    salida (mismo argumento que `app/_navegacion.tsx`: si vive en el shell,
 *    toda ruta lo hereda por construcción).
 *  · Toggle de densidad accesible globalmente.
 *
 * Es cliente porque necesita la ruta actual (`usePathname`) y estado de UI.
 * No lee datos ni decide permisos.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { useDensidad, useEmpresa } from './contextos';
import {
  IconoAdmin,
  IconoBandeja,
  IconoChevronAbajo,
  IconoMarca,
  IconoParametros,
  IconoPuc,
  IconoReportes,
  IconoTerceros,
} from './iconos';

const BASE = '/diseno';

type Modulo = {
  href: string;
  texto: string;
  icono: (p: SVGProps<SVGSVGElement>) => ReactNode;
  /** Insignia numérica opcional (p. ej. pendientes en la bandeja). */
  insignia?: number;
};

const MODULOS: readonly Modulo[] = [
  { href: `${BASE}/bandeja`, texto: 'Bandeja de causación', icono: IconoBandeja, insignia: 18 },
  { href: `${BASE}/terceros`, texto: 'Terceros', icono: IconoTerceros },
  { href: `${BASE}/parametros`, texto: 'Parámetros tributarios', icono: IconoParametros },
  { href: `${BASE}/reportes`, texto: 'Reportes', icono: IconoReportes },
  { href: `${BASE}/parametros/puc`, texto: 'PUC / Plan de cuentas', icono: IconoPuc },
  { href: `${BASE}/admin/usuarios`, texto: 'Administración', icono: IconoAdmin },
];

/** Etiqueta legible por segmento de ruta. Igual criterio que `app/_navegacion.tsx`. */
const ETIQUETAS: Record<string, string> = {
  diseno: 'Inicio',
  bandeja: 'Bandeja de causación',
  terceros: 'Terceros',
  parametros: 'Parámetros tributarios',
  puc: 'PUC / Plan de cuentas',
  reportes: 'Reportes',
  admin: 'Administración',
  usuarios: 'Usuarios',
  roles: 'Roles y permisos',
  correcciones: 'Correcciones por revisar',
};

function migasDe(pathname: string): Array<{ href: string; texto: string; ultima: boolean }> {
  const segmentos = pathname.split('/').filter(Boolean); // ['diseno', ...]
  return segmentos.map((seg, i) => ({
    href: `/${segmentos.slice(0, i + 1).join('/')}`,
    texto: ETIQUETAS[seg] ?? decodeURIComponent(seg),
    ultima: i === segmentos.length - 1,
  }));
}

function moduloActivo(pathname: string, href: string): boolean {
  if (href === `${BASE}/parametros/puc`) return pathname.startsWith(href);
  if (href === `${BASE}/parametros`) return pathname === href || pathname.startsWith(`${BASE}/parametros/tarifas`);
  if (href === `${BASE}/admin/usuarios`) return pathname.startsWith(`${BASE}/admin`);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SelectorEmpresa() {
  const { empresa, empresas, cambiar } = useEmpresa();
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
        className="flex items-center gap-2.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-left text-[13px] text-white hover:bg-white/15"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-exito" aria-hidden />
        <span className="flex flex-col leading-tight">
          <span className="font-semibold">{empresa.nombre}</span>
          <span className="text-[11px] text-white/60 tabular-nums">NIT {empresa.nit}</span>
        </span>
        <IconoChevronAbajo width={14} height={14} className="text-white/60" />
      </button>

      {abierto && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-md border border-borde bg-superficie-elevada py-1 shadow-lg"
        >
          <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-texto-suave">
            Empresa activa
          </li>
          {empresas.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                role="option"
                aria-selected={e.id === empresa.id}
                onClick={() => {
                  cambiar(e.id);
                  setAbierto(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-superficie ${
                  e.id === empresa.id ? 'bg-superficie font-semibold text-texto' : 'text-texto'
                }`}
              >
                <span className="flex flex-col leading-tight">
                  <span>{e.nombre}</span>
                  <span className="text-[11px] text-texto-suave tabular-nums">NIT {e.nit}</span>
                </span>
                <span className="text-[11px] text-texto-suave">{e.periodoAbierto}</span>
              </button>
            </li>
          ))}
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
      className="flex overflow-hidden rounded-md border border-white/20 text-[12px]"
    >
      {(['comodo', 'compacto'] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => fijar(d)}
          aria-pressed={densidad === d}
          className={`px-2.5 py-1 ${
            densidad === d ? 'bg-white font-semibold text-primario' : 'text-white/70 hover:text-white'
          }`}
        >
          {d === 'comodo' ? 'Cómodo' : 'Compacto'}
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? BASE;
  const { empresa } = useEmpresa();
  const { densidad } = useDensidad();
  const migas = migasDe(pathname);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-superficie text-texto">
      {/* ---------- barra superior ---------- */}
      <header className="flex h-13 shrink-0 items-center gap-5 bg-primario px-4 text-white">
        <Link href={`${BASE}`} className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-white">
          <IconoMarca width={20} height={20} />
          Contable CO
        </Link>
        <SelectorEmpresa />
        <div className="ml-auto flex items-center gap-4">
          <ToggleDensidad />
          <span className="flex items-center gap-2 text-[13px]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primario-tinta-oscura text-[11px] font-semibold text-white">
              MR
            </span>
            <span className="text-white/85">M. Rueda</span>
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------- navegación lateral ---------- */}
        <nav
          aria-label="Módulos"
          className="flex w-56 shrink-0 flex-col gap-[2px] border-r border-white/10 bg-primario py-2.5 text-white/80"
        >
          <p className="px-4 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/45">Módulos</p>
          {MODULOS.map((m) => {
            const activo = moduloActivo(pathname, m.href);
            const Icono = m.icono;
            return (
              <Link
                key={m.href}
                href={m.href}
                aria-current={activo ? 'page' : undefined}
                className={`flex items-center gap-3 border-l-[3px] px-4 py-2.5 text-[13px] ${
                  activo
                    ? 'border-primario-tinta-oscura bg-primario font-semibold text-white'
                    : 'border-transparent hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icono width={17} height={17} />
                {m.texto}
                {m.insignia !== undefined && (
                  <span className="ml-auto rounded-full bg-pendiente px-1.5 text-[11px] font-bold tabular-nums text-texto">
                    {m.insignia}
                  </span>
                )}
              </Link>
            );
          })}
          <div className="mt-auto border-t border-white/10 px-4 py-3 text-[11px] text-white/45">
            Periodo abierto: <span className="text-white/70">{empresa.periodoAbierto}</span>
          </div>
        </nav>

        {/* ---------- área de trabajo ---------- */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-borde bg-superficie-elevada px-5 py-2.5 text-[12px] text-texto-suave">
            <ol className="flex flex-wrap items-center gap-1.5">
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
          <div data-densidad={densidad} className="min-h-0 flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

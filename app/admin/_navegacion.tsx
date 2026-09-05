/**
 * D-092 — Navegación interna del módulo de Administración.
 *
 * `/admin` tiene cinco pantallas y hasta D-092 se enlazaban entre sí con una
 * línea de `<Link>` separados por puntos, distinta en cada archivo (y en
 * `/admin/permisos` habría sido una sexta variante). Se unifica en un
 * componente que además marca cuál está abierta. No lee datos ni decide
 * permisos: cada pantalla exige el suyo.
 */
import Link from 'next/link';

const PANTALLAS = [
  { clave: 'usuarios', href: '/admin/usuarios', texto: 'Usuarios' },
  { clave: 'roles', href: '/admin/roles', texto: 'Roles y permisos' },
  { clave: 'permisos', href: '/admin/permisos', texto: 'Permisos individuales' },
  { clave: 'correcciones', href: '/admin/correcciones', texto: 'Correcciones por revisar' },
  { clave: 'historial', href: '/admin/historial', texto: 'Historial de permisos' },
] as const;

export type PantallaAdmin = (typeof PANTALLAS)[number]['clave'];

export function NavegacionAdmin({ activo }: { activo: PantallaAdmin }) {
  return (
    <nav aria-label="Secciones de administración" className="flex flex-wrap gap-1 border-b border-borde pb-2">
      {PANTALLAS.map((p) => (
        <Link
          key={p.clave}
          href={p.href}
          aria-current={p.clave === activo ? 'page' : undefined}
          className={`rounded-md px-3 py-1.5 text-menor transition-colors duration-150 ${
            p.clave === activo
              ? 'bg-primario/10 font-semibold text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura'
              : 'text-texto-suave hover:bg-superficie hover:text-texto'
          }`}
        >
          {p.texto}
        </Link>
      ))}
    </nav>
  );
}

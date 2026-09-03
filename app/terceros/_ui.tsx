'use client';

/**
 * D-084 · TAREA 0 / roadmap — Terceros vive en su propio submódulo con pestañas
 * internas. Dentro de la ficha de un tercero: Detalle · Atributos fiscales ·
 * Actividad económica · Historial. Cliente porque necesita `usePathname` para
 * marcar la pestaña activa.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Pestana = { href: string; texto: string };

export function TabsTercero({ id }: { id: string }) {
  const pathname = usePathname() ?? '';
  const base = `/terceros/${id}`;
  const pestanas: Pestana[] = [
    { href: base, texto: 'Detalle' },
    { href: `${base}/atributos-fiscales`, texto: 'Atributos fiscales' },
    { href: `${base}/actividades`, texto: 'Actividad económica' },
    { href: `${base}/historial`, texto: 'Historial' },
  ];
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-borde">
      {pestanas.map((p) => {
        const activa = p.href === base ? pathname === base : pathname.startsWith(p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={activa ? 'page' : undefined}
            className={`rounded-t-md px-3 py-2 text-cuerpo font-semibold ${
              activa
                ? 'border border-b-0 border-borde bg-superficie-elevada text-texto'
                : 'text-texto-suave hover:text-texto'
            }`}
          >
            {p.texto}
          </Link>
        );
      })}
    </nav>
  );
}

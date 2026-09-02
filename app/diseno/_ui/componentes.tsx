'use client';

/**
 * D-075 · Ola 5 — Piezas compartidas del sistema de interfaz (Dirección A:
 * «Consola de operación»).
 *
 * REGLA DE COLOR. Solo tokens de `app/globals.css`: utilidades de Tailwind v4
 * generadas desde `@theme static` (`bg-primario`, `text-texto-suave`,
 * `border-borde`, `bg-exito/10`…). Ni un `#hex` suelto — es la deuda que cerró
 * D-074.
 *
 * CAVEAT DECLARADO (no aprobado, para decisión humana — ver ESTADO_PROYECTO):
 * los colores de estado (`--color-exito|error|pendiente`) tienen UN solo valor
 * y sobre blanco quedan por debajo de 4,5:1 como texto normal. Para los badges
 * se usan a plena tinta con `font-semibold` y tamaño ≥12px, y con un fondo
 * `/12` del mismo tono. Falta en la paleta una «tinta» oscura de cada estado
 * (equivalente a `--color-primario-tinta-oscura` para el azul). No se inventó.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconoAlerta, IconoInfo } from './iconos';

/* --------------------------------------------------------------- estados */

export type Estado = 'pendiente' | 'aprobado' | 'rechazado' | 'revision';

const ESTADO_TEXTO: Record<Estado, string> = {
  pendiente: 'PENDIENTE',
  aprobado: 'APROBADO',
  rechazado: 'RECHAZADO',
  revision: 'PENDIENTE DE REVISIÓN',
};

const ESTADO_CLASE: Record<Estado, string> = {
  pendiente: 'bg-pendiente/12 text-pendiente',
  aprobado: 'bg-exito/12 text-exito',
  rechazado: 'bg-error/12 text-error',
  revision: 'bg-pendiente/12 text-pendiente',
};

const ESTADO_PUNTO: Record<Estado, string> = {
  pendiente: 'bg-pendiente',
  aprobado: 'bg-exito',
  rechazado: 'bg-error',
  revision: 'bg-pendiente',
};

/** Punto de color: señal de estado en una fila de lista sin ocupar ancho. */
export function PuntoEstado({ estado }: { estado: Estado }) {
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ESTADO_PUNTO[estado]}`} aria-hidden />;
}

export function EtiquetaEstado({ estado, children }: { estado: Estado; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-[2px] text-[11px] font-bold tracking-wide ${ESTADO_CLASE[estado]}`}
    >
      {children ?? ESTADO_TEXTO[estado]}
    </span>
  );
}

export type TonoBadge = 'error' | 'pendiente' | 'neutro' | 'primario' | 'exito';

const BADGE_CLASE: Record<TonoBadge, string> = {
  error: 'bg-error/12 text-error',
  pendiente: 'bg-pendiente/12 text-pendiente',
  exito: 'bg-exito/12 text-exito',
  neutro: 'bg-texto-suave/12 text-texto-suave',
  primario: 'bg-primario/10 text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura',
};

export function Badge({ tono = 'neutro', children }: { tono?: TonoBadge; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-[2px] text-[11px] font-semibold tracking-wide tabular-nums ${BADGE_CLASE[tono]}`}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- botones */

type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro';

const BOTON_CLASE: Record<VarianteBoton, string> = {
  primario: 'bg-primario text-primario-contraste hover:brightness-110 border border-transparent',
  secundario:
    'bg-superficie-elevada text-primario border border-primario hover:bg-primario/5 dark:text-primario-tinta-oscura dark:border-primario-tinta-oscura',
  fantasma: 'bg-superficie-elevada text-texto border border-borde hover:bg-superficie',
  peligro: 'bg-superficie-elevada text-error-tinta border border-borde hover:bg-error/5',
};

export function Boton({
  variante = 'primario',
  tipo = 'button',
  className = '',
  ...props
}: {
  variante?: VarianteBoton;
  tipo?: 'button' | 'submit';
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'>) {
  return (
    <button
      type={tipo}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${BOTON_CLASE[variante]} ${className}`}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ contenedores */

export function Panel({
  titulo,
  descripcion,
  acciones,
  children,
  className = '',
}: {
  titulo?: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-borde bg-superficie-elevada ${className}`}>
      {(titulo || acciones) && (
        <header className="flex items-center justify-between gap-3 border-b border-borde bg-superficie px-4 py-2.5">
          <div>
            {titulo && <h2 className="text-[13px] font-semibold text-texto">{titulo}</h2>}
            {descripcion && <p className="mt-[2px] text-[11px] text-texto-suave">{descripcion}</p>}
          </div>
          {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Encabezado({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 pb-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight text-texto">{titulo}</h1>
        {descripcion && <p className="mt-1 text-[13px] text-texto-suave">{descripcion}</p>}
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
    </div>
  );
}

/* -------------------------------------------------------- campos de formulario */

export function Campo({
  etiqueta,
  ayuda,
  requerido,
  children,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  requerido?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-texto">
        {etiqueta}
        {requerido && <span className="text-error-tinta"> *</span>}
      </span>
      {children}
      {ayuda && <span className="text-[11px] text-texto-suave">{ayuda}</span>}
    </label>
  );
}

const CLASE_CONTROL =
  'rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] text-texto placeholder:text-texto-suave/70 focus:border-primario focus:outline-none focus:ring-2 focus:ring-primario/20';

export function Entrada(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CLASE_CONTROL} ${props.className ?? ''}`} />;
}

export function Selector(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CLASE_CONTROL} ${props.className ?? ''}`} />;
}

/* ------------------------------------------------------------------- tablas */

export function Tabla({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-[12.5px] ${className}`}>{children}</table>
    </div>
  );
}

export function Th({ children, alineado = 'left' }: { children?: ReactNode; alineado?: 'left' | 'right' }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 font-medium text-texto-suave ${alineado === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  alineado = 'left',
  numerico = false,
  className = '',
}: {
  children?: ReactNode;
  alineado?: 'left' | 'right';
  numerico?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 ${alineado === 'right' ? 'text-right' : ''} ${numerico ? 'tabular-nums' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/* ----------------------------------------------- los TRES estados de mensaje
 *
 * El encargo de Reportes lo pide explícito y visualmente distinto; se
 * generaliza aquí porque el mismo trío aparece en Parámetros y en cualquier
 * pantalla que consulte datos:
 *   · `configuracion` → falta algo obligatorio: accionable, con enlace.
 *   · `sin-datos`      → no hay nada para el filtro: neutro, sin alarma.
 *   · `error`          → fallo técnico: genérico, SIN detalle crudo.
 */
export type TipoMensaje = 'configuracion' | 'sin-datos' | 'error';

export function MensajeEstado({
  tipo,
  titulo,
  children,
  accion,
}: {
  tipo: TipoMensaje;
  titulo: ReactNode;
  children?: ReactNode;
  accion?: { texto: string; href: string };
}) {
  const estilos: Record<TipoMensaje, { caja: string; icono: ReactNode }> = {
    configuracion: {
      caja: 'border-pendiente/40 bg-pendiente/8',
      icono: <IconoAlerta className="text-pendiente-tinta" width={18} height={18} />,
    },
    'sin-datos': {
      caja: 'border-borde bg-superficie',
      icono: <IconoInfo className="text-texto-suave" width={18} height={18} />,
    },
    error: {
      caja: 'border-error/40 bg-error/8',
      icono: <IconoAlerta className="text-error-tinta" width={18} height={18} />,
    },
  };
  const s = estilos[tipo];
  return (
    <div className={`flex gap-3 rounded-lg border p-4 ${s.caja}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <span className="mt-[2px] shrink-0">{s.icono}</span>
      <div className="text-[13px]">
        <p className="font-semibold text-texto">{titulo}</p>
        {children && <div className="mt-1 text-texto-suave">{children}</div>}
        {accion && (
          <Link
            href={accion.href}
            className="mt-2 inline-block font-semibold text-primario underline dark:text-primario-tinta-oscura"
          >
            {accion.texto}
          </Link>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- historial de vigencias
 *
 * Regla de Oro 3: editar un atributo con vigencia NO sobreescribe — cierra la
 * fila anterior y abre una nueva. La interfaz tiene que hacer visible esa
 * cadena, no esconderla.
 */
export type Vigencia = {
  valor: ReactNode;
  desde: string;
  hasta: string | null;
  norma?: string;
};

export function HistorialVigencias({ titulo, filas }: { titulo: ReactNode; filas: readonly Vigencia[] }) {
  return (
    <div className="rounded-md border border-borde">
      <div className="border-b border-borde bg-superficie px-3 py-2 text-[12px] font-semibold text-texto">{titulo}</div>
      <ul className="divide-y divide-borde">
        {filas.map((f, i) => (
          <li key={`${f.desde}-${i}`} className="flex items-baseline gap-3 px-3 py-2 text-[12px]">
            <span className="tabular-nums text-texto-suave">
              {f.desde} → {f.hasta ?? 'vigente'}
            </span>
            <span className={`font-medium ${f.hasta === null ? 'text-texto' : 'text-texto-suave'}`}>{f.valor}</span>
            {f.hasta === null && <Badge tono="exito">actual</Badge>}
            {f.norma && <span className="ml-auto text-[11px] text-texto-suave">{f.norma}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

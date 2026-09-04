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
 * `/12` del mismo tono. Las «tintas» oscuras de cada estado
 * (`--color-*-tinta`) ya existen desde D-074/075 (derivadas, no aprobadas).
 *
 * D-082: tipografía por tokens de rol (`text-metadata|menor|cuerpo|seccion|
 * titulo`), tarjetas con `--shadow-tarjeta` + `--radius-tarjeta`, botón
 * `terciario`, y `EstadoVacio` para los «no hay nada aquí» neutros.
 */
import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconoAlerta, IconoBandeja, IconoInfo } from './iconos';

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

/* D-082 · tarea 6. Jerarquía explícita:
 *   primario   → relleno azul (acción principal, una por vista)
 *   secundario → borde azul, sin relleno (acción alterna)
 *   terciario  → solo texto, sin borde ni relleno (acción de bajo peso)
 *   fantasma   → borde neutro (acción neutra en barras de herramientas)
 *   peligro    → borde neutro + tinta de error (rechazar / eliminar)
 * Transición sutil de 150ms en todas. */
type VarianteBoton = 'primario' | 'secundario' | 'terciario' | 'fantasma' | 'peligro';

const BOTON_CLASE: Record<VarianteBoton, string> = {
  primario: 'bg-primario text-primario-contraste hover:brightness-110 border border-transparent shadow-[var(--shadow-tarjeta)]',
  secundario:
    'bg-superficie-elevada text-primario border border-primario hover:bg-primario/5 dark:text-primario-tinta-oscura dark:border-primario-tinta-oscura',
  terciario:
    'bg-transparent text-primario border border-transparent hover:bg-primario/5 dark:text-primario-tinta-oscura',
  fantasma: 'bg-superficie-elevada text-texto border border-borde hover:bg-superficie',
  peligro: 'bg-superficie-elevada text-error-tinta border border-borde hover:bg-error/5',
};

const CLASE_BOTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-cuerpo font-semibold transition-[background-color,border-color,box-shadow,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-50';

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
      className={`${CLASE_BOTON_BASE} ${BOTON_CLASE[variante]} ${className}`}
      {...props}
    />
  );
}

/** Un enlace con la pinta de `Boton` — para "ir a X", nunca dentro de un
 *  `<form>`. NO envolver `<Boton>` en `<Link>`: un `<button>` dentro de un
 *  `<a>` es HTML inválido (contenido interactivo anidado). */
export function EnlaceBoton({
  href,
  variante = 'primario',
  className = '',
  children,
}: {
  href: string;
  variante?: VarianteBoton;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${CLASE_BOTON_BASE} ${BOTON_CLASE[variante]} ${className}`}>
      {children}
    </Link>
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
    <section
      className={`overflow-hidden rounded-[var(--radius-tarjeta)] border border-borde bg-superficie-elevada shadow-[var(--shadow-tarjeta)] ${className}`}
    >
      {(titulo || acciones) && (
        <header className="flex items-center justify-between gap-3 border-b border-borde bg-superficie px-5 py-3">
          <div>
            {titulo && <h2 className="text-seccion font-semibold tracking-tight text-texto">{titulo}</h2>}
            {descripcion && <p className="mt-[2px] text-metadata text-texto-suave">{descripcion}</p>}
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
    <div className="flex items-end justify-between gap-4 pb-5">
      <div>
        <h1 className="text-titulo font-semibold text-texto">{titulo}</h1>
        {descripcion && <p className="mt-1 text-menor text-texto-suave">{descripcion}</p>}
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

/* ------------------------------------------------------------------- tablas
 *
 * D-078 · Fase 1 de interfaz — encabezado fijo y primera columna fija, en el
 * componente, no tabla por tabla. `Th` siempre queda `sticky top-0`: no tiene
 * costo cuando la tabla no desborda verticalmente, y así toda tabla que se
 * migre a este kit hereda el encabezado fijo sin pedirlo. La primera columna
 * (la identificadora — cuenta, NIT, código...) es opt-in con
 * `fijarPrimeraColumna`, porque no toda tabla tiene una columna así: se aplica
 * con un selector de descendiente en el contenedor de scroll, no repitiendo
 * una prop en cada `Td`/`Th` de la tabla. Las celdas fijas llevan
 * `bg-superficie-elevada` opaco para que el contenido no se transparente por
 * debajo al desplazar. */

export function Tabla({
  children,
  className = '',
  fijarPrimeraColumna = false,
  alturaMaxima = '70vh',
}: {
  children: ReactNode;
  className?: string;
  /** Fija la primera columna (identificadora) al hacer scroll horizontal. */
  fijarPrimeraColumna?: boolean;
  /** Alto máximo del contenedor de scroll — dentro de él el encabezado queda
   *  pegado arriba. `null` deja que la tabla crezca libre, sin scroll propio. */
  alturaMaxima?: string | null;
}) {
  return (
    <div
      className={`overflow-auto ${
        fijarPrimeraColumna
          ? '[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-20 [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-[5] [&_td:first-child]:bg-superficie-elevada'
          : ''
      }`}
      style={alturaMaxima ? { maxHeight: alturaMaxima } : undefined}
    >
      <table className={`w-full border-collapse text-[12.5px] ${className}`}>{children}</table>
    </div>
  );
}

export function Th({ children, alineado = 'left' }: { children?: ReactNode; alineado?: 'left' | 'right' }) {
  return (
    <th
      className={`sticky top-0 z-10 whitespace-nowrap bg-superficie-elevada px-3 py-2 font-medium text-texto-suave ${alineado === 'right' ? 'text-right' : 'text-left'}`}
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

/* ----------------------------------------------------------- estado vacío
 *
 * D-082 · tarea 4. Un «no hay nada aquí» DISEÑADO, no un ícono de info con
 * texto plano: ícono grande y tenue, un texto principal directo y humano
 * («Todo al día — no hay facturas pendientes»), y un texto secundario
 * opcional. Para el caso neutro «no hay datos» / «el filtro no devolvió
 * nada»; los casos `configuracion` (falta un dato, accionable) y `error`
 * (fallo técnico) siguen en `MensajeEstado`, que sí necesita marco y color.
 */
export function EstadoVacio({
  titulo,
  detalle,
  icono,
  accion,
}: {
  titulo: ReactNode;
  detalle?: ReactNode;
  icono?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center" role="status">
      <span className="text-texto-suave/25" aria-hidden>
        {icono ?? <IconoBandeja width={44} height={44} strokeWidth={1.5} />}
      </span>
      <p className="text-seccion font-semibold text-texto">{titulo}</p>
      {detalle && <p className="max-w-sm text-menor text-texto-suave">{detalle}</p>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- modal
 *
 * D-087 · tarea 1. Extraído del modal de dirección DIAN de D-086
 * (`app/terceros/_direccion-dian.tsx`): mismo markup y comportamiento —
 * `role="dialog"` + `aria-modal`, overlay `bg-texto/40`, cierre con Escape y
 * con clic fuera (mousedown sobre el overlay), el diálogo recibe el foco al
 * abrir y lo devuelve al elemento previo al cerrar. Un `Tab`/`Shift+Tab`
 * dentro del diálogo cicla entre sus elementos enfocables (foco atrapado).
 * Sin colores sueltos: solo tokens.
 */
export function Modal({
  titulo,
  descripcion,
  onCerrar,
  children,
  pie,
  ancho = 'max-w-xl',
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  onCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const nodo = dialogRef.current;
    nodo?.focus();

    /* A14, compuerta de D-090 (V-51): `input:not([disabled])` incluía los
     * `<input type="hidden">`, que NO son enfocables. En el primer modal del
     * producto que tiene campos ocultos (`CargaMasiva`, con `catalogo` y
     * `soloValidas`) el «primer enfocable» salía siendo uno de ellos, así que
     * el Tab del último elemento hacía `preventDefault()` y luego un `.focus()`
     * que no hace nada: el foco se quedaba clavado en el último y el diálogo
     * dejaba de ciclar. Se excluyen también los `[hidden]` y los
     * `aria-hidden="true"` por el mismo motivo. */
    const SELECTOR_ENFOCABLE =
      'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
      'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    const enfocables = () =>
      Array.from(nodo?.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE) ?? []).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCerrar();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = enfocables();
      if (items.length === 0) {
        e.preventDefault();
        nodo?.focus();
        return;
      }
      const primero = items[0]!;
      const ultimo = items[items.length - 1]!;
      const activo = document.activeElement;
      /* A14, compuerta de D-090 (V-51): el manejador solo reconocía los dos
       * BORDES. Si el foco no estaba en ninguno —porque estaba en el propio
       * contenedor, en `body` (le pasa a cualquier modal cuando el botón que
       * tenía el foco se deshabilita al enviar, que es justo lo que hace
       * «Validar y cargar»), o directamente fuera del diálogo— el Tab se le
       * dejaba al navegador, y el navegador lo llevaba al primer enfocable del
       * DOCUMENTO: la navegación del AppShell, por debajo del modal. El foco se
       * escapaba de un diálogo `aria-modal="true"`. Ahora, si el foco no está
       * dentro, el Tab lo devuelve al diálogo. */
      const dentro = activo instanceof Node && activo !== nodo && !!nodo?.contains(activo);
      if (!dentro) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
        return;
      }
      if (e.shiftKey && activo === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previo?.focus?.();
    };
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-texto/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof titulo === 'string' ? titulo : undefined}
        tabIndex={-1}
        className={`w-full ${ancho} overflow-hidden rounded-[var(--radius-tarjeta)] border border-borde bg-superficie-elevada shadow-[var(--shadow-tarjeta)] outline-none`}
      >
        <header className="border-b border-borde bg-superficie px-5 py-3">
          <h2 className="text-seccion font-semibold tracking-tight text-texto">{titulo}</h2>
          {descripcion && <p className="mt-[2px] text-metadata text-texto-suave">{descripcion}</p>}
        </header>
        <div className="p-5">{children}</div>
        {pie && (
          <div className="flex justify-end gap-2 border-t border-borde bg-superficie px-5 py-3">{pie}</div>
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

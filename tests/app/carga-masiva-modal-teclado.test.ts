// @vitest-environment jsdom
/**
 * A14 — compuerta AMPLIADA de D-090, frente 1: TECLADO REAL sobre el modal de
 * `app/_ui/CargaMasiva.tsx`, no un snapshot del DOM ni una aserción de que «el
 * componente usa Modal».
 *
 * El componente se MONTA de verdad (react-dom/client + `act`), con lo cual
 * corre el `useEffect` real de `Modal` (`componentes.tsx`, D-087): el que
 * registra el `keydown` en `document`, atrapa el foco y devuelve el foco al
 * disparador al desmontar. Los eventos de teclado se despachan sobre el
 * `document` de jsdom, que es exactamente donde ese efecto escucha.
 *
 * LÍMITE HONESTO DE jsdom, declarado en vez de disimulado: jsdom NO mueve el
 * foco por su cuenta al pulsar Tab (eso es comportamiento nativo del
 * navegador). Lo que un navegador hace y jsdom no es el paso INTERMEDIO de la
 * secuencia (del elemento 2 al 3). Lo que decide si el foco se escapa o no del
 * diálogo son los BORDES —el último elemento hacia adelante, el primero hacia
 * atrás— y ahí el movimiento no lo hace el navegador: lo hace el `preventDefault`
 * + `focus()` del propio `Modal`, que sí es código nuestro y sí corre aquí. Esa
 * es la parte que se verifica, más el caso en que el foco NO está dentro del
 * diálogo, que es donde estaba el agujero (V-51).
 *
 * `cargarArchivoAction` se sustituye por un doble: es una acción de servidor
 * que arrastra la base de datos entera y este archivo no prueba la carga, prueba
 * el teclado. El CONTRATO con esa acción (los `name` de los campos) se verifica
 * aparte, en `carga-masiva-contrato-formulario.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../app/carga-masiva/acciones', () => ({
  cargarArchivoAction: async () => null,
}));

const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CargaMasiva } = await import('../../app/_ui/CargaMasiva');

// React 19 avisa por consola si se actualiza estado fuera de `act`; aquí todo
// va dentro de `act`, pero la bandera hace falta para que no lo advierta.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let contenedor: HTMLDivElement;
let raiz: ReturnType<typeof createRoot>;
/** Un elemento enfocable FUERA del diálogo, como la navegación del AppShell.
 * Si el foco acaba aquí con el modal abierto, la trampa se rompió. */
let fuera: HTMLButtonElement;

function montar(props: Record<string, unknown> = {}) {
  act(() => {
    raiz.render(
      createElement(CargaMasiva, {
        clave: 'third_party',
        titulo: 'Terceros',
        descripcion: 'Descripción de prueba',
        permiso: 'tercero.editar',
        puede: true,
        ...props,
      } as never),
    );
  });
}

function dialogo(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

/**
 * Los elementos que un NAVEGADOR de verdad enfoca con Tab dentro del diálogo.
 * Deliberadamente NO se copia el selector de `Modal`: si se copiara, el test
 * heredaría su mismo error. Un `<input type="hidden">` no lo enfoca ningún
 * navegador, y `CargaMasiva` tiene dos (`catalogo`, `soloValidas`).
 */
function enfocables(): HTMLElement[] {
  const d = dialogo();
  if (!d) return [];
  return Array.from(
    d.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !(el instanceof window.HTMLInputElement && el.type === 'hidden'));
}

/** Despacha un keydown REAL sobre `document` y devuelve si alguien lo canceló. */
function tecla(key: string, opciones: { shift?: boolean } = {}): boolean {
  const evento = new window.KeyboardEvent('keydown', {
    key,
    shiftKey: opciones.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  let cancelado = false;
  act(() => {
    document.dispatchEvent(evento);
    cancelado = evento.defaultPrevented;
  });
  return cancelado;
}

function abrirModal() {
  const disparador = Array.from(document.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Cargar masivo'),
  );
  expect(disparador, 'el disparador «Cargar masivo» tiene que existir').toBeTruthy();
  disparador!.focus();
  act(() => {
    disparador!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  return disparador!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  fuera = document.createElement('button');
  fuera.textContent = 'navegación del AppShell (fuera del diálogo)';
  document.body.appendChild(fuera);
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  document.body.innerHTML = '';
});

describe('A14 · D-090 frente 1 — teclado real en el modal de CargaMasiva', () => {
  it('el diálogo se abre, es un dialog modal y el foco entra en él (no se queda en el disparador)', () => {
    montar();
    expect(dialogo()).toBeNull();
    abrirModal();

    const d = dialogo();
    expect(d, 'tras pulsar el disparador tiene que haber un role="dialog"').toBeTruthy();
    expect(d!.getAttribute('aria-modal')).toBe('true');
    expect(d!.getAttribute('aria-label')).toBe('Carga masiva · Terceros');
    // El efecto real de `Modal` movió el foco al contenedor del diálogo.
    expect(document.activeElement).toBe(d);
    expect(d!.contains(document.activeElement)).toBe(true);
  });

  it('Escape cierra el diálogo (tecla real sobre document, no un onClick)', () => {
    montar();
    abrirModal();
    expect(dialogo()).toBeTruthy();

    tecla('Escape');

    expect(dialogo(), 'Escape tiene que desmontar el diálogo').toBeNull();
  });

  it('Tab en el ÚLTIMO enfocable vuelve al primero: no se escapa por delante', () => {
    montar();
    abrirModal();
    const items = enfocables();
    expect(items.length, 'el diálogo tiene que tener enfocables').toBeGreaterThan(1);
    const ultimo = items[items.length - 1]!;
    const primero = items[0]!;

    // V-51, segunda mitad: el modal tiene DOS `<input type="hidden">`. Si la
    // trampa los cuenta como enfocables, «el primero» es uno de ellos, el
    // `.focus()` no hace nada en ningún navegador y el foco se queda clavado en
    // el último: el diálogo deja de ciclar hacia adelante.
    expect(dialogo()!.querySelectorAll('input[type="hidden"]').length).toBeGreaterThan(0);
    expect(primero.tagName === 'INPUT' && (primero as HTMLInputElement).type).not.toBe('hidden');

    ultimo.focus();
    expect(document.activeElement).toBe(ultimo);
    const cancelado = tecla('Tab');

    expect(cancelado, 'el Tab del borde tiene que cancelarse, no dejarse al navegador').toBe(true);
    expect(document.activeElement, 'el foco tiene que aterrizar en un elemento REALMENTE enfocable').toBe(
      primero,
    );
    expect(dialogo()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(fuera);
  });

  it('Shift+Tab en el PRIMER enfocable salta al último: no se escapa por detrás', () => {
    montar();
    abrirModal();
    const items = enfocables();
    const primero = items[0]!;
    const ultimo = items[items.length - 1]!;

    primero.focus();
    const cancelado = tecla('Tab', { shift: true });

    expect(cancelado).toBe(true);
    expect(document.activeElement).toBe(ultimo);
    expect(document.activeElement).not.toBe(fuera);
  });

  it('Shift+Tab con el foco en el contenedor del diálogo (estado inicial) salta al último', () => {
    montar();
    abrirModal();
    const items = enfocables();
    expect(document.activeElement).toBe(dialogo());

    const cancelado = tecla('Tab', { shift: true });

    expect(cancelado).toBe(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('V-51 — con el foco FUERA del diálogo (body), Tab tampoco se escapa: se devuelve al diálogo', () => {
    // Este es el caso real, no teórico: mientras la carga está en curso el botón
    // «Validar y cargar» se pone `disabled`, y un elemento deshabilitado pierde
    // el foco al `body`. También pasa con un clic en cualquier zona no enfocable
    // del modal. Con el foco en `body`, el manejador original no reconocía ni
    // `primero` ni `ultimo` ni `nodo`, no cancelaba el Tab, y el navegador lo
    // llevaba al primer enfocable del DOCUMENTO — que está FUERA del diálogo.
    montar();
    abrirModal();
    const d = dialogo()!;

    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(d.contains(document.activeElement)).toBe(false);

    const cancelado = tecla('Tab');

    expect(cancelado, 'un Tab con el foco fuera del diálogo NO se puede dejar al navegador').toBe(true);
    expect(d.contains(document.activeElement), 'el foco tiene que volver dentro del diálogo').toBe(true);
    expect(document.activeElement).not.toBe(fuera);
  });

  it('V-51 — lo mismo con Shift+Tab desde fuera del diálogo', () => {
    montar();
    abrirModal();
    const d = dialogo()!;
    fuera.focus();
    expect(document.activeElement).toBe(fuera);

    const cancelado = tecla('Tab', { shift: true });

    expect(cancelado).toBe(true);
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('al cerrar, el foco vuelve al disparador que lo abrió', () => {
    montar();
    const disparador = abrirModal();
    expect(document.activeElement).not.toBe(disparador);

    tecla('Escape');

    expect(dialogo()).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });

  it('el botón «Cerrar» del pie cierra, y sigue habiendo salida por ratón', () => {
    montar();
    abrirModal();
    const cerrar = Array.from(dialogo()!.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Cerrar',
    );
    expect(cerrar, 'el pie del modal tiene que traer un «Cerrar»').toBeTruthy();
    act(() => {
      cerrar!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(dialogo()).toBeNull();
  });

  it('sin permiso, el diálogo sigue siendo un diálogo con teclado: Escape cierra y el Tab no se escapa', () => {
    // El aviso de «falta el permiso» no trae formulario: es el caso de POCOS
    // enfocables, donde una trampa mal escrita se rompe con más facilidad.
    montar({ puede: false });
    abrirModal();
    const d = dialogo()!;
    expect(d.textContent).toContain('tercero.editar');

    (document.activeElement as HTMLElement | null)?.blur?.();
    const cancelado = tecla('Tab');
    expect(cancelado).toBe(true);
    expect(d.contains(document.activeElement)).toBe(true);

    tecla('Escape');
    expect(dialogo()).toBeNull();
  });
});

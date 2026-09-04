// @vitest-environment jsdom
/**
 * A14 — compuerta AMPLIADA de D-090, frente 3: el CONTRATO entre lo que el
 * formulario manda y lo que `cargarArchivoAction` lee.
 *
 * El refactor de A8 movió el markup de `CargaMasiva.tsx` y de
 * `[catalogo]/_formulario.tsx` a otro envoltorio. Un `name` renombrado por el
 * camino no lo detecta ni `tsc` ni `next build` ni ninguna prueba de servicio:
 * la acción recibiría `catalogo` vacío y respondería «catálogo desconocido», y
 * la carga masiva entera quedaría rota en silencio hasta que alguien la
 * probara a mano.
 *
 * Así que aquí se monta el componente DE VERDAD, se construye un `FormData`
 * desde el `<form>` que renderiza (que es lo que hace el navegador al enviar) y
 * se comprueba contra los nombres que `acciones.ts` lee, LEÍDOS DEL ARCHIVO, no
 * copiados a mano — si alguien renombra el campo en los dos lados a la vez, la
 * prueba lo permite; si lo renombra en uno solo, falla.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../app/carga-masiva/acciones', () => ({
  cargarArchivoAction: async () => null,
}));

const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CargaMasiva } = await import('../../app/_ui/CargaMasiva');
const { FormularioCarga } = await import('../../app/carga-masiva/[catalogo]/_formulario');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Los `formData.get('...')` que hace realmente la acción de servidor. */
const CAMPOS_QUE_LEE_LA_ACCION = (() => {
  const fuente = readFileSync('app/carga-masiva/acciones.ts', 'utf8');
  return [...fuente.matchAll(/formData\.get\('([^']+)'\)/g)].map((m) => m[1]!);
})();

let contenedor: HTMLDivElement;
let raiz: ReturnType<typeof createRoot>;

beforeEach(() => {
  document.body.innerHTML = '';
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  document.body.innerHTML = '';
});

function nombresDelFormulario(form: HTMLFormElement): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name]')).map((i) => i.name);
}

describe('A14 · D-090 frente 3 — el contrato del formulario de carga masiva no se rompió', () => {
  it('la acción lee exactamente tres campos: catalogo, archivo y soloValidas', () => {
    expect([...CAMPOS_QUE_LEE_LA_ACCION].sort()).toEqual(['archivo', 'catalogo', 'soloValidas']);
  });

  it('el modal `CargaMasiva` manda `catalogo` y `archivo` con esos nombres exactos', () => {
    act(() => {
      raiz.render(
        createElement(CargaMasiva, {
          clave: 'third_party',
          titulo: 'Terceros',
          descripcion: 'x',
          permiso: 'tercero.editar',
          puede: true,
        } as never),
      );
    });
    const disparador = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Cargar masivo'),
    )!;
    act(() => {
      disparador.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    expect(form, 'el modal tiene que traer un formulario').toBeTruthy();
    const nombres = nombresDelFormulario(form);

    expect(nombres).toContain('catalogo');
    expect(nombres).toContain('archivo');
    // El valor del catálogo es el que se le pasó por prop, no un literal.
    const oculto = form.querySelector<HTMLInputElement>('input[name="catalogo"]')!;
    expect(oculto.type).toBe('hidden');
    expect(oculto.value).toBe('third_party');
    // El input de archivo acepta los tres formatos del importador.
    const archivo = form.querySelector<HTMLInputElement>('input[name="archivo"]')!;
    expect(archivo.type).toBe('file');
    expect(archivo.accept).toBe('.xlsx,.xlsm,.csv');
    expect(archivo.required).toBe(true);
    // Ningún nombre sobra: lo que el navegador enviaría es un subconjunto de
    // lo que la acción lee.
    for (const n of nombres) expect(CAMPOS_QUE_LEE_LA_ACCION).toContain(n);
  });

  it('sin permiso el modal NO renderiza formulario: no hay envío que el motor tenga que rechazar', () => {
    act(() => {
      raiz.render(
        createElement(CargaMasiva, {
          clave: 'third_party',
          titulo: 'Terceros',
          descripcion: 'x',
          permiso: 'tercero.editar',
          puede: false,
        } as never),
      );
    });
    const disparador = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Cargar masivo'),
    )!;
    act(() => {
      disparador.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"] form')).toBeNull();
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('tercero.editar');
  });

  it('la subpágina `/carga-masiva/[catalogo]` manda los mismos nombres', () => {
    act(() => {
      raiz.render(createElement(FormularioCarga, { clave: 'account', titulo: 'Plan de cuentas' } as never));
    });
    const form = contenedor.querySelector<HTMLFormElement>('form')!;
    const nombres = nombresDelFormulario(form);

    expect(nombres).toContain('catalogo');
    expect(nombres).toContain('archivo');
    expect(form.querySelector<HTMLInputElement>('input[name="catalogo"]')!.value).toBe('account');
    const archivo = form.querySelector<HTMLInputElement>('input[name="archivo"]')!;
    expect(archivo.type).toBe('file');
    expect(archivo.accept).toBe('.xlsx,.xlsm,.csv');
    for (const n of nombres) expect(CAMPOS_QUE_LEE_LA_ACCION).toContain(n);
  });

  it('el `soloValidas` que renderiza el informe vale "1", que es lo único que la acción acepta', () => {
    // La acción hace `=== '1'`. Un `value="true"` la dejaría sin efecto y el
    // usuario cargaría el archivo entero creyendo que carga solo las válidas.
    const fuenteAccion = readFileSync('app/carga-masiva/acciones.ts', 'utf8');
    expect(fuenteAccion).toContain(`String(formData.get('soloValidas') ?? '') === '1'`);
    for (const archivo of ['app/_ui/CargaMasiva.tsx', 'app/carga-masiva/[catalogo]/_formulario.tsx']) {
      const fuente = readFileSync(archivo, 'utf8');
      expect(fuente, `${archivo} tiene que mandar soloValidas="1"`).toContain(
        `<input type="hidden" name="soloValidas" value="1" />`,
      );
    }
  });
});

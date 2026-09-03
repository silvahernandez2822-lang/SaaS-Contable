/**
 * D-084 · TAREA 0 — Piezas del maestro de terceros, migradas al kit de
 * `app/_ui/`. Ya no hay `style` inline ni hexadecimales: todo pasa por los
 * tokens de tema, así que el módulo responde a `data-tema="oscuro"` igual que
 * `/` y `/bandeja`.
 */
import type { ReactNode } from 'react';
import { MensajeEstado } from '../_ui/componentes';

export function MensajeError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="my-3">
      <MensajeEstado tipo="error" titulo={decodeURIComponent(error)} />
    </div>
  );
}

export function MensajeGuardado({ visible, texto }: { visible: boolean; texto?: string }) {
  if (!visible) return null;
  return (
    <div className="my-3">
      <MensajeEstado tipo="sin-datos" titulo={texto ?? 'Guardado.'} />
    </div>
  );
}

/**
 * Par de radios "Sí/No" SIN opción preseleccionada (a propósito: ver la
 * cabecera de `src/services/terceros.ts`). `required` en los dos, para que el
 * navegador no deje enviar el formulario sin que el contador haya tocado cada
 * bandera — el servicio lo vuelve a exigir en el servidor (`requerirBooleano`).
 */
export function RadioSiNo({ nombre, etiqueta }: { nombre: string; etiqueta: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-borde/60 py-2 last:border-b-0">
      <span className="text-cuerpo text-texto">{etiqueta}</span>
      <span className="flex shrink-0 gap-4 text-cuerpo text-texto">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={nombre} value="si" required /> Sí
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={nombre} value="no" required /> No
        </label>
      </span>
    </div>
  );
}

export function Si({ valor }: { valor: boolean }) {
  return (
    <span className={valor ? 'font-medium text-texto' : 'text-texto-suave'}>{valor ? 'Sí' : 'No'}</span>
  );
}

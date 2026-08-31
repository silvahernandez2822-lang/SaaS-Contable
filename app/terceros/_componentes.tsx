/**
 * A8 — Piezas reutilizables del maestro de terceros. Mismo criterio de
 * `app/parametros/_componentes.tsx`: HTML semántico, sin librería de estilos.
 */
export { MensajeError } from '../parametros/_componentes';

/**
 * Par de radios "Sí/No" SIN opción preseleccionada (a propósito: ver la
 * cabecera de `src/services/terceros.ts`). `required` en los dos, para que
 * el navegador no deje enviar el formulario sin que el contador haya tocado
 * cada bandera — el servicio lo vuelve a exigir en el servidor
 * (`requerirBooleano`), esto es solo la primera línea de defensa.
 */
export function RadioSiNo({ nombre, etiqueta }: { nombre: string; etiqueta: string }) {
  return (
    <div style={{ margin: '4px 0' }}>
      <span>{etiqueta}: </span>
      <label style={{ marginRight: '12px' }}>
        <input type="radio" name={nombre} value="si" required /> Sí
      </label>
      <label>
        <input type="radio" name={nombre} value="no" required /> No
      </label>
    </div>
  );
}

export function Si({ valor }: { valor: boolean }) {
  return <span>{valor ? 'Sí' : 'No'}</span>;
}

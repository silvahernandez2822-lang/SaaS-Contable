/**
 * `not-found.tsx` propio, con el kit de `app/_ui/` en vez de la página en
 * blanco por defecto de Next. No existía ninguno antes de esta fase.
 */
import { Encabezado, EnlaceBoton } from './_ui/componentes';

export default function NoEncontrado() {
  return (
    <div className="mx-auto max-w-2xl p-5">
      <Encabezado titulo="Página no encontrada" descripcion="La ruta que buscó no existe en Contable CO." />
      <EnlaceBoton href="/" variante="secundario">
        Volver al inicio
      </EnlaceBoton>
    </div>
  );
}

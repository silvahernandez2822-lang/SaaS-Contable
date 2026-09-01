/**
 * Layout raíz de Next.js App Router.
 *
 * Nació mínimo con A8 (Ola 2): la primera pantalla del producto era
 * `/parametros` y no había navegación que compartir. A16 (Ola 4, Tarea 0) le
 * añade lo único que sigue siendo global: la barra de navegación con el
 * breadcrumb y el botón «Volver» (`app/_navegacion.tsx`).
 *
 * POR QUÉ AQUÍ Y NO EN CADA PÁGINA: puesto en el layout raíz, toda ruta lo
 * hereda por construcción — incluidas las que se añadan después. Repetirlo por
 * página era el problema que se estaba arreglando, no la solución.
 *
 * La barra NO decide nada de seguridad: enseña enlaces, y cada destino sigue
 * exigiendo su sesión y su permiso al motor (`conSesion` + `app.exigir_permiso`).
 */
import type { ReactNode } from 'react';
import { NavegacionGlobal } from './_navegacion';

export const metadata = {
  title: 'Contable CO',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <NavegacionGlobal />
        {children}
      </body>
    </html>
  );
}

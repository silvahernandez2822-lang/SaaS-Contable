/**
 * Layout raíz mínimo de Next.js App Router.
 *
 * No existía ningún `app/` en el repositorio antes de este módulo (A8, Ola 2,
 * sección 6): esta es la primera pantalla real del producto. Deliberadamente
 * no lleva estilos ni navegación global — eso es trabajo de A7/A5 cuando
 * construyan el resto de la interfaz. Si otro agente ya trae su propio
 * `app/layout.tsx` para fusionar, este archivo se reemplaza sin que
 * `app/parametros/**` tenga que cambiar una sola línea.
 */
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Contable CO — Parametrización',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

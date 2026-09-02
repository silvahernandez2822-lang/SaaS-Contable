/**
 * D-075 · Ola 5 — Layout de las pantallas internas del prototipo.
 *
 * El grupo de ruta `(app)` no cambia la URL: agrupa todo lo que va DENTRO del
 * shell (todo `/diseno/*` menos `/diseno/entrar`, que es pantalla completa).
 * Los proveedores de empresa activa y densidad envuelven aquí para que toda
 * pantalla los herede, igual que el color y la navegación en el layout raíz.
 */
import type { ReactNode } from 'react';
import { AppShell } from '../_ui/AppShell';
import { DensidadProvider, EmpresaProvider } from '../_ui/contextos';

export default function LayoutInterno({ children }: { children: ReactNode }) {
  return (
    <EmpresaProvider>
      <DensidadProvider>
        <AppShell>{children}</AppShell>
      </DensidadProvider>
    </EmpresaProvider>
  );
}

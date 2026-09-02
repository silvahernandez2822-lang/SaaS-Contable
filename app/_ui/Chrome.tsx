'use client';

/**
 * D-077 · Ola 5 (front) — Envoltura de cliente que decide si una ruta lleva el
 * shell de la aplicación o va sola.
 *
 * POR QUÉ AQUÍ Y NO EN UN GRUPO DE RUTAS `(interno)`: mover las nueve carpetas
 * de ruta a un grupo obligaría a reescribir los imports relativos de ~25
 * archivos de servidor sin poder probar el resultado en `next dev`. Un
 * componente de cliente que mira `usePathname()` consigue lo mismo — toda ruta
 * interna hereda el shell por construcción — con un radio de cambio mínimo.
 *
 * Las tres rutas SIN shell son pantalla completa por diseño: `/entrar` (login),
 * `/` (portada: elegir empresa, cerrar sesión) y `/cambiar-password`.
 *
 * Los datos (empresas accesibles, empresa activa, usuario) los inyecta el layout
 * raíz de servidor con la sesión ya verificada; este componente solo los reparte.
 */
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { EmpresaProvider, DensidadProvider, type EmpresaAccesible } from './contextos';

const RUTAS_SIN_SHELL = new Set(['/', '/entrar', '/cambiar-password']);

export function Chrome({
  empresas,
  activaId,
  usuario,
  children,
}: {
  empresas: readonly EmpresaAccesible[];
  activaId: string | null;
  usuario: { nombre: string; email: string } | null;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '/';

  if (RUTAS_SIN_SHELL.has(pathname)) return <>{children}</>;

  return (
    <EmpresaProvider empresas={empresas} activaId={activaId}>
      <DensidadProvider>
        <AppShell usuario={usuario}>{children}</AppShell>
      </DensidadProvider>
    </EmpresaProvider>
  );
}

/**
 * Layout raíz de Next.js App Router.
 *
 * Nació mínimo con A8 (Ola 2). A16 (Ola 4) le añadió la barra de navegación
 * compartida (`app/_navegacion.tsx`). D-077 (Ola 5, front) la retira y la
 * reemplaza por el SHELL del sistema de interfaz: barra superior con selector de
 * empresa y menú de usuario, navegación lateral de módulos, breadcrumb y toggle
 * de densidad. Migrado del prototipo `app/diseno/**`.
 *
 * POR QUÉ AQUÍ: puesto en el layout raíz, toda ruta hereda el shell por
 * construcción — incluidas las que se añadan después. El shell no decide nada de
 * seguridad: enseña enlaces y reparte la empresa en contexto; cada destino sigue
 * exigiendo su sesión y su permiso al motor (`conSesion` + `app.exigir_permiso`).
 *
 * La empresa activa y la lista de empresas accesibles se resuelven aquí, en
 * servidor, con la sesión de firma (`conSesionEmpresa('')`, D-022): saber qué
 * empresas hay ANTES de elegir una es exactamente para lo que sirve. Si no hay
 * sesión, no se redirige desde el layout (haría un bucle en `/entrar`): se pinta
 * sin datos de shell y cada página interna hace su propio desvío a `/entrar`.
 *
 *  · `globals.css` trae los tokens de color y tipografía aprobados (D-074).
 *  · Inter se sirve desde el propio dominio con `next/font/google` (no un `<link>`
 *    a Google Fonts): quita una petición a un tercero y el salto de texto.
 *  · D-082: el tema por defecto es claro SIEMPRE. El modo oscuro solo se activa
 *    si el usuario lo eligió con el toggle (persistido en `localStorage`). El
 *    script en línea de más abajo aplica esa elección sobre `<html>` ANTES del
 *    primer pintado, para que no haya un parpadeo claro→oscuro al cargar.
 */
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { conSesionEmpresa, COOKIE_COMPANY_ID, SesionNoPresenteError } from './lib/sesion';
import { SesionInvalidaError } from '../src/db/tenant-context';
import { listarEmpresasAccesibles, type EmpresaAccesible } from '../src/services/bandeja';
import { estadoDeMiCredencial } from '../src/services/administracion';
import { Chrome } from './_ui/Chrome';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--fuente-inter',
});

export const metadata = {
  title: 'Contable CO',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  let empresas: EmpresaAccesible[] = [];
  let usuario: { nombre: string; email: string } | null = null;
  let activaId: string | null = null;

  try {
    const [lista, credencial] = await conSesionEmpresa('', async (tx) => {
      return [await listarEmpresasAccesibles(tx), await estadoDeMiCredencial(tx)] as const;
    });
    empresas = lista;
    usuario = credencial ? { nombre: credencial.nombreCompleto, email: credencial.email } : null;
    activaId = (await cookies()).get(COOKIE_COMPANY_ID)?.value || null;
  } catch (error) {
    // Sin sesión (lo normal en `/entrar` y `/`): se pinta sin datos de shell y
    // cada página interna hace su propio desvío a `/entrar`. Cualquier otro
    // error (incluida la señal interna de Next para render dinámico, o una base
    // caída — con la que tampoco se podría iniciar sesión) se propaga: es la
    // misma política que la portada (`app/page.tsx`).
    if (!(error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError)) {
      throw error;
    }
  }

  return (
    <html lang="es" className={inter.variable}>
      <head>
        <script
          // Antes del primer pintado: si el usuario eligió un tema explícito, se
          // aplica; si no, se queda claro (no se mira `prefers-color-scheme`).
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('contable-co:tema');if(t==='oscuro'||t==='claro'){document.documentElement.dataset.tema=t}}catch(e){}",
          }}
        />
      </head>
      <body>
        <Chrome empresas={empresas} activaId={activaId} usuario={usuario}>
          {children}
        </Chrome>
      </body>
    </html>
  );
}

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
 *  · D-085: el tema por defecto vuelve a seguir `prefers-color-scheme` del SO en
 *    la primera visita (se revierte la parte de D-081/D-082 que lo forzaba a
 *    claro). **Sin elección guardada → SO**, y lo resuelve el CSS con
 *    `@media (prefers-color-scheme)` en `globals.css`, sin una línea de
 *    JavaScript ni parpadeo. **Con elección guardada (toggle sol/luna) → la del
 *    usuario, gana sobre el SO**: `TemaProvider` la escribe en la cookie
 *    `contable-co-tema`, este layout de servidor la LEE y la pinta en
 *    `<html data-tema>` antes de mandar el HTML — así tampoco hay parpadeo para
 *    la elección explícita y no hace falta un `<script>` bloqueante (que además
 *    React 19 rechaza renderizar en sus re-render de cliente: era el origen del
 *    `console.error` al cambiar de empresa). `suppressHydrationWarning` porque
 *    `data-tema` puede cambiar servidor↔cliente si el usuario alterna sin
 *    recargar; es la única diferencia esperada.
 */
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { conSesionEmpresa, COOKIE_COMPANY_ID, COOKIE_TEMA, SesionNoPresenteError } from './lib/sesion';
import { SesionInvalidaError } from '../src/db/tenant-context';
import { type EmpresaAccesible } from '../src/services/bandeja';
import { estadoDeMiCredencial } from '../src/services/administracion';
import { empresasVisiblesParaLaSesion, explicacionDeOrigen } from './lib/empresas';
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
  /** Por qué la lista de empresas puede venir incompleta o vacía (D-092-bis).
   *  `null` = no hay nada que explicar. */
  let avisoEmpresas: string | null = null;

  // Tema elegido por el usuario (cookie escrita por `TemaProvider`). Sin cookie
  // (primera visita, o nunca tocó el toggle) → `null` y manda el SO por CSS.
  const jarra = await cookies();
  const temaCookie = jarra.get(COOKIE_TEMA)?.value;
  const tema: 'claro' | 'oscuro' | null =
    temaCookie === 'claro' || temaCookie === 'oscuro' ? temaCookie : null;

  try {
    // D-092-bis: `listarEmpresasAccesibles` exige `documento.leer` EN EL MOTOR,
    // y esto es el layout raíz — es decir, TODA pantalla. Un usuario válido sin
    // ese permiso (p. ej. el administrador acotado con solo
    // `usuario.administrar` que D-092 hizo creable) recibía aquí un `SE002` sin
    // capturar y no podía abrir NINGUNA ruta, ni las suyas. Ahora se pregunta
    // primero y se degrada con la verdad; ningún permiso del motor se relaja.
    const [visibles, credencial] = await conSesionEmpresa('', async (tx) => {
      return [await empresasVisiblesParaLaSesion(tx), await estadoDeMiCredencial(tx)] as const;
    });
    empresas = visibles.empresas;
    avisoEmpresas = explicacionDeOrigen(visibles.origen);
    usuario = credencial ? { nombre: credencial.nombreCompleto, email: credencial.email } : null;
    activaId = jarra.get(COOKIE_COMPANY_ID)?.value || null;
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
    <html
      lang="es"
      className={inter.variable}
      data-tema={tema ?? undefined}
      suppressHydrationWarning
    >
      <body>
        <Chrome
          empresas={empresas}
          activaId={activaId}
          usuario={usuario}
          temaInicial={tema}
          avisoEmpresas={avisoEmpresas}
        >
          {children}
        </Chrome>
      </body>
    </html>
  );
}

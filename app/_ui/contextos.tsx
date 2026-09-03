'use client';

/**
 * D-077 · Ola 5 (front) — Estado global del shell de la aplicación real.
 *
 * Migrado desde `app/diseno/_ui/contextos.tsx`. Dos cosas que TODA pantalla
 * interna comparte y que el shell necesita «siempre visibles / accesibles
 * globalmente»:
 *
 *  · La empresa activa (`EmpresaProvider`). YA NO es una lista de maqueta: la
 *    lista de empresas accesibles y cuál está en contexto las inyecta el layout
 *    de servidor (`app/(interno)/layout` vía props), que a su vez las obtiene de
 *    `listarEmpresasAccesibles` con la sesión verificada. Cambiar de empresa
 *    envía el `FormData` de `cambiarEmpresaActivaAction`, que reescribe la cookie
 *    `company_id` — exactamente lo que hace el selector de la portada (D-022):
 *    la cookie no autoriza, solo recuerda cuál pidió el usuario; el acceso lo
 *    impone la base en cada consulta.
 *  · La densidad cómodo/compacto (`DensidadProvider`). Idéntico al prototipo: se
 *    persiste en `localStorage` para que la elección del contador sobreviva a la
 *    recarga.
 *
 * Ninguno decide nada de seguridad: son preferencias de presentación.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ empresa */

export type EmpresaAccesible = {
  companyId: string;
  razonSocial: string;
  nit: string;
  rolCodigo: string;
};

type EmpresaCtx = {
  /** Empresas sobre las que la sesión tiene acceso vigente. */
  empresas: readonly EmpresaAccesible[];
  /** La que está en contexto (cookie `company_id`), o `null` = sesión de firma. */
  activa: EmpresaAccesible | null;
};

const ContextoEmpresa = createContext<EmpresaCtx | null>(null);

export function EmpresaProvider({
  empresas,
  activaId,
  children,
}: {
  empresas: readonly EmpresaAccesible[];
  activaId: string | null;
  children: ReactNode;
}) {
  const valor = useMemo<EmpresaCtx>(() => {
    const activa = empresas.find((e) => e.companyId === activaId) ?? null;
    return { empresas, activa };
  }, [empresas, activaId]);
  return <ContextoEmpresa.Provider value={valor}>{children}</ContextoEmpresa.Provider>;
}

export function useEmpresa(): EmpresaCtx {
  const ctx = useContext(ContextoEmpresa);
  if (!ctx) throw new Error('useEmpresa fuera de <EmpresaProvider>');
  return ctx;
}

/* ----------------------------------------------------------------- densidad */

export type Densidad = 'comodo' | 'compacto';

const CLAVE_DENSIDAD = 'contable-co:densidad';

type DensidadCtx = {
  densidad: Densidad;
  alternar: () => void;
  fijar: (d: Densidad) => void;
};

const ContextoDensidad = createContext<DensidadCtx | null>(null);

export function DensidadProvider({ children }: { children: ReactNode }) {
  const [densidad, setDensidad] = useState<Densidad>('comodo');

  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CLAVE_DENSIDAD);
      if (guardado === 'comodo' || guardado === 'compacto') setDensidad(guardado);
    } catch {
      /* localStorage no disponible: se queda en el valor por defecto */
    }
  }, []);

  const fijar = useCallback((d: Densidad) => {
    setDensidad(d);
    try {
      window.localStorage.setItem(CLAVE_DENSIDAD, d);
    } catch {
      /* sin persistencia: no es crítico */
    }
  }, []);

  const alternar = useCallback(() => {
    setDensidad((d) => {
      const siguiente: Densidad = d === 'comodo' ? 'compacto' : 'comodo';
      try {
        window.localStorage.setItem(CLAVE_DENSIDAD, siguiente);
      } catch {
        /* sin persistencia */
      }
      return siguiente;
    });
  }, []);

  const valor = useMemo<DensidadCtx>(() => ({ densidad, alternar, fijar }), [densidad, alternar, fijar]);
  return (
    <ContextoDensidad.Provider value={valor}>
      <div data-densidad={densidad} className="contents">
        {children}
      </div>
    </ContextoDensidad.Provider>
  );
}

export function useDensidad(): DensidadCtx {
  const ctx = useContext(ContextoDensidad);
  if (!ctx) throw new Error('useDensidad fuera de <DensidadProvider>');
  return ctx;
}

/* --------------------------------------------------------------------- tema
 *
 * D-085 (revierte la parte de tema de D-081/D-082). Resolución del tema:
 *
 *   · Sin elección guardada  → se sigue `prefers-color-scheme` del SO. Lo hace
 *     el CSS (`@media` en `globals.css`), sin una sola línea de JavaScript y
 *     sin parpadeo.
 *   · Con elección guardada  → gana la del usuario (toggle sol/luna). Se guarda
 *     en la cookie `contable-co-tema` (NO en `localStorage`) para que el layout
 *     de servidor pueda leerla y pintar `<html data-tema>` en el HTML inicial:
 *     así tampoco hay parpadeo para la elección explícita, y no se necesita un
 *     `<script>` bloqueante — que React 19 rechaza renderizar en sus re-render
 *     de cliente («Encountered a script tag while rendering React component»),
 *     que es lo que hacía saltar el error de consola al cambiar de empresa.
 *
 * Este provider recibe de servidor el tema de la cookie (`inicial`), así que
 * arranca con el mismo valor en servidor y cliente (sin mismatch). Escribe la
 * cookie y sincroniza `<html data-tema>` cuando el usuario alterna sin recargar.
 */
export type Tema = 'claro' | 'oscuro';

/** Debe coincidir con `COOKIE_TEMA` de `app/lib/sesion.ts`. */
const COOKIE_TEMA = 'contable-co-tema';
const UN_ANIO_EN_SEGUNDOS = 60 * 60 * 24 * 365;

type TemaCtx = {
  tema: Tema;
  alternar: () => void;
  fijar: (t: Tema) => void;
};

const ContextoTema = createContext<TemaCtx | null>(null);

/** Persiste la elección del usuario donde el servidor puede leerla. */
function guardarCookieTema(t: Tema) {
  try {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${COOKIE_TEMA}=${t}; path=/; max-age=${UN_ANIO_EN_SEGUNDOS}; samesite=lax${secure}`;
  } catch {
    /* sin cookie: la elección no sobrevive a la recarga, no es crítico */
  }
}

/** Tema del SO (`prefers-color-scheme`), con claro como red de seguridad. */
function temaDelSistema(): Tema {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  } catch {
    return 'claro';
  }
}

export function TemaProvider({
  inicial,
  children,
}: {
  /** Tema de la cookie leído en servidor. `null` = sin elección; manda el SO. */
  inicial: Tema | null;
  children: ReactNode;
}) {
  // Mismo valor en servidor y cliente: sin elección, `claro` es solo el punto
  // de partida del ícono del toggle; el color real lo pinta el CSS por `@media`.
  const [tema, setTema] = useState<Tema>(inicial ?? 'claro');
  const [hayEleccion, setHayEleccion] = useState<boolean>(inicial !== null);

  // Sin elección propia: el estado de React sigue al SO (para que el ícono del
  // toggle muestre lo correcto), y reacciona si el usuario cambia el modo del SO.
  useEffect(() => {
    if (hayEleccion) return;
    const resolver = () => setTema(temaDelSistema());
    resolver();
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', resolver);
    } catch {
      /* matchMedia no disponible */
    }
    return () => mq?.removeEventListener('change', resolver);
  }, [hayEleccion]);

  // Refleja el tema en `<html data-tema>` sin esperar a la próxima navegación.
  // Con elección: fija el atributo. Sin elección: lo quita y deja mandar al CSS.
  useEffect(() => {
    try {
      if (hayEleccion) document.documentElement.dataset.tema = tema;
      else delete document.documentElement.dataset.tema;
    } catch {
      /* documento no disponible */
    }
  }, [tema, hayEleccion]);

  const fijar = useCallback((t: Tema) => {
    setTema(t);
    setHayEleccion(true);
    guardarCookieTema(t);
  }, []);

  const alternar = useCallback(() => {
    setHayEleccion(true);
    setTema((t) => {
      const siguiente: Tema = t === 'claro' ? 'oscuro' : 'claro';
      guardarCookieTema(siguiente);
      return siguiente;
    });
  }, []);

  const valor = useMemo<TemaCtx>(() => ({ tema, alternar, fijar }), [tema, alternar, fijar]);
  return <ContextoTema.Provider value={valor}>{children}</ContextoTema.Provider>;
}

export function useTema(): TemaCtx {
  const ctx = useContext(ContextoTema);
  if (!ctx) throw new Error('useTema fuera de <TemaProvider>');
  return ctx;
}

/** Elige entre dos valores según la densidad activa. */
export function porDensidad<T>(densidad: Densidad, comodo: T, compacto: T): T {
  return densidad === 'comodo' ? comodo : compacto;
}

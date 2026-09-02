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
 * D-082 · tarea 7 (fusiona D-081). El tema por defecto es CLARO, siempre, sin
 * importar `prefers-color-scheme` del sistema operativo. El modo oscuro solo se
 * activa si el usuario lo elige con el toggle de la barra superior; la elección
 * se guarda en `localStorage` (preferencia de usuario, no derivada del SO) y se
 * aplica sobre `<html data-tema>` — el mismo atributo que ya lee `globals.css`.
 * El script en línea de `app/layout.tsx` la aplica antes del primer pintado
 * para que no haya parpadeo; este provider solo la mantiene en sincronía con la
 * interfaz de React.
 */
export type Tema = 'claro' | 'oscuro';

const CLAVE_TEMA = 'contable-co:tema';

type TemaCtx = {
  tema: Tema;
  alternar: () => void;
  fijar: (t: Tema) => void;
};

const ContextoTema = createContext<TemaCtx | null>(null);

function aplicarTema(t: Tema) {
  try {
    document.documentElement.dataset.tema = t;
    window.localStorage.setItem(CLAVE_TEMA, t);
  } catch {
    /* sin persistencia: no es crítico */
  }
}

export function TemaProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>('claro');

  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CLAVE_TEMA);
      if (guardado === 'claro' || guardado === 'oscuro') {
        setTema(guardado);
        return;
      }
    } catch {
      /* localStorage no disponible */
    }
    // Sin elección previa: claro explícito, sin consultar al sistema operativo.
    setTema('claro');
  }, []);

  const fijar = useCallback((t: Tema) => {
    setTema(t);
    aplicarTema(t);
  }, []);

  const alternar = useCallback(() => {
    setTema((t) => {
      const siguiente: Tema = t === 'claro' ? 'oscuro' : 'claro';
      aplicarTema(siguiente);
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

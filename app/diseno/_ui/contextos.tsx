'use client';

/**
 * D-075 · Ola 5 — Estado global del shell del prototipo de interfaz.
 *
 * Dos cosas que TODA pantalla interna comparte y que el encargo pide «siempre
 * visibles / accesibles globalmente»:
 *
 *  · La empresa activa (`EmpresaProvider`). En producción saldría de la sesión
 *    y de un servicio; aquí es una lista fija para que el prototipo navegue.
 *  · La densidad cómodo/compacto (`DensidadProvider`). Se persiste en
 *    `localStorage` para que la elección del contador sobreviva a la recarga,
 *    igual que haría la versión final.
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

export type Empresa = {
  id: string;
  nombre: string;
  nit: string;
  /** Periodo contable abierto, para el pie de la navegación. */
  periodoAbierto: string;
};

export const EMPRESAS: readonly Empresa[] = [
  { id: 'andina', nombre: 'Distribuidora Andina S.A.S.', nit: '900.482.113-7', periodoAbierto: 'agosto 2026' },
  { id: 'tornillo', nombre: 'Ferretería El Tornillo Ltda.', nit: '830.114.902-1', periodoAbierto: 'agosto 2026' },
  { id: 'rioverde', nombre: 'Suministros Río Verde S.A.S.', nit: '901.556.740-4', periodoAbierto: 'julio 2026' },
  { id: 'llano', nombre: 'Transportes del Llano Ltda.', nit: '830.007.201-9', periodoAbierto: 'agosto 2026' },
];

type EmpresaCtx = {
  empresa: Empresa;
  empresas: readonly Empresa[];
  cambiar: (id: string) => void;
};

const ContextoEmpresa = createContext<EmpresaCtx | null>(null);

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(EMPRESAS[0]!.id);
  const empresa = useMemo(() => EMPRESAS.find((e) => e.id === id) ?? EMPRESAS[0]!, [id]);
  const cambiar = useCallback((nuevo: string) => setId(nuevo), []);
  const valor = useMemo<EmpresaCtx>(() => ({ empresa, empresas: EMPRESAS, cambiar }), [empresa, cambiar]);
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

/** Elige entre dos valores según la densidad activa. */
export function porDensidad<T>(densidad: Densidad, comodo: T, compacto: T): T {
  return densidad === 'comodo' ? comodo : compacto;
}

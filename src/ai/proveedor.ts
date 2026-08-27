/**
 * A5 — Fábrica del proveedor de LLM.
 *
 * Es el único punto del sistema que sabe que existe un proveedor real, y lo
 * carga con `import()` DINÁMICO: si no hay configuración, el módulo del
 * adaptador ni siquiera se evalúa. De ahí la garantía que A14 puede comprobar
 * leyendo el grafo de imports: la suite no tiene forma de abrir un socket.
 *
 * Sin clave NO se rompe nada. `clasificarDocumento` acepta `proveedor: null`:
 * la memoria sigue resolviendo todo lo ya conocido —que es la mayoría del
 * volumen a partir del segundo mes— y lo desconocido va a la cola de revisión
 * humana sin propuesta. Un sistema contable que se detiene porque un proveedor
 * de IA no contesta es un sistema contable roto.
 */
import type { ProveedorLlm } from './tipos';

export interface ConfiguracionLlm {
  /** 'anthropic' | 'ninguno'. Cualquier otra cosa se trata como 'ninguno'. */
  proveedor?: string | null;
  apiKey?: string | null;
  modelo?: string | null;
  urlBase?: string | null;
  tiempoLimiteMs?: number | null;
}

/**
 * Lee la configuración del entorno. No hay valores por defecto de clave, ni
 * clave embebida, ni fallback silencioso a un proveedor gratuito.
 */
export function configuracionDesdeEntorno(
  entorno: Record<string, string | undefined> = process.env,
): ConfiguracionLlm {
  return {
    proveedor: entorno.LLM_PROVEEDOR ?? 'ninguno',
    apiKey: entorno.LLM_API_KEY ?? null,
    modelo: entorno.LLM_MODELO ?? null,
    urlBase: entorno.LLM_URL_BASE ?? null,
    tiempoLimiteMs:
      entorno.LLM_TIMEOUT_MS === undefined ? null : Number.parseInt(entorno.LLM_TIMEOUT_MS, 10),
  };
}

/**
 * Devuelve el proveedor configurado, o `null` si no hay ninguno. Nunca lanza
 * por falta de configuración: la ausencia de IA es un estado válido del
 * sistema, no un error.
 */
export async function crearProveedorLlm(
  config: ConfiguracionLlm = configuracionDesdeEntorno(),
): Promise<ProveedorLlm | null> {
  if (config.proveedor !== 'anthropic') return null;
  if (config.apiKey === null || config.apiKey === undefined || config.apiKey === '') return null;

  const modulo = await import('./proveedores/anthropic');
  return modulo.crearProveedorAnthropic({
    apiKey: config.apiKey,
    modelo: config.modelo ?? undefined,
    urlBase: config.urlBase ?? undefined,
    tiempoLimiteMs: config.tiempoLimiteMs ?? undefined,
  });
}

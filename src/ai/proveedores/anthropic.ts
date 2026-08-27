/**
 * A5 — Adaptador REAL del puerto `ProveedorLlm`. Escrito, no ejecutado.
 *
 * ESTADO: este archivo no lo ejercita ninguna prueba y no se ha llamado nunca
 * contra la API. No hay clave, no se contrató nada y la suite corre sin red.
 * Se entrega escrito para que enchufar el modelo sea configuración y no
 * desarrollo, y para que quede a la vista qué se le manda exactamente al
 * proveedor. Antes de usarlo en producción hay que probarlo contra la API real
 * — A15, al desplegar.
 *
 * NINGÚN MÓDULO DE `src/ai/` LO IMPORTA DE FORMA ESTÁTICA. Se carga con
 * `import()` dinámico desde `proveedor.ts`, y solo si hay configuración. Así
 * el grafo de módulos de la suite no contiene una sola ruta de red.
 *
 * DETERMINISMO (8.4). La temperatura viaja en la petición, en milésimas, desde
 * la fila versionada del prompt: aquí no se elige, se divide. `top_p` y `top_k`
 * no se envían a propósito: fijar temperatura Y muestreo a la vez es la receta
 * documentada para respuestas incoherentes, y con temperatura mínima el
 * muestreo por defecto ya es prácticamente determinista. El determinismo que
 * el producto GARANTIZA no descansa en el modelo de todos modos: descansa en
 * la memoria y en la cola, que hacen que la segunda pasada ni siquiera
 * pregunte.
 *
 * REGLA DE ORO 4. La respuesta se parsea a dos campos: un código del catálogo
 * y un score. Todo lo demás que el modelo escriba se descarta sin leerlo. No
 * hay ninguna rama de este archivo capaz de devolver una tarifa.
 */
import type { PeticionLlm, ProveedorLlm, RespuestaLlm } from '../tipos.js';

const URL_MENSAJES = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2023-06-01';
const MILESIMAS = 1000;

export interface ConfiguracionAnthropic {
  apiKey: string;
  /** Sobrescribe el modelo de la fila del prompt. Normalmente no se usa. */
  modelo?: string;
  urlBase?: string;
  tiempoLimiteMs?: number;
}

interface RespuestaApi {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

/** Extrae `{codigo, score}` de la respuesta. Cualquier otra cosa es un fallo. */
export function interpretarRespuesta(
  texto: string,
  codigosValidos: readonly string[],
): { codigo: string | null; scoreMilesimas: number } {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) return { codigo: null, scoreMilesimas: 0 };

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return { codigo: null, scoreMilesimas: 0 };
  }

  const objeto = bruto as { codigo?: unknown; score?: unknown };
  const codigo = typeof objeto.codigo === 'string' ? objeto.codigo : null;
  const scoreCrudo =
    typeof objeto.score === 'number'
      ? objeto.score
      : typeof objeto.score === 'string'
        ? Number(objeto.score)
        : 0;
  const score = Number.isFinite(scoreCrudo)
    ? Math.max(0, Math.min(MILESIMAS, Math.round(scoreCrudo)))
    : 0;

  // Catálogo cerrado: si el código no está en la lista, no hay propuesta.
  if (codigo === null || !codigosValidos.includes(codigo)) {
    return { codigo: null, scoreMilesimas: 0 };
  }
  return { codigo, scoreMilesimas: score };
}

export function crearProveedorAnthropic(config: ConfiguracionAnthropic): ProveedorLlm {
  if (!config.apiKey) {
    throw new Error(
      'No hay clave de API para el proveedor de LLM. Sin clave el sistema sigue funcionando: ' +
        'la memoria clasifica lo conocido y lo demás va a la cola de revisión humana.',
    );
  }
  const url = `${config.urlBase ?? URL_MENSAJES}`;

  return {
    nombre: 'anthropic',
    async clasificar(peticion: PeticionLlm): Promise<RespuestaLlm> {
      // `fetch` se toma del global en tiempo de llamada, no se importa: así
      // este módulo no arrastra ninguna dependencia de red al cargarse.
      const globalConFetch = globalThis as {
        fetch?: (entrada: string, opciones: unknown) => Promise<unknown>;
      };
      const hacerPeticion = globalConFetch.fetch;
      if (typeof hacerPeticion !== 'function') {
        throw new Error('El entorno no tiene fetch: no se puede llamar al proveedor de LLM.');
      }

      const cuerpo = {
        model: config.modelo ?? peticion.modelo,
        max_tokens: peticion.maxTokensSalida,
        temperature: peticion.temperaturaMilesimas / MILESIMAS,
        system: peticion.sistema,
        messages: [{ role: 'user', content: peticion.usuario }],
      };

      const respuesta = (await hacerPeticion(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': VERSION_API,
        },
        body: JSON.stringify(cuerpo),
        signal:
          config.tiempoLimiteMs === undefined
            ? undefined
            : AbortSignal.timeout(config.tiempoLimiteMs),
      })) as { ok: boolean; status: number; json(): Promise<unknown> };

      if (!respuesta.ok) {
        throw new Error(`El proveedor de LLM respondió ${respuesta.status}.`);
      }

      const datos = (await respuesta.json()) as RespuestaApi;
      const texto = (datos.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      const interpretada = interpretarRespuesta(texto, peticion.codigosValidos);

      return {
        codigo: interpretada.codigo,
        scoreMilesimas: interpretada.scoreMilesimas,
        tokensEntrada: datos.usage?.input_tokens ?? 0,
        tokensSalida: datos.usage?.output_tokens ?? 0,
        modelo: datos.model ?? cuerpo.model,
      };
    },
  };
}

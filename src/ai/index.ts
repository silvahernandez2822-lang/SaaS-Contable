/**
 * A5 — Punto de entrada del subsistema de conceptos y caché (sección 8).
 *
 * Aquí NO se importa el adaptador real del proveedor de LLM. Se llega a él por
 * `crearProveedorLlm`, que lo carga con `import()` dinámico solo si hay
 * configuración; importar este índice no carga ni una ruta de red.
 */
export {
  VERSION_NORMALIZADOR,
  PATRON_SIN_DESCRIPCION,
  normalizarDescripcion,
  normalizacionMinima,
  patronesDeMemoria,
  patronCanonico,
} from './normalizar.js';

export { cargarParametros, umbralesUtilizables, CLAVE } from './parametros.js';
export type { AlcanceMemoria, ParametrosClasificacion } from './parametros.js';

export { cargarCatalogo, indicePorCodigo, NATURALEZAS_COMPRA } from './catalogo.js';
export type { OpcionesCatalogo } from './catalogo.js';

export { buscarEnMemoria, contarAcierto, registrarDecisionHumana } from './memoria.js';
export type { BusquedaMemoria, DecisionHumana, EntradaMemoria, ResultadoDecision } from './memoria.js';

export {
  cargarPrompt,
  construirPeticion,
  estimarTokens,
  formatearCatalogo,
  huellaPeticion,
  renderizar,
} from './prompt.js';
export type { EntradaPeticion, PromptVersionado } from './prompt.js';

export { costoMicrosUsd } from './costo.js';
export type { PreciosModelo } from './costo.js';

export {
  clasificarDocumento,
  confirmarClasificacion,
  listarColaRevision,
} from './clasificar.js';
export type {
  ConfirmacionInput,
  ItemColaRevision,
  OpcionesClasificacion,
  ResultadoConfirmacion,
} from './clasificar.js';

export { crearProveedorLlm, configuracionDesdeEntorno } from './proveedor.js';
export type { ConfiguracionLlm } from './proveedor.js';

export { ProveedorLlmFalso } from './proveedores/falso.js';
export type { OpcionesProveedorFalso } from './proveedores/falso.js';

export { MOTIVO_CLASIFICACION } from './tipos.js';
export type {
  CodigoMotivoClasificacion,
  ConceptoCatalogo,
  DecisionClasificacion,
  OrigenClasificacion,
  PeticionLlm,
  ProveedorLlm,
  RespuestaLlm,
  ResultadoClasificacion,
  ResultadoLinea,
} from './tipos.js';

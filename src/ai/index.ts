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
} from './normalizar';

export { cargarParametros, umbralesUtilizables, CLAVE } from './parametros';
export type { AlcanceMemoria, ParametrosClasificacion } from './parametros';

export { cargarCatalogo, indicePorCodigo, NATURALEZAS_COMPRA } from './catalogo';
export type { OpcionesCatalogo } from './catalogo';

export { buscarEnMemoria, contarAcierto, registrarDecisionHumana } from './memoria';
export type { BusquedaMemoria, DecisionHumana, EntradaMemoria, ResultadoDecision } from './memoria';

export {
  cargarPrompt,
  construirPeticion,
  estimarTokens,
  formatearCatalogo,
  huellaPeticion,
  renderizar,
} from './prompt';
export type { EntradaPeticion, PromptVersionado } from './prompt';

export { costoMicrosUsd } from './costo';
export type { PreciosModelo } from './costo';

export {
  clasificarDocumento,
  confirmarClasificacion,
  listarColaRevision,
} from './clasificar';
export type {
  ConfirmacionInput,
  ItemColaRevision,
  OpcionesClasificacion,
  ResultadoConfirmacion,
} from './clasificar';

export { crearProveedorLlm, configuracionDesdeEntorno } from './proveedor';
export type { ConfiguracionLlm } from './proveedor';

export { ProveedorLlmFalso } from './proveedores/falso';
export type { OpcionesProveedorFalso } from './proveedores/falso';

export { MOTIVO_CLASIFICACION } from './tipos';
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
} from './tipos';

/**
 * A6 — Punto de entrada único de los servicios de aplicación (Ola 1).
 *
 * Contrato completo, servicio por servicio, en `docs/reportes/ola1-a6.md`.
 * A7 (frontend) y A13 (integraciones) programan contra estas firmas en la
 * Ola 2.
 */
export {
  encolarCausacion,
  reclamarSiguienteJob,
  completarJob,
  fallarJob,
  reencolarJob,
  estadoJobDeDocumento,
  calcularBackoffSegundos,
} from './cola.js';
export type { DocumentProcessingJob, EstadoJob } from './cola.js';

export { recibirDocumento, proyectarLineasParaCausacion } from './ingest.js';
export type { RecibirDocumentoInput, ResultadoIngesta, DatosExtraidos, LineaExtraida } from './ingest.js';

export {
  procesarJobCausacion,
  construirPartidasCausacion,
  aprobarAsiento,
  aprobarAsientosEnLote,
  reversarAsientoPublicado,
} from './causacion.js';
export type {
  ResultadoProcesamiento,
  MotivoLocal,
  AprobarAsientoInput,
  ResultadoAprobacion,
  ItemLoteAprobacion,
  ResultadoLoteAprobacion,
  ReversarAsientoInput,
  PartidaBorrador,
} from './causacion.js';

export { consultarEstadoDocumento, listarPendientesDeAprobacion } from './consulta.js';
export type { EstadoDocumento, RetencionResumen, AsientoResumen, PartidaResumen } from './consulta.js';

export {
  listarEmpresasAccesibles,
  obtenerCorreccionesVigentes,
  guardarCorreccionAiu,
  guardarCorreccionMunicipio,
  reprocesarDocumento,
  listarPendientesRevision,
  listarMunicipiosParaCorreccion,
} from './bandeja.js';
export type {
  EmpresaAccesible,
  CorreccionesVigentes,
  GuardarCorreccionAiuInput,
  GuardarCorreccionMunicipioInput,
  MotivoRevision,
  DocumentoEnRevision,
  MunicipioOpcion,
} from './bandeja.js';

export { ejecutarCicloCola, vaciarCola } from './worker.js';
export type { ResultadoCiclo } from './worker.js';

export {
  detectarAlertasParametrizacion,
  listarTarifasPorTipo,
  listarConceptosSinTarifaVigente,
  listarHistorialTaxRule,
  simularImpactoTarifa,
  fechaMinimaVigenciaTaxRule,
  editarTarifaTaxRule,
  simularImpactoValorBase,
  editarUvtValue,
  editarSmmlvValue,
  editarRoundingRule,
  listarMunicipiosIca,
  simularImpactoMunicipioIca,
  editarMunicipioIcaRule,
  puedeEditarParametros,
  diaAnterior,
  hoyIso,
  NormaDeRespaldoRequeridaError,
  VigenciaInvalidaError,
  ParametroNoEncontradoError,
  EdicionRetroactivaError,
} from './parametrizacion.js';
export type {
  AlertaParametro,
  TipoTaxRule,
  FilaTarifa,
  ImpactoSimulado,
  EditarTarifaInput,
  ResultadoEdicion,
  EditarUvtInput,
  EditarSmmlvInput,
  EditarRoundingRuleInput,
  FilaMunicipioIca,
  EditarMunicipioIcaInput,
} from './parametrizacion.js';

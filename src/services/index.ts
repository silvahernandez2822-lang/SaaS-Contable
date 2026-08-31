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
} from './cola';
export type { DocumentProcessingJob, EstadoJob } from './cola';

export { recibirDocumento, proyectarLineasParaCausacion } from './ingest';
export type { RecibirDocumentoInput, ResultadoIngesta, DatosExtraidos, LineaExtraida } from './ingest';

export {
  procesarJobCausacion,
  construirPartidasCausacion,
  aprobarAsiento,
  aprobarAsientosEnLote,
  reversarAsientoPublicado,
} from './causacion';
export type {
  ResultadoProcesamiento,
  MotivoLocal,
  AprobarAsientoInput,
  ResultadoAprobacion,
  ItemLoteAprobacion,
  ResultadoLoteAprobacion,
  ReversarAsientoInput,
  PartidaBorrador,
} from './causacion';

export { consultarEstadoDocumento, listarPendientesDeAprobacion } from './consulta';
export type { EstadoDocumento, RetencionResumen, AsientoResumen, PartidaResumen } from './consulta';

export {
  listarEmpresasAccesibles,
  obtenerCorreccionesVigentes,
  guardarCorreccionAiu,
  guardarCorreccionMunicipio,
  reprocesarDocumento,
  listarPendientesRevision,
  listarMunicipiosParaCorreccion,
} from './bandeja';
export type {
  EmpresaAccesible,
  CorreccionesVigentes,
  GuardarCorreccionAiuInput,
  GuardarCorreccionMunicipioInput,
  MotivoRevision,
  DocumentoEnRevision,
  MunicipioOpcion,
} from './bandeja';

export { ejecutarCicloCola, vaciarCola } from './worker';
export type { ResultadoCiclo } from './worker';

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
} from './parametrizacion';
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
} from './parametrizacion';

// A10 (Ola 3): cierre de las cuentas de resultado. Asiento NUEVO de tipo
// `cierre`, publicado con `app.publicar_asiento`; nada se muta (Regla de Oro 1).
export { cerrarCuentasDeResultado, saldosACerrar, claveCierre } from './cierre';
export type { CerrarResultadosInput, CuentaCerrada, ResultadoCierre } from './cierre';

// A8 (cierre de V-17): maestro de terceros — crear/editar el tercero (no
// versionado) y sus atributos fiscales / actividad económica (versionados).
export {
  crearTercero,
  editarTercero,
  obtenerTercero,
  listarTerceros,
  puedeEditarTerceros,
  listarMunicipiosParaSelector,
  listarCiiuParaSelector,
  calcularDigitoVerificacionNit,
  registrarAtributosFiscales,
  listarHistorialAtributosFiscales,
  fechaMinimaVigenciaAtributosFiscales,
  simularImpactoAtributosFiscales,
  registrarActividad,
  listarActividadesVigentes,
  listarHistorialActividad,
  fechaMinimaVigenciaActividad,
  simularImpactoActividad,
  hoyIso as hoyIsoTerceros,
  AtributoFiscalIncompletoError,
  ContextoSinEmpresaError,
  TerceroInvalidoError,
  TerceroNoEncontradoError,
} from './terceros';
export type {
  TipoDocumentoTercero,
  DatosTercero,
  FilaTercero,
  OpcionCatalogo,
  RegimenTributario,
  FuenteAtributoFiscal,
  AtributosFiscalesInput,
  FilaAtributoFiscal,
  ImpactoTercero,
  ActividadInput,
  FilaActividad,
} from './terceros';

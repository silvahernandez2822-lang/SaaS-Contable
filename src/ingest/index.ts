/**
 * Punto de entrada del pipeline de ingest (sección 10).
 *
 * `procesarAdjuntoXml` es LA FRONTERA con A6: función pura, bytes → documento
 * normalizado o cuarentena. Lo demás (correo/, persistencia.ts) es lo que
 * este agente usa para probar el pipeline completo y lo que A6 puede
 * reutilizar si quiere, pero no es parte del contrato mínimo.
 */
export { procesarAdjuntoXml } from './procesar';
export type { OpcionesProcesarAdjunto } from './procesar';
export type {
  Adquirente,
  DocumentoNormalizado,
  Emisor,
  ImpuestoDetalle,
  LineaDocumento,
  MotivoCuarentena,
  ResultadoCuarentena,
  ResultadoProcesarAdjunto,
  TipoDocumentoCausable,
  TipoDocumentoUbl,
  TotalesDocumento,
} from './tipos';
export { TIPOS_DOCUMENTO_UBL } from './tipos';

export { sha256Hex } from './hash';

export {
  desempaquetarAttachedDocument,
  esAttachedDocument,
} from './ubl/desempaquetar';
export { extraerCufe } from './ubl/cufe';
export { extraerDocumento } from './ubl/extraer';
export { parsearXml } from './ubl/xml';
export { validarEstructuraUbl } from './ubl/validar';

export {
  manejarWebhookCorreo,
  manejarWebhookConAdaptador,
  elegirBuzonDestino,
} from './correo/webhook';
export type { ResultadoWebhook } from './correo/webhook';
export type { AdjuntoCorreo, CorreoEntrante, ProveedorCorreoEntrante } from './correo/tipos';
export { evaluarAutenticacion, autenticacionFalla } from './correo/spf-dkim';
export type { AutenticacionCorreo, ResultadoDkim, ResultadoSpf } from './correo/spf-dkim';
export {
  TAMANO_MAXIMO_ADJUNTO_BYTES,
  TAMANO_MAXIMO_CORREO_BYTES,
  LIMITE_CORREOS_POR_VENTANA,
  VENTANA_LIMITE_TASA_MINUTOS,
  excedeTamanoAdjunto,
  excedeTamanoCorreo,
  excedeLimiteTasa,
} from './correo/limites';

export {
  contarCorreosRecientes,
  guardarDocumentoProcesado,
  leerXmlDocumento,
  registrarAdjunto,
  registrarCorreo,
  resolverEmpresaPorBuzon,
} from './persistencia';
export type {
  AdaptadorArchivoFrio,
  ContextoGuardado,
  DatosAdjuntoParaRegistro,
  DatosCorreoParaRegistro,
  EmpresaResuelta,
  FilaXmlAlmacenamiento,
  ResultadoGuardado,
} from './persistencia';

/**
 * Punto de entrada del pipeline de ingest (sección 10).
 *
 * `procesarAdjuntoXml` es LA FRONTERA con A6: función pura, bytes → documento
 * normalizado o cuarentena. Lo demás (correo/, persistencia.ts) es lo que
 * este agente usa para probar el pipeline completo y lo que A6 puede
 * reutilizar si quiere, pero no es parte del contrato mínimo.
 */
export { procesarAdjuntoXml } from './procesar.js';
export type { OpcionesProcesarAdjunto } from './procesar.js';
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
} from './tipos.js';
export { TIPOS_DOCUMENTO_UBL } from './tipos.js';

export { sha256Hex } from './hash.js';

export {
  desempaquetarAttachedDocument,
  esAttachedDocument,
} from './ubl/desempaquetar.js';
export { extraerCufe } from './ubl/cufe.js';
export { extraerDocumento } from './ubl/extraer.js';
export { parsearXml } from './ubl/xml.js';
export { validarEstructuraUbl } from './ubl/validar.js';

export {
  manejarWebhookCorreo,
  manejarWebhookConAdaptador,
  elegirBuzonDestino,
} from './correo/webhook.js';
export type { ResultadoWebhook } from './correo/webhook.js';
export type { AdjuntoCorreo, CorreoEntrante, ProveedorCorreoEntrante } from './correo/tipos.js';
export { evaluarAutenticacion, autenticacionFalla } from './correo/spf-dkim.js';
export type { AutenticacionCorreo, ResultadoDkim, ResultadoSpf } from './correo/spf-dkim.js';
export {
  TAMANO_MAXIMO_ADJUNTO_BYTES,
  TAMANO_MAXIMO_CORREO_BYTES,
  LIMITE_CORREOS_POR_VENTANA,
  VENTANA_LIMITE_TASA_MINUTOS,
  excedeTamanoAdjunto,
  excedeTamanoCorreo,
  excedeLimiteTasa,
} from './correo/limites.js';

export {
  contarCorreosRecientes,
  guardarDocumentoProcesado,
  leerXmlDocumento,
  registrarAdjunto,
  registrarCorreo,
  resolverEmpresaPorBuzon,
} from './persistencia.js';
export type {
  AdaptadorArchivoFrio,
  ContextoGuardado,
  DatosAdjuntoParaRegistro,
  DatosCorreoParaRegistro,
  EmpresaResuelta,
  FilaXmlAlmacenamiento,
  ResultadoGuardado,
} from './persistencia.js';

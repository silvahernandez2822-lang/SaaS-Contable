/**
 * A13 — Punto de entrada único de la capa de integraciones (Ola 2).
 *
 * n8n orquesta y notifica; todo lo que decide y calcula sigue viviendo en
 * `src/domain` (A3) y `src/services` (A6) — este módulo nunca los rodea,
 * solo abre la sesión de sistema (V-9) y traduce HTTP <-> servicios.
 * Contrato completo en `docs/reportes/ola2-a13.md`.
 */
export {
  crearTokenIntegracion,
  revocarTokenIntegracion,
  listarTokensIntegracion,
  autenticarTokenIntegracion,
  hashTokenIntegracion,
} from './token.js';
export type {
  CanalIntegracion,
  TokenIntegracionEmitido,
  TokenIntegracionResumen,
  IdentidadIntegracion,
} from './token.js';

export {
  crearUsuarioSistemaIngesta,
  sincronizarAccesoEmpresaIngesta,
  listarEmpresasActivasDeLaFirma,
  provisionarCanalIngestaCorreo,
} from './aprovisionamiento.js';
export type { CanalIngestaProvisionado } from './aprovisionamiento.js';

export {
  abrirSesionSistema,
  cerrarSesionSistema,
  TokenIntegracionInvalidoError,
  MINUTOS_SESION_INTEGRACION,
} from './sesion-sistema.js';
export type { SesionSistema, OpcionesSesionSistema } from './sesion-sistema.js';

export { registrarLlamada, registrarLlamadaNoAutenticada } from './llamadas.js';
export type { DatosLlamada, CanalLlamada, ResultadoLlamada } from './llamadas.js';

export { procesarWebhookCorreo, ENDPOINT_INGEST_CORREO } from './ingest-correo.js';
export type {
  ResultadoWebhookCorreo,
  ResultadoAdjuntoWebhook,
  MotivoRechazoWebhook,
  OpcionesWebhookCorreo,
} from './ingest-correo.js';

export {
  listarFacturasPendientesParaNotificar,
  listarBuzonesConFallas,
  listarVencimientosProximos,
} from './notificaciones.js';
export type { FacturaPendiente, BuzonConFallas, VencimientoProximo } from './notificaciones.js';

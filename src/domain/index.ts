/**
 * A3 — Motor determinista de reglas tributarias (sección 9 del mega-prompt).
 *
 * Punto de entrada único del dominio. Ni una tarifa, ni una base mínima, ni una
 * UVT viven aquí dentro: todo se resuelve consultando las tablas paramétricas
 * de A1 por la fecha del hecho económico.
 */
export { AJUSTE, agregar, huellaDe, resolverFactura, resolverRetenciones } from './motor.js';
export type { PoliticaRegimenSimple } from './motor.js';

export { RepositorioTributarioSql } from './repositorio.js';
export type {
  CriterioReglaRetefuente,
  FilaActividadTercero,
  FilaAtributosFiscales,
  FilaConcepto,
  FilaEmpresa,
  FilaMunicipioIca,
  FilaRedondeo,
  FilaTaxRule,
  FilaTercero,
  FilaUvt,
  RepositorioTributario,
} from './repositorio.js';

export { resolverReversaNotaCredito } from './nota-credito.js';
export type { EntradaNotaCredito, ResultadoReversa } from './nota-credito.js';

export { leerRetenciones, persistirLista, persistirRetenciones } from './persistencia.js';
export type { ContextoPersistencia, FilaRetencionPersistida } from './persistencia.js';

export {
  ESCALA_TARIFA,
  ESCALA_UVT,
  MODOS_REDONDEO,
  aEntero,
  aEnteroEscalado,
  aNumeroSeguro,
  aTextoDecimal,
  calcularRetencion,
  esModoRedondeo,
  proporcion,
  redondearA,
  uvtACentavos,
} from './dinero.js';
export type { CalculoRetencion, ModoRedondeo } from './dinero.js';

export { MOTIVO } from './tipos.js';
export type {
  CodigoMotivo,
  EntradaFactura,
  EntradaResolucion,
  FechaIso,
  LineaFactura,
  MotivoRevision,
  ReglaAplicada,
  ResultadoResolucion,
  RetencionAgregada,
  RetencionResuelta,
  TipoOperacionIca,
  TipoRetencion,
} from './tipos.js';

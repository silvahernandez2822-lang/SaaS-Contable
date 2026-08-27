/**
 * A3 — Motor determinista de reglas tributarias (sección 9 del mega-prompt).
 *
 * Punto de entrada único del dominio. Ni una tarifa, ni una base mínima, ni una
 * UVT viven aquí dentro: todo se resuelve consultando las tablas paramétricas
 * de A1 por la fecha del hecho económico.
 */
export { AJUSTE, agregar, huellaDe, resolverFactura, resolverRetenciones } from './motor';
export type { PoliticaRegimenSimple } from './motor';

export { RepositorioTributarioSql } from './repositorio';
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
} from './repositorio';

export { resolverReversaNotaCredito } from './nota-credito';
export type { EntradaNotaCredito, ResultadoReversa } from './nota-credito';

export { leerRetenciones, persistirLista, persistirRetenciones } from './persistencia';
export type { ContextoPersistencia, FilaRetencionPersistida } from './persistencia';

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
} from './dinero';
export type { CalculoRetencion, ModoRedondeo } from './dinero';

export { MOTIVO } from './tipos';
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
} from './tipos';

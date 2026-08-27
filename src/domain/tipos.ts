/**
 * A3 — Contratos del motor de reglas tributarias (sección 9.1).
 *
 * Aquí no hay ni un valor tributario: solo la forma de la pregunta y la forma
 * de la respuesta. Las tarifas, bases mínimas, UVT y reglas de redondeo viven
 * en las tablas paramétricas que puebla A1, y se resuelven SIEMPRE por la
 * fecha del hecho económico (Reglas de Oro 2 y 3).
 */

/** Tipos de retención que el motor sabe resolver. Espeja el CHECK de `tax_rule.tipo`. */
export type TipoRetencion =
  | 'retefuente'
  | 'reteiva'
  | 'reteica'
  | 'autorretencion'
  | 'retefuente_salarios';

/** Naturaleza de la operación para efectos de la base mínima municipal de ICA. */
export type TipoOperacionIca = 'servicios' | 'compras';

/** Fecha en formato ISO corto `YYYY-MM-DD`. El motor nunca usa `Date`. */
export type FechaIso = string;

/**
 * Entrada de `resolverRetenciones`, con los siete parámetros exactos que exige
 * la sección 9.1. Los dos campos opcionales del final no son parámetros nuevos
 * del contrato: son datos del documento que la sección 9.3 vuelve necesarios
 * (el AIU declarado y la naturaleza de la operación para ICA). Cuando faltan y
 * hacen falta, el motor manda el documento a revisión manual en vez de
 * suponerlos.
 */
export interface EntradaResolucion {
  companyId: string;
  terceroId: string;
  conceptoId: string;
  municipioOperacionId: string | null;
  /** Base gravable en centavos de COP (Regla de Oro 5: entero, nunca float). */
  baseGravable: number;
  /** Valor del IVA de la factura, en centavos. ReteIVA va sobre esto. */
  valorIva: number;
  fechaHechoEconomico: FechaIso;
  /** AIU declarado en el documento, en centavos. Solo para conceptos AIU. */
  valorAiu?: number | null;
  /** Sobreescribe la naturaleza de operación del concepto, si el documento la trae. */
  tipoOperacionIca?: TipoOperacionIca | null;
}

/** Una línea de factura, para el caso de varias líneas con conceptos distintos. */
export interface LineaFactura {
  conceptoId: string;
  baseGravable: number;
  valorIva: number;
  valorAiu?: number | null;
  tipoOperacionIca?: TipoOperacionIca | null;
  /** Municipio de ESTA línea, si difiere del de la factura. */
  municipioOperacionId?: string | null;
}

export interface EntradaFactura {
  companyId: string;
  terceroId: string;
  municipioOperacionId: string | null;
  fechaHechoEconomico: FechaIso;
  lineas: readonly LineaFactura[];
}

/** Identificación de la regla paramétrica aplicada Y de su vigencia (Regla 6). */
export interface ReglaAplicada {
  taxRuleId: string;
  vigenteDesde: FechaIso;
  vigenteHasta: FechaIso | null;
}

/**
 * Una retención EVALUADA. Se devuelve tanto si aplicó como si no: la sección
 * 9.3 exige registrar la evaluación y el motivo cuando la base queda por
 * debajo del mínimo.
 *
 * Los siete campos obligatorios de la sección 9.1 son `tipo`, `base`,
 * `tarifa`, `regla` (identificador + vigencia), `valor`, `accountId` y
 * `normaRespaldo`. El resto es contexto de traza, para poder reproducir el
 * cálculo idéntico dentro de seis meses.
 */
export interface RetencionResuelta {
  tipo: TipoRetencion;
  /** Base sobre la que se calculó, en centavos. Para AIU es el AIU, no el total. */
  base: number;
  /** Tarifa aplicada como fracción decimal canónica, tal como está en la tabla. */
  tarifa: string;
  regla: ReglaAplicada;
  /** Valor calculado y redondeado según la regla de redondeo configurada. */
  valor: number;
  /** Cuenta PUC afectada. */
  accountId: string;
  /** Norma de respaldo en texto, para mostrarle al contador (Regla de Oro 6). */
  normaRespaldo: string;

  // --- contexto de traza ---
  aplicada: boolean;
  motivoNoAplica: string | null;
  /** Valor antes de aplicar el redondeo, truncado a centavos. */
  valorSinRedondeo: number;
  conceptoCausacionId: string;
  terceroId: string;
  municipalityId: string | null;
  ciiuActivityId: string | null;
  roundingRuleId: string | null;
  /** UVT usada para convertir la base mínima a pesos, en centavos. */
  uvtValorUsado: number | null;
  baseMinimaUvtUsada: string | null;
  baseMinimaValorUsada: number | null;
  fechaHechoEconomico: FechaIso;
  /** Nota adicional de la resolución (desempate de actividad, override, AIU...). */
  nota: string | null;
}

/** Un motivo por el que el documento no se puede causar automáticamente. */
export interface MotivoRevision {
  codigo: string;
  detalle: string;
}

/** Suma por (tipo, regla, cuenta) lista para convertirse en partidas del asiento. */
export interface RetencionAgregada {
  tipo: TipoRetencion;
  accountId: string;
  regla: ReglaAplicada;
  base: number;
  valor: number;
  tarifa: string;
  normaRespaldo: string;
}

export interface ResultadoResolucion {
  /** Todas las evaluaciones, aplicaran o no. Una fila de `retention_applied` cada una. */
  retenciones: readonly RetencionResuelta[];
  /** Las aplicadas, sumadas por tipo + regla + cuenta. Insumo del asiento. */
  agregados: readonly RetencionAgregada[];
  requiereRevisionManual: boolean;
  motivosRevision: readonly MotivoRevision[];
  /**
   * Huella determinista del resultado (sección 8.4 y caso dorado 18). Dos
   * resoluciones de la misma factura con los mismos parámetros vigentes
   * producen la misma huella; cualquier diferencia la cambia.
   */
  huella: string;
}

/** Códigos de motivo de revisión manual. Son identificadores, no valores. */
export const MOTIVO = {
  TERCERO_SIN_ATRIBUTOS: 'tercero_sin_atributos_a_la_fecha',
  CONCEPTO_INEXISTENTE: 'concepto_de_causacion_inexistente',
  EMPRESA_INEXISTENTE: 'empresa_inexistente',
  SIN_UVT: 'sin_uvt_vigente_a_la_fecha',
  SIN_REGLA: 'sin_regla_vigente_a_la_fecha',
  REGLA_SIN_CUENTA: 'regla_sin_cuenta_puc_asignada',
  REGLA_AMBIGUA: 'mas_de_una_regla_igual_de_especifica',
  SIN_REDONDEO: 'sin_regla_de_redondeo_vigente',
  SIN_AIU: 'concepto_aiu_sin_aiu_declarado',
  AIU_BAJO_MINIMO: 'aiu_por_debajo_del_minimo_parametrizado',
  SIN_MUNICIPIO: 'operacion_sin_municipio',
  SIN_REGLA_MUNICIPAL: 'municipio_sin_parametros_de_reteica',
  SIN_ACTIVIDAD: 'tercero_sin_actividad_en_el_municipio',
  DESEMPATE_IMPOSIBLE: 'varias_actividades_sin_desempate_posible',
  SIMPLE_SIN_POLITICA: 'regimen_simple_sin_politica_parametrizada',
  EXTERIOR_SIN_CONCEPTO: 'proveedor_del_exterior_sin_concepto_de_reteiva',
  ICA_SIN_NATURALEZA: 'no_se_sabe_si_la_operacion_es_servicio_o_compra',
  TARIFA_INCONSISTENTE: 'tarifa_general_del_municipio_distinta_de_la_regla',
  BASE_NEGATIVA: 'base_gravable_negativa',
} as const;

export type CodigoMotivo = (typeof MOTIVO)[keyof typeof MOTIVO];

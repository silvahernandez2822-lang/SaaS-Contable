/**
 * A5 — Contratos del subsistema de clasificación (sección 8).
 *
 * REGLA DE ORO 4, escrita en el sistema de tipos: mire la forma de
 * `RespuestaLlm`. Tiene un código de concepto y un score. No tiene tarifa, ni
 * base, ni valor de retención, ni cuenta contable, ni fecha de vigencia. Un
 * proveedor de LLM no puede devolver un cálculo por este puerto ni aunque
 * quiera: el tipo no tiene dónde ponerlo. Lo que se retiene lo decide después
 * el motor determinista de A3 con las reglas paramétricas del concepto.
 *
 * El catálogo es CERRADO (8.4): `codigosValidos` viaja con la petición y la
 * respuesta se descarta si no está ahí. El modelo elige de una lista, no
 * escribe texto libre.
 */

/** Un concepto tal como se le presenta al modelo. Sin tarifas, sin cuentas. */
export interface ConceptoCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
}

/** Lo que el puerto entrega al proveedor. Todo lo necesario, nada más. */
export interface PeticionLlm {
  /** Identificación exacta y reproducible del prompt (sección 8.4). */
  promptCodigo: string;
  promptVersion: number;
  promptHash: string;
  modelo: string;
  /** Temperatura en milésimas. 0 es el mínimo y es lo que se usa. */
  temperaturaMilesimas: number;
  maxTokensSalida: number;
  /** Mensajes ya renderizados a partir de la plantilla versionada. */
  sistema: string;
  usuario: string;
  /** Catálogo cerrado. Una respuesta fuera de esta lista se descarta. */
  codigosValidos: readonly string[];
  /** Los mismos datos, estructurados, para adaptadores con salida tipada. */
  contexto: {
    descripcion: string;
    proveedor: string | null;
    catalogo: readonly ConceptoCatalogo[];
  };
}

/**
 * Lo que el proveedor devuelve. `codigo` es un código del catálogo o `null`
 * («ninguno corresponde»); `scoreMilesimas` es un entero de 0 a 1000.
 */
export interface RespuestaLlm {
  codigo: string | null;
  scoreMilesimas: number;
  tokensEntrada: number;
  tokensSalida: number;
  modelo: string;
}

/**
 * EL PUERTO. La implementación falsa determinista vive en
 * `proveedores/falso.ts` y es la que usan las pruebas; el adaptador real vive
 * también en `proveedores/` y solo se carga —con `import()` dinámico, desde
 * `proveedor.ts`— si hay configuración. Ningún módulo de este paquete lo
 * importa de forma estática, así que la suite no puede abrir un socket ni por
 * accidente.
 */
export interface ProveedorLlm {
  readonly nombre: string;
  clasificar(peticion: PeticionLlm): Promise<RespuestaLlm>;
}

/** De dónde salió la clasificación de una línea. */
export type OrigenClasificacion =
  /** La memoria acertó: cero llamadas, cero tokens (sección 8.3, paso 2). */
  | 'memoria'
  /** Otra factura con el mismo patrón ya está en la cola: se reusa su propuesta. */
  | 'cola'
  /** Hubo que preguntarle al modelo (paso 3). */
  | 'llm'
  /** Ya se había clasificado este documento: reproceso idempotente (8.4). */
  | 'reproceso'
  /** No se pudo proponer nada y la línea quedó en revisión sin propuesta. */
  | 'sin_propuesta';

/** Qué hacer con la línea. */
export type DecisionClasificacion =
  /** Score por encima del umbral de auto-aprobación, o memoria vigente. */
  | 'aplicar'
  /** Propuesta precargada en la bandeja; exige confirmación humana explícita. */
  | 'proponer'
  /** Cola de revisión manual SIN propuesta (paso 5). */
  | 'revisar';

export interface ResultadoLinea {
  numero: number;
  descripcion: string | null;
  patron: string;
  conceptoId: string | null;
  conceptoCodigo: string | null;
  scoreMilesimas: number | null;
  origen: OrigenClasificacion;
  decision: DecisionClasificacion;
  memoriaId: string | null;
  pendienteId: string | null;
  extractionId: string | null;
  /** Llamadas al modelo que costó ESTA línea. Cero si acertó la memoria. */
  llamadasLlm: number;
  costoMicrosUsd: number;
  motivo: string | null;
}

export interface ResultadoClasificacion {
  sourceDocumentId: string;
  lineas: ResultadoLinea[];
  /** Total de llamadas al modelo del documento. El caso dorado 19 exige 0. */
  llamadasLlm: number;
  /** Costo total en millonésimas de USD (Regla de Oro 5: entero). */
  costoMicrosUsd: number;
  promptCodigo: string | null;
  promptVersion: number | null;
  /** Motivos por los que algo no se pudo clasificar. Nunca se suponen datos. */
  motivos: string[];
}

/** Códigos de motivo. Son identificadores, no mensajes. */
export const MOTIVO_CLASIFICACION = {
  DOCUMENTO_INEXISTENTE: 'documento_inexistente',
  SIN_TERCERO: 'documento_sin_tercero_vinculado',
  SIN_EXTRACCION: 'documento_sin_extraccion_del_parser',
  SIN_LINEAS: 'extraccion_sin_lineas',
  SIN_CATALOGO: 'empresa_sin_conceptos_de_causacion_activos',
  SIN_PROVEEDOR: 'sin_proveedor_de_llm_configurado',
  SIN_PROMPT: 'sin_prompt_versionado_para_el_codigo_y_version_configurados',
  SIN_UMBRALES: 'sin_umbrales_de_confianza_parametrizados',
  SCORE_BAJO: 'score_por_debajo_del_umbral_de_propuesta',
  FUERA_DE_CATALOGO: 'el_modelo_propuso_un_codigo_que_no_esta_en_el_catalogo',
  TECHO_DE_COSTO: 'techo_de_costo_por_documento_alcanzado',
  MEMORIA_VENCIDA: 'entrada_de_memoria_vencida_pendiente_de_revalidacion',
  PROVEEDOR_FALLO: 'el_proveedor_de_llm_fallo',
} as const;

export type CodigoMotivoClasificacion =
  (typeof MOTIVO_CLASIFICACION)[keyof typeof MOTIVO_CLASIFICACION];

/**
 * Tipos del pipeline de ingest (sección 10).
 *
 * La FRONTERA con A6 es `procesarAdjuntoXml` (ver `procesar.ts`): una función
 * PURA, sin I/O, que recibe los bytes crudos de un adjunto y devuelve un
 * `DocumentoNormalizado` o un `ResultadoCuarentena`. A6 la conecta desde su
 * cola sin acoplarse a cómo llegó el correo.
 *
 * Regla de Oro 4: la IA nunca calcula. Nada aquí calcula una retención ni
 * resuelve una vigencia — eso es del motor de A3. Este módulo solo EXTRAE lo
 * que el XML ya dice.
 */

/** Los cinco tipos de documento UBL de la sección 10.2. */
export const TIPOS_DOCUMENTO_UBL = [
  'Invoice',
  'CreditNote',
  'DebitNote',
  'ApplicationResponse',
  'AttachedDocument',
] as const;

export type TipoDocumentoUbl = (typeof TIPOS_DOCUMENTO_UBL)[number];

/** Documento realmente causable: todo excepto el contenedor y los eventos. */
export type TipoDocumentoCausable = 'Invoice' | 'CreditNote' | 'DebitNote';

export interface Emisor {
  nit: string;
  nombre: string | null;
}

export interface Adquirente {
  nit: string | null;
  nombre: string | null;
}

/** Un impuesto discriminado (a nivel de línea o de documento). */
export interface ImpuestoDetalle {
  /** Código UBL de esquema de impuesto (p. ej. "01" IVA, "04" INC, "03" ICA, "06" ReteIVA...). */
  codigo: string | null;
  /** Nombre tal como aparece en el XML (p. ej. "IVA"). Informativo, no se usa para calcular. */
  nombre: string | null;
  /** Tarifa como fracción (2.5% -> viene del XML como "2.5", aquí queda tal cual, sin dividir). */
  porcentaje: number | null;
  /** Base gravable, en centavos. */
  base: bigint | null;
  /** Valor del impuesto, en centavos. */
  valor: bigint;
}

export interface LineaDocumento {
  numero: number;
  descripcion: string | null;
  cantidad: number | null;
  unidadMedida: string | null;
  /** Precio unitario, en centavos. */
  precioUnitario: bigint | null;
  /** Subtotal de la línea antes de impuestos, en centavos. */
  subtotal: bigint | null;
  impuestos: ImpuestoDetalle[];
}

export interface TotalesDocumento {
  /** Suma de líneas antes de descuentos e impuestos. */
  bruto: bigint | null;
  descuentos: bigint | null;
  ivaTotal: bigint | null;
  /** Total a pagar (PayableAmount). */
  neto: bigint | null;
}

/**
 * El documento ya desempaquetado (si venía dentro de un AttachedDocument) y
 * extraído. Es lo que `extraction.datos_extraidos` guarda y lo que alimenta
 * `source_document` — el motor de A3 nunca lee el XML directamente.
 */
export interface DocumentoNormalizado {
  tipoDocumento: TipoDocumentoUbl;
  /** true si el XML raíz recibido era un AttachedDocument y este documento venía embebido. */
  veniaEnAttachedDocument: boolean;
  cufe: string | null;
  prefijo: string | null;
  numeroDocumento: string;
  emisor: Emisor;
  adquirente: Adquirente;
  /** Fecha del hecho económico (Regla de Oro 3): fecha de emisión del documento. */
  fechaHechoEconomico: string; // YYYY-MM-DD
  fechaEmision: string | null;
  moneda: string;
  tasaCambio: number | null;
  totales: TotalesDocumento;
  lineas: LineaDocumento[];
  /** Impuestos a nivel de documento (TaxTotal/TaxSubtotal), no de línea. */
  impuestosDocumento: ImpuestoDetalle[];
  /**
   * Para CreditNote/DebitNote: CUFE y/o número del documento referenciado
   * (BillingReference). No resuelve la referencia contra la base — eso es de
   * quien persista (buscar el source_document con ese CUFE).
   */
  documentoReferenciado: { cufe: string | null; numero: string | null } | null;
  /** El XML del documento causable, YA desempaquetado (sin el sobre de AttachedDocument). */
  xmlCrudo: string;
  /** sha256 hex de los bytes EXACTOS recibidos (el archivo completo, antes de desempaquetar). */
  hashContenido: string;
  nombreArchivo: string | null;
}

/** Por qué un adjunto se va a cuarentena, en vez de causar. */
export type MotivoCuarentena =
  | 'xml_mal_formado'
  | 'no_es_ubl_reconocible'
  | 'tipo_documento_no_soportado'
  | 'estructura_ubl_invalida'
  | 'contenedor_sin_documento_interno'
  | 'base64_invalido'
  | 'cufe_faltante'
  | 'tamano_excedido'
  | 'adjunto_vacio';

export interface ResultadoCuarentena {
  motivo: MotivoCuarentena;
  detalle: string;
  /** Errores de validación estructural, si los hay (uno o varios). */
  erroresValidacion?: string[];
}

export type ResultadoProcesarAdjunto =
  | { ok: true; documento: DocumentoNormalizado }
  | { ok: false; cuarentena: ResultadoCuarentena };

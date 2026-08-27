/**
 * Extracción de campos (sección 10.2): emisor, adquirente, líneas de detalle,
 * impuestos discriminados y totales. La IA no participa aquí (Regla de Oro
 * 4): todo sale literalmente del XML, sin inferencia.
 */
import { atributo, hijo, hijos, texto, textoHijo, type NodoXml } from './xml';
import { parseEntero, parseMontoACentavos, parsePorcentaje } from './dinero';
import { extraerCufe } from './cufe';
import type {
  Adquirente,
  DocumentoNormalizado,
  Emisor,
  ImpuestoDetalle,
  LineaDocumento,
  TipoDocumentoUbl,
  TotalesDocumento,
} from '../tipos';

const NOMBRE_LINEA: Partial<Record<TipoDocumentoUbl, string>> = {
  Invoice: 'InvoiceLine',
  CreditNote: 'CreditNoteLine',
  DebitNote: 'DebitNoteLine',
};

/**
 * Los tres documentos causables anidan la parte bajo `cac:Party`
 * (`AccountingSupplierParty/cac:Party/...`). `ApplicationResponse` usa
 * `cac:SenderParty`/`cac:ReceiverParty` que, según el proveedor, a veces SÍ
 * anidan `cac:Party` y a veces son ellos mismos el nodo de la parte. Por eso
 * se prueba primero el anidado y, si no existe, se trata el propio nodo como
 * la parte.
 */
function extraerParte(nodoParte: NodoXml | undefined): { nit: string | null; nombre: string | null } {
  if (!nodoParte) return { nit: null, nombre: null };
  const party = hijo(nodoParte, 'Party') ?? nodoParte;

  const nit =
    textoHijo(hijo(party, 'PartyTaxScheme'), 'CompanyID') ??
    textoHijo(hijo(party, 'PartyIdentification'), 'ID');

  const nombre =
    textoHijo(hijo(party, 'PartyLegalEntity'), 'RegistrationName') ??
    textoHijo(hijo(party, 'PartyName'), 'Name');

  return { nit, nombre };
}

export function extraerEmisor(raiz: NodoXml): Emisor {
  const p = extraerParte(hijo(raiz, 'AccountingSupplierParty'));
  return { nit: p.nit ?? '', nombre: p.nombre };
}

export function extraerAdquirente(raiz: NodoXml): Adquirente {
  const p = extraerParte(hijo(raiz, 'AccountingCustomerParty'));
  return { nit: p.nit, nombre: p.nombre };
}

function extraerImpuestoDeSubtotal(subtotal: NodoXml): ImpuestoDetalle {
  const categoria = hijo(subtotal, 'TaxCategory');
  const esquema = categoria ? hijo(categoria, 'TaxScheme') : undefined;
  return {
    codigo: esquema ? textoHijo(esquema, 'ID') : null,
    nombre: esquema ? textoHijo(esquema, 'Name') : null,
    porcentaje: categoria ? parsePorcentaje(textoHijo(categoria, 'Percent')) : null,
    base: parseMontoACentavos(textoHijo(subtotal, 'TaxableAmount')),
    valor: parseMontoACentavos(textoHijo(subtotal, 'TaxAmount')) ?? 0n,
  };
}

/** TaxTotal puede repetirse (uno por tipo de impuesto) y cada uno trae uno o más TaxSubtotal. */
function extraerImpuestos(nodo: NodoXml): ImpuestoDetalle[] {
  const impuestos: ImpuestoDetalle[] = [];
  for (const taxTotal of hijos(nodo, 'TaxTotal')) {
    const subtotales = hijos(taxTotal, 'TaxSubtotal');
    if (subtotales.length === 0) {
      // TaxTotal sin desglose: se registra igual con el total, sin categoría.
      const valor = parseMontoACentavos(textoHijo(taxTotal, 'TaxAmount'));
      if (valor !== null) {
        impuestos.push({ codigo: null, nombre: null, porcentaje: null, base: null, valor });
      }
      continue;
    }
    for (const subtotal of subtotales) {
      impuestos.push(extraerImpuestoDeSubtotal(subtotal));
    }
  }
  return impuestos;
}

function extraerLinea(nodoLinea: NodoXml, numero: number): LineaDocumento {
  const item = hijo(nodoLinea, 'Item');
  const precio = hijo(nodoLinea, 'Price');

  // La cantidad puede venir en InvoicedQuantity (Invoice) o CreditedQuantity /
  // DebitedQuantity según el tipo de documento.
  const nodoCantidad =
    hijo(nodoLinea, 'InvoicedQuantity') ??
    hijo(nodoLinea, 'CreditedQuantity') ??
    hijo(nodoLinea, 'DebitedQuantity');

  return {
    numero,
    descripcion: item ? textoHijo(item, 'Description') : null,
    cantidad: parseEntero(texto(nodoCantidad)),
    unidadMedida: nodoCantidad ? (nodoCantidad['@_unitCode'] as string | undefined) ?? null : null,
    precioUnitario: precio ? parseMontoACentavos(textoHijo(precio, 'PriceAmount')) : null,
    subtotal: parseMontoACentavos(textoHijo(nodoLinea, 'LineExtensionAmount')),
    impuestos: extraerImpuestos(nodoLinea),
  };
}

export function extraerLineas(raiz: NodoXml, tipo: TipoDocumentoUbl): LineaDocumento[] {
  const nombreLinea = NOMBRE_LINEA[tipo];
  if (!nombreLinea) return [];
  return hijos(raiz, nombreLinea).map((linea, i) => extraerLinea(linea, i + 1));
}

export function extraerImpuestosDocumento(raiz: NodoXml): ImpuestoDetalle[] {
  return extraerImpuestos(raiz);
}

export function extraerTotales(raiz: NodoXml): TotalesDocumento {
  const totales = hijo(raiz, 'LegalMonetaryTotal');
  if (!totales) {
    return { bruto: null, descuentos: null, ivaTotal: null, neto: null };
  }
  const impuestosDoc = extraerImpuestosDocumento(raiz);
  const ivaTotal = impuestosDoc
    .filter((i) => (i.codigo ?? '').trim() === '01' || (i.nombre ?? '').toUpperCase() === 'IVA')
    .reduce<bigint | null>((acc, i) => (acc ?? 0n) + i.valor, null);

  return {
    bruto: parseMontoACentavos(textoHijo(totales, 'LineExtensionAmount')),
    descuentos: parseMontoACentavos(textoHijo(totales, 'AllowanceTotalAmount')),
    ivaTotal,
    neto: parseMontoACentavos(textoHijo(totales, 'PayableAmount')),
  };
}

export function extraerNumeroDocumento(raiz: NodoXml): { prefijo: string | null; numero: string } {
  const id = textoHijo(raiz, 'ID') ?? '';
  // Convención DIAN: prefijo alfabético seguido del consecutivo, p. ej. "SETP990000001".
  const m = /^([A-Za-z]+)(\d+)$/.exec(id);
  if (m) {
    return { prefijo: m[1] ?? null, numero: id };
  }
  return { prefijo: null, numero: id };
}

export function extraerDocumentoReferenciado(
  raiz: NodoXml,
): { cufe: string | null; numero: string | null } | null {
  const billingRef = hijo(raiz, 'BillingReference');
  if (!billingRef) return null;
  const docRef = hijo(billingRef, 'InvoiceDocumentReference') ?? hijo(billingRef, 'BillingReferenceLine');
  if (!docRef) return null;
  const numero = textoHijo(docRef, 'ID');
  const cufe = textoHijo(docRef, 'UUID');
  if (numero === null && cufe === null) return null;
  return { numero, cufe };
}

export { extraerCufe };

// -----------------------------------------------------------------------------
// Composición: de la raíz YA desempaquetada al documento normalizado completo.
// -----------------------------------------------------------------------------

/** Elemento que envuelve al emisor, según el tipo de documento. */
const ELEMENTO_EMISOR: Partial<Record<TipoDocumentoUbl, string>> = {
  Invoice: 'AccountingSupplierParty',
  CreditNote: 'AccountingSupplierParty',
  DebitNote: 'AccountingSupplierParty',
  ApplicationResponse: 'SenderParty',
};

/** Elemento que envuelve al adquirente, según el tipo de documento. */
const ELEMENTO_ADQUIRENTE: Partial<Record<TipoDocumentoUbl, string>> = {
  Invoice: 'AccountingCustomerParty',
  CreditNote: 'AccountingCustomerParty',
  DebitNote: 'AccountingCustomerParty',
  ApplicationResponse: 'ReceiverParty',
};

function extraerMoneda(raiz: NodoXml): string {
  const totales = hijo(raiz, 'LegalMonetaryTotal');
  const monto = totales ? hijo(totales, 'PayableAmount') : undefined;
  return atributo(monto, 'currencyID') ?? 'COP';
}

/**
 * `ApplicationResponse` referencia el documento que acusa/responde en
 * `cac:DocumentResponse/cac:DocumentReference` (ID y, cuando el proveedor lo
 * incluye, el CUFE en `cbc:UUID`). Es la contraparte de `BillingReference`
 * para los eventos, en vez de para las notas.
 */
function extraerDocumentoReferenciadoApplicationResponse(
  raiz: NodoXml,
): { cufe: string | null; numero: string | null } | null {
  const documentResponse = hijo(raiz, 'DocumentResponse');
  if (!documentResponse) return null;
  const docRef = hijo(documentResponse, 'DocumentReference');
  if (!docRef) return null;
  const numero = textoHijo(docRef, 'ID');
  const cufe = textoHijo(docRef, 'UUID');
  if (numero === null && cufe === null) return null;
  return { numero, cufe };
}

/**
 * Extrae TODO lo que `extraction.datos_extraidos` necesita a partir de la raíz
 * de un documento UBL ya desempaquetado (si venía en un `AttachedDocument`,
 * aquí ya se recibe el `Invoice`/`CreditNote`/`DebitNote`/`ApplicationResponse`
 * interno, no el contenedor). No decide cuarentena ni valida: eso es de
 * `validar.ts` y de la orquestación en `procesar.ts`.
 */
export function extraerDocumento(
  tipo: TipoDocumentoUbl,
  raiz: NodoXml,
): Omit<DocumentoNormalizado, 'veniaEnAttachedDocument' | 'xmlCrudo' | 'hashContenido' | 'nombreArchivo'> {
  const { prefijo, numero } = extraerNumeroDocumento(raiz);
  const fechaEmision = textoHijo(raiz, 'IssueDate');
  const { cufe } = extraerCufe(raiz);

  const elementoEmisor = ELEMENTO_EMISOR[tipo];
  const elementoAdquirente = ELEMENTO_ADQUIRENTE[tipo];
  const emisor = extraerParte(elementoEmisor ? hijo(raiz, elementoEmisor) : undefined);
  const adquirente = extraerParte(elementoAdquirente ? hijo(raiz, elementoAdquirente) : undefined);

  const documentoReferenciado =
    tipo === 'ApplicationResponse'
      ? extraerDocumentoReferenciadoApplicationResponse(raiz)
      : extraerDocumentoReferenciado(raiz);

  return {
    tipoDocumento: tipo,
    cufe,
    prefijo,
    numeroDocumento: numero,
    emisor: { nit: emisor.nit ?? '', nombre: emisor.nombre },
    adquirente: { nit: adquirente.nit, nombre: adquirente.nombre },
    // Regla de Oro 3: la fecha del hecho económico es la de emisión del
    // documento, nunca la de procesamiento (que decide quien persiste, no el
    // parser: el parser ni siquiera conoce la hora en que corre).
    fechaHechoEconomico: fechaEmision ?? '',
    fechaEmision,
    moneda: extraerMoneda(raiz),
    tasaCambio: null,
    totales: extraerTotales(raiz),
    lineas: extraerLineas(raiz, tipo),
    impuestosDocumento: extraerImpuestosDocumento(raiz),
    documentoReferenciado,
  };
}

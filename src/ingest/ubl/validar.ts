/**
 * Validación ESTRUCTURAL contra el anexo técnico UBL 2.1 versión 1.9.
 *
 * IMPORTANTE — límite honesto: esto NO es una validación XSD completa. No
 * tenemos el XSD oficial del anexo técnico 1.9 en el repositorio (no se
 * inventa un esquema; usar uno incorrecto sería peor que no validar, mismo
 * criterio de la sección 17). Lo que se verifica es la presencia y forma
 * mínima de los elementos que la sección 10.2 exige extraer: identificación
 * del documento, emisor, adquirente, al menos una línea, totales y CUFE.
 * Cuando haya un XSD real disponible, `validarEstructuraUbl` es el único
 * punto que hay que reforzar — el resto del pipeline no cambia.
 */
import { hijo, hijos, textoHijo, type NodoXml } from './xml.js';
import type { TipoDocumentoUbl } from '../tipos.js';

export interface ResultadoValidacion {
  valido: boolean;
  errores: string[];
}

const NOMBRE_LINEA: Partial<Record<TipoDocumentoUbl, string>> = {
  Invoice: 'InvoiceLine',
  CreditNote: 'CreditNoteLine',
  DebitNote: 'DebitNoteLine',
};

function requerirTexto(raiz: NodoXml, nombreLocal: string, errores: string[]): void {
  const valor = textoHijo(raiz, nombreLocal);
  if (valor === null || valor.trim() === '') {
    errores.push(`falta ${nombreLocal}`);
  }
}

function requerirNodo(raiz: NodoXml, nombreLocal: string, errores: string[]): NodoXml | undefined {
  const nodo = hijo(raiz, nombreLocal);
  if (nodo === undefined) {
    errores.push(`falta ${nombreLocal}`);
  }
  return nodo;
}

function validarParte(raiz: NodoXml, elementoParte: string, errores: string[]): void {
  const parte = requerirNodo(raiz, elementoParte, errores);
  if (!parte) return;
  const party = hijo(parte, 'Party');
  if (!party) {
    errores.push(`${elementoParte} no trae cac:Party`);
    return;
  }
  const tieneNit =
    textoHijo(hijo(party, 'PartyTaxScheme'), 'CompanyID') !== null ||
    textoHijo(hijo(party, 'PartyIdentification'), 'ID') !== null;
  if (!tieneNit) {
    errores.push(`${elementoParte} no trae identificación (NIT) del tercero`);
  }
}

function validarDocumentoCausable(raiz: NodoXml, tipo: TipoDocumentoUbl, errores: string[]): void {
  requerirTexto(raiz, 'ID', errores);
  requerirTexto(raiz, 'IssueDate', errores);

  validarParte(raiz, 'AccountingSupplierParty', errores);
  validarParte(raiz, 'AccountingCustomerParty', errores);

  const nombreLinea = NOMBRE_LINEA[tipo];
  if (nombreLinea) {
    const lineas = hijos(raiz, nombreLinea);
    if (lineas.length === 0) {
      errores.push(`no hay ninguna ${nombreLinea}: un documento sin líneas no se puede causar`);
    }
  }

  const totales = requerirNodo(raiz, 'LegalMonetaryTotal', errores);
  if (totales) {
    requerirTexto(totales, 'PayableAmount', errores);
  }
}

function validarApplicationResponse(raiz: NodoXml, errores: string[]): void {
  requerirTexto(raiz, 'ID', errores);
  requerirTexto(raiz, 'IssueDate', errores);
  // DocumentResponse es donde vive la referencia al documento que se acusa/responde.
  requerirNodo(raiz, 'DocumentResponse', errores);
}

/**
 * Valida la raíz de un documento UBL YA desempaquetado (si venía dentro de un
 * AttachedDocument, esta función recibe el `Invoice`/`CreditNote`/... interno,
 * no el contenedor).
 */
export function validarEstructuraUbl(
  tipo: TipoDocumentoUbl,
  raiz: NodoXml,
): ResultadoValidacion {
  const errores: string[] = [];

  switch (tipo) {
    case 'Invoice':
    case 'CreditNote':
    case 'DebitNote':
      validarDocumentoCausable(raiz, tipo, errores);
      break;
    case 'ApplicationResponse':
      validarApplicationResponse(raiz, errores);
      break;
    case 'AttachedDocument':
      // El AttachedDocument en sí mismo, si llega como documento interno de
      // OTRO AttachedDocument, es una anidación que el anexo técnico no
      // contempla: se trata como estructura inválida, no se sigue desempacando.
      errores.push('un AttachedDocument no puede contener otro AttachedDocument anidado');
      break;
  }

  return { valido: errores.length === 0, errores };
}

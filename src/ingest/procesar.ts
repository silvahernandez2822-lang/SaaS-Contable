/**
 * `procesarAdjuntoXml` — LA FRONTERA con A6.
 *
 * Función PURA: bytes de un adjunto de correo → `DocumentoNormalizado` o un
 * `ResultadoCuarentena`. No abre conexiones, no toca la base de datos, no
 * depende de cómo llegó el correo (webhook, carga manual, portal DIAN — ver
 * sección 10.1). A6 la invoca desde su cola sin acoplarse al transporte; las
 * pruebas la invocan directo, sin levantar nada.
 *
 * Orden de las comprobaciones (de la más barata a la más cara): tamaño y
 * vacío antes de gastar CPU parseando; buena formación de XML antes de
 * desempaquetar; desempaquetado del `AttachedDocument` antes de validar
 * estructura; estructura antes de extraer; CUFE y fecha al final, porque
 * necesitan la extracción ya hecha.
 */
import { parsearXml, type NodoXml } from './ubl/xml.js';
import { desempaquetarAttachedDocument, esAttachedDocument } from './ubl/desempaquetar.js';
import { validarEstructuraUbl } from './ubl/validar.js';
import { extraerDocumento } from './ubl/extraer.js';
import { sha256Hex } from './hash.js';
import { TIPOS_DOCUMENTO_UBL } from './tipos.js';
import type {
  DocumentoNormalizado,
  MotivoCuarentena,
  ResultadoProcesarAdjunto,
  TipoDocumentoUbl,
} from './tipos.js';

export interface OpcionesProcesarAdjunto {
  nombreArchivo?: string | null;
  /** Si se pasa y el adjunto lo excede, va a cuarentena con motivo `tamano_excedido` sin llegar a parsear. */
  tamanoMaximoBytes?: number;
}

const DOCUMENTOS_CAUSABLES = new Set<TipoDocumentoUbl>(['Invoice', 'CreditNote', 'DebitNote']);

function esTipoSoportado(nombre: string): nombre is TipoDocumentoUbl {
  return (TIPOS_DOCUMENTO_UBL as readonly string[]).includes(nombre);
}

function aCuarentena(motivo: MotivoCuarentena, detalle: string): ResultadoProcesarAdjunto {
  return { ok: false, cuarentena: { motivo, detalle } };
}

export function procesarAdjuntoXml(
  bytes: Uint8Array,
  opciones: OpcionesProcesarAdjunto = {},
): ResultadoProcesarAdjunto {
  if (bytes.length === 0) {
    return aCuarentena('adjunto_vacio', 'el adjunto llegó sin contenido (0 bytes)');
  }
  if (opciones.tamanoMaximoBytes !== undefined && bytes.length > opciones.tamanoMaximoBytes) {
    return aCuarentena(
      'tamano_excedido',
      `el adjunto pesa ${bytes.length} bytes, por encima del máximo permitido de ${opciones.tamanoMaximoBytes}`,
    );
  }

  const hashContenido = sha256Hex(bytes);
  const xmlTexto = Buffer.from(bytes).toString('utf8');

  const parseo = parsearXml(xmlTexto);
  if (!parseo.ok) {
    return aCuarentena('xml_mal_formado', parseo.detalle);
  }

  let tipoDocumento: TipoDocumentoUbl;
  let raizDocumento: NodoXml;
  let xmlCrudoInterno: string;
  let veniaEnAttachedDocument = false;

  if (esAttachedDocument(parseo.nombreRaiz)) {
    veniaEnAttachedDocument = true;

    const desempaquetado = desempaquetarAttachedDocument(parseo.raiz);
    if (!desempaquetado.ok) {
      return aCuarentena(desempaquetado.motivo, desempaquetado.detalle);
    }

    const parseoInterno = parsearXml(desempaquetado.xmlInterno);
    if (!parseoInterno.ok) {
      return aCuarentena(
        'xml_mal_formado',
        `el documento embebido en el AttachedDocument no es XML válido: ${parseoInterno.detalle}`,
      );
    }
    if (!esTipoSoportado(parseoInterno.nombreRaiz)) {
      return aCuarentena(
        'tipo_documento_no_soportado',
        `el AttachedDocument embebe un "${parseoInterno.nombreRaiz}", que no es uno de los cinco tipos UBL de la sección 10.2`,
      );
    }

    tipoDocumento = parseoInterno.nombreRaiz;
    raizDocumento = parseoInterno.raiz;
    xmlCrudoInterno = desempaquetado.xmlInterno;
  } else {
    if (!esTipoSoportado(parseo.nombreRaiz)) {
      return aCuarentena(
        'no_es_ubl_reconocible',
        `la raíz del XML es "${parseo.nombreRaiz}", no uno de los cinco tipos UBL de la sección 10.2`,
      );
    }
    tipoDocumento = parseo.nombreRaiz;
    raizDocumento = parseo.raiz;
    xmlCrudoInterno = xmlTexto;
  }

  const validacion = validarEstructuraUbl(tipoDocumento, raizDocumento);
  if (!validacion.valido) {
    return {
      ok: false,
      cuarentena: {
        motivo: 'estructura_ubl_invalida',
        detalle: `estructura UBL inválida para ${tipoDocumento}: ${validacion.errores.join('; ')}`,
        erroresValidacion: validacion.errores,
      },
    };
  }

  const extraido = extraerDocumento(tipoDocumento, raizDocumento);

  // El caso crítico del que depende todo (sección 10.2): sin CUFE no hay
  // deduplicación posible ni documento causable. Solo se exige en los tres
  // documentos causables; ApplicationResponse referencia el CUFE ajeno, no
  // trae el suyo propio.
  if (DOCUMENTOS_CAUSABLES.has(tipoDocumento) && (extraido.cufe === null || extraido.cufe.trim() === '')) {
    return aCuarentena(
      'cufe_faltante',
      `${tipoDocumento} no trae cbc:UUID (CUFE): no se puede deduplicar ni causar sin él`,
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(extraido.fechaHechoEconomico)) {
    return {
      ok: false,
      cuarentena: {
        motivo: 'estructura_ubl_invalida',
        detalle: `cbc:IssueDate ausente o con formato inválido: "${extraido.fechaHechoEconomico}"`,
        erroresValidacion: ['IssueDate debe tener formato YYYY-MM-DD'],
      },
    };
  }

  const documento: DocumentoNormalizado = {
    ...extraido,
    veniaEnAttachedDocument,
    xmlCrudo: xmlCrudoInterno,
    hashContenido,
    nombreArchivo: opciones.nombreArchivo ?? null,
  };

  return { ok: true, documento };
}

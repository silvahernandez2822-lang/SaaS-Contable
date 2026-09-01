/**
 * A16 — Lectura de la tabla de un archivo cargado (Ola 4, Tarea 3).
 *
 * Convierte un `.xlsx` o un `.csv` en `{ encabezados, filas }`, y NADA MÁS.
 * No conoce ninguna tabla del esquema, ningún catálogo y ninguna regla de
 * negocio: eso vive en `catalogo.ts`, que sí las conoce, y en los servicios de
 * dominio, que son los únicos que escriben. Separarlo así es lo que permite
 * cumplir el requisito de la Ola 4 de NO duplicar lógica de negocio en el
 * parser de Excel.
 *
 * TODO VALOR SALE COMO TEXTO, a propósito. Excel adivina tipos con entusiasmo:
 * convierte «08001» en el número 8001 (adiós código DANE de Barranquilla),
 * «0.025» en un número de coma flotante, y un NIT largo en notación
 * científica. Aquí se normaliza a la cadena que el usuario ve en la celda y se
 * deja que cada validador decida qué significa. Un dato tributario que pasa
 * por un `float` es exactamente lo que prohíbe la Regla de Oro 5.
 *
 * LAS FECHAS SÍ SE TRATAN APARTE, porque Excel las guarda como número de serie
 * y el usuario nunca ve ese número: se emiten como `AAAA-MM-DD` en UTC.
 */
import ExcelJS from 'exceljs';

export class ArchivoIlegibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ArchivoIlegibleError';
  }
}

export interface FilaLeida {
  /** Número de fila TAL COMO LO VE EL USUARIO en Excel (1 = encabezados). */
  numeroFila: number;
  valores: Record<string, string>;
}

export interface TablaLeida {
  encabezados: string[];
  filas: FilaLeida[];
  /** Hoja de la que se leyó (para el mensaje de error y la auditoría). */
  hoja: string;
}

/** Nombre de la hoja de datos en las plantillas que genera este proyecto. */
export const HOJA_DATOS = 'Datos';
export const HOJA_INSTRUCCIONES = 'Instrucciones';

function textoDeCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (typeof valor === 'object') {
    const v = valor as unknown as Record<string, unknown>;
    // Fórmula: interesa el resultado, no la fórmula.
    if ('result' in v) return textoDeCelda(v.result as ExcelJS.CellValue);
    // Texto enriquecido.
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('').trim();
    }
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('error' in v) return '';
  }
  return String(valor).trim();
}

function normalizarEncabezado(texto: string): string {
  // El asterisco marca «obligatoria» en la plantilla; no forma parte del nombre.
  return texto.replace(/\*/g, '').trim();
}

function armarTabla(encabezadosCrudos: string[], filasCrudas: string[][], hoja: string): TablaLeida {
  const encabezados = encabezadosCrudos.map(normalizarEncabezado);
  if (encabezados.every((e) => e === '')) {
    throw new ArchivoIlegibleError(
      `La primera fila de la hoja "${hoja}" está vacía: se esperaba ahí la fila de encabezados de la plantilla.`,
    );
  }

  const duplicados = encabezados.filter((e, i) => e !== '' && encabezados.indexOf(e) !== i);
  if (duplicados.length > 0) {
    throw new ArchivoIlegibleError(
      `La hoja "${hoja}" trae la columna ${[...new Set(duplicados)].map((d) => `"${d}"`).join(', ')} ` +
        'repetida. Con dos columnas del mismo nombre no hay forma de saber cuál es la buena.',
    );
  }

  const filas: FilaLeida[] = [];
  filasCrudas.forEach((celdas, i) => {
    const numeroFila = i + 2; // 1 = encabezados
    if (celdas.every((c) => (c ?? '').trim() === '')) return; // fila en blanco: se ignora
    const valores: Record<string, string> = {};
    encabezados.forEach((nombre, col) => {
      if (nombre === '') return;
      valores[nombre] = (celdas[col] ?? '').trim();
    });
    filas.push({ numeroFila, valores });
  });

  return { encabezados: encabezados.filter((e) => e !== ''), filas, hoja };
}

/** Lee la hoja de datos de un `.xlsx`. */
export async function leerXlsx(buffer: ArrayBuffer | Buffer | Uint8Array): Promise<TablaLeida> {
  const wb = new ExcelJS.Workbook();
  try {
    const ab =
      buffer instanceof ArrayBuffer
        ? buffer
        : (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    await wb.xlsx.load(ab);
  } catch (e) {
    throw new ArchivoIlegibleError(
      'No se pudo abrir el archivo como libro de Excel (.xlsx). Si lo exportó de otro programa, ' +
        `guárdelo como "Libro de Excel (*.xlsx)" o como CSV. Detalle: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const hoja =
    wb.getWorksheet(HOJA_DATOS) ??
    wb.worksheets.find((h) => h.name !== HOJA_INSTRUCCIONES) ??
    wb.worksheets[0];
  if (!hoja) throw new ArchivoIlegibleError('El archivo de Excel no tiene ninguna hoja.');

  const encabezados: string[] = [];
  const filas: string[][] = [];
  hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
    const celdas: string[] = [];
    // `fila.values` es 1-based y su posición 0 está vacía.
    const valores = fila.values as ExcelJS.CellValue[];
    for (let c = 1; c < valores.length; c += 1) celdas.push(textoDeCelda(valores[c]));
    if (numero === 1) {
      encabezados.push(...celdas);
    } else {
      // `eachRow` con `includeEmpty: false` salta filas vacías, así que el
      // índice del array no sirve para numerar: se rellena hasta la posición
      // real para que el número de fila del informe coincida con Excel.
      while (filas.length < numero - 2) filas.push([]);
      filas.push(celdas);
    }
  });

  return armarTabla(encabezados, filas, hoja.name);
}

/**
 * Lee un CSV con comillas dobles al estilo RFC 4180. Detecta el separador
 * entre `,` y `;` — Excel en español guarda con punto y coma, y culpar al
 * usuario por eso sería absurdo.
 */
export function leerCsv(texto: string): TablaLeida {
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (limpio.trim() === '') throw new ArchivoIlegibleError('El archivo CSV está vacío.');

  const primeraLinea = limpio.split('\n', 1)[0] ?? '';
  const separador = (primeraLinea.match(/;/g)?.length ?? 0) > (primeraLinea.match(/,/g)?.length ?? 0) ? ';' : ',';

  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let enComillas = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else {
          enComillas = false;
        }
      } else {
        celda += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === separador) {
      fila.push(celda.trim());
      celda = '';
    } else if (c === '\n') {
      fila.push(celda.trim());
      filas.push(fila);
      fila = [];
      celda = '';
    } else {
      celda += c;
    }
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda.trim());
    filas.push(fila);
  }
  if (enComillas) {
    throw new ArchivoIlegibleError('El CSV tiene una comilla doble sin cerrar: la última celda queda abierta.');
  }

  const encabezados = filas.shift() ?? [];
  return armarTabla(encabezados, filas, 'CSV');
}

/** Elige el lector por la extensión del nombre de archivo. */
export async function leerArchivo(nombre: string, contenido: ArrayBuffer | Buffer | Uint8Array): Promise<TablaLeida> {
  const minusculas = nombre.toLowerCase();
  if (minusculas.endsWith('.csv') || minusculas.endsWith('.txt')) {
    const bytes = contenido instanceof ArrayBuffer ? new Uint8Array(contenido) : contenido;
    return leerCsv(new TextDecoder('utf-8').decode(bytes));
  }
  if (minusculas.endsWith('.xlsx') || minusculas.endsWith('.xlsm')) {
    return leerXlsx(contenido);
  }
  throw new ArchivoIlegibleError(
    `No se reconoce la extensión de "${nombre}". Se aceptan .xlsx (la plantilla) y .csv. ` +
      'Un .xls antiguo o un .ods hay que guardarlo antes como .xlsx.',
  );
}

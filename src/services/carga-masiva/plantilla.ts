/**
 * A16 — Construcción del libro Excel de una plantilla de carga masiva
 * (Ola 4, Tarea 2).
 *
 * Vive en `src/` y no en `scripts/` porque tiene DOS consumidores: el script
 * `npm run plantillas-masivas`, que escribe los archivos de
 * `/archivos-masivos/`, y la ruta `GET /api/plantillas/:catalogo`, que se la
 * entrega al usuario en el momento. Si viviera solo en el script, la ruta
 * tendría que servir archivos de disco y un despliegue con el directorio viejo
 * entregaría plantillas que su propio importador rechaza.
 *
 * La fuente de las columnas es `definiciones.ts`, la misma que valida la carga.
 */
import ExcelJS from 'exceljs';
import { DEFINICIONES, type ColumnaPlantilla, type DefinicionCarga } from './definiciones';
import { HOJA_DATOS, HOJA_INSTRUCCIONES } from './tabla';

/** Filas de la hoja de datos que llevan lista desplegable y formato. */
const FILAS_PREPARADAS = 200;

const ROJO = 'FFC00000';
const AZUL = 'FF1F4E79';
const GRIS_CLARO = 'FFF2F2F2';

function relleno(color: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

/**
 * Encabezado: OBLIGATORIA en rojo y con asterisco, opcional en azul. El
 * asterisco es parte del contrato con el lector (`normalizarEncabezado` lo
 * quita), así que la plantilla se puede subir tal cual sin tocarla.
 */
function nombreEnPlantilla(columna: ColumnaPlantilla): string {
  return columna.obligatoria ? `${columna.nombre} *` : columna.nombre;
}

function literalDeLista(valores: readonly string[]): string {
  // Excel exige la lista entre comillas dobles y separada por comas. Un valor
  // con coma dentro rompería la fórmula; ninguno de los catálogos la usa, y si
  // algún día la usara, esto lo dice en voz alta en vez de generar un archivo
  // corrupto en silencio.
  const conComa = valores.find((v) => v.includes(',') || v.includes('"'));
  if (conComa) {
    throw new Error(
      `El valor "${conComa}" tiene una coma o una comilla y no se puede meter en una lista desplegable de Excel.`,
    );
  }
  return `"${valores.join(',')}"`;
}

function construirHojaDatos(wb: ExcelJS.Workbook, definicion: DefinicionCarga<never>): void {
  const hoja = wb.addWorksheet(HOJA_DATOS, { views: [{ state: 'frozen', ySplit: 1 }] });

  hoja.columns = definicion.columnas.map((c) => ({
    header: nombreEnPlantilla(c),
    key: c.nombre,
    width: Math.max(14, Math.min(38, nombreEnPlantilla(c).length + 4)),
  }));

  const encabezado = hoja.getRow(1);
  encabezado.height = 24;
  definicion.columnas.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1);
    celda.font = { bold: true, color: { argb: c.obligatoria ? ROJO : AZUL }, size: 11 };
    celda.fill = relleno(GRIS_CLARO);
    celda.alignment = { vertical: 'middle', wrapText: true };
    celda.border = { bottom: { style: 'medium', color: { argb: c.obligatoria ? ROJO : AZUL } } };
    celda.note = [
      c.obligatoria ? 'COLUMNA OBLIGATORIA' : 'Columna opcional',
      '',
      c.descripcion,
      c.origen ? `\nValores válidos: ${c.origen}` : '',
    ]
      .filter((t) => t !== '')
      .join('\n');
  });

  // Fila 2: el ejemplo, ya lleno y válido.
  const ejemplo = hoja.addRow(Object.fromEntries(definicion.columnas.map((c) => [c.nombre, c.ejemplo])));
  ejemplo.font = { italic: true, color: { argb: 'FF7F7F7F' } };

  // Listas desplegables sobre las columnas de conjunto cerrado.
  definicion.columnas.forEach((c, i) => {
    if (!c.valores || c.valores.length === 0) return;
    const letra = hoja.getColumn(i + 1).letter;
    for (let fila = 2; fila <= FILAS_PREPARADAS; fila += 1) {
      hoja.getCell(`${letra}${fila}`).dataValidation = {
        type: 'list',
        allowBlank: !c.obligatoria,
        formulae: [literalDeLista(c.valores)],
        showErrorMessage: true,
        errorStyle: 'error',
        errorTitle: 'Valor no admitido',
        error: `"${c.nombre}" solo admite: ${c.valores.join(', ')}.`,
      };
    }
  });

  // Los códigos con ceros a la izquierda (DANE, CIIU, PUC) se guardan como
  // TEXTO: si Excel los toma por números, 05001 se convierte en 5001 y el
  // municipio deja de existir.
  definicion.columnas.forEach((c, i) => {
    if (c.tipo !== 'codigo') return;
    const columna = hoja.getColumn(i + 1);
    columna.numFmt = '@';
  });
}

function construirHojaInstrucciones(wb: ExcelJS.Workbook, definicion: DefinicionCarga<never>): void {
  const hoja = wb.addWorksheet(HOJA_INSTRUCCIONES, { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'Columna', key: 'columna', width: 32 },
    { header: '¿Obligatoria?', key: 'obligatoria', width: 14 },
    { header: 'Formato', key: 'formato', width: 16 },
    { header: 'Qué espera', key: 'descripcion', width: 78 },
    { header: 'De dónde salen los valores válidos', key: 'origen', width: 60 },
    { header: 'Ejemplo', key: 'ejemplo', width: 22 },
  ];

  const cabecera = hoja.getRow(1);
  cabecera.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecera.fill = relleno(AZUL);
  cabecera.height = 22;
  cabecera.alignment = { vertical: 'middle' };

  const FORMATO: Record<ColumnaPlantilla['tipo'], string> = {
    texto: 'Texto',
    entero: 'Número entero',
    decimal: 'Número decimal',
    pesos: 'Pesos (sin separador de miles)',
    tarifa: 'Fracción o porcentaje con %',
    fecha: 'Fecha AAAA-MM-DD',
    booleano: 'SI / NO',
    lista: 'Lista cerrada',
    codigo: 'Código (texto)',
  };

  // Bloque de encabezado explicativo antes de la tabla de columnas.
  const titulo = hoja.addRow([`Plantilla de carga masiva — ${definicion.titulo}`]);
  titulo.font = { bold: true, size: 14 };
  hoja.addRow([`Tabla del sistema: ${definicion.tabla}`]);
  hoja.addRow([`Módulo: ${definicion.modulo}  (${definicion.moduloRuta})`]);
  hoja.addRow([`Se sube en: /carga-masiva/${definicion.clave}`]);
  hoja.addRow([`Permiso necesario: ${definicion.permiso}`]);
  hoja.addRow([]);
  const desc = hoja.addRow([definicion.descripcion]);
  desc.alignment = { wrapText: true, vertical: 'top' };
  desc.height = 40;
  hoja.addRow([]);

  if (definicion.requierePrevio && definicion.requierePrevio.length > 0) {
    const previo = hoja.addRow([
      `CARGUE ANTES: ${definicion.requierePrevio.join(', ')}. Sin esos catálogos, las filas de este archivo no ` +
        'encuentran a qué referirse y se rechazan.',
    ]);
    previo.font = { bold: true, color: { argb: ROJO } };
    previo.alignment = { wrapText: true, vertical: 'top' };
    previo.height = 30;
    hoja.addRow([]);
  }

  for (const advertencia of definicion.advertencias ?? []) {
    const fila = hoja.addRow([`• ${advertencia}`]);
    fila.font = { color: { argb: ROJO } };
    fila.alignment = { wrapText: true, vertical: 'top' };
    fila.height = 40;
  }
  hoja.addRow([]);

  const reglas = [
    'La fila 1 de la hoja "Datos" son los encabezados y NO se toca: el importador los busca por su nombre exacto.',
    'El asterisco (*) y el color rojo marcan las columnas OBLIGATORIAS. Las azules son opcionales.',
    'La fila 2 es un EJEMPLO ya lleno: bórrela o sobreescríbala antes de subir el archivo.',
    'Las filas completamente vacías se ignoran; no hace falta borrarlas.',
    'Las columnas que el importador no conozca se ignoran, así que puede dejar sus propias notas en columnas extra.',
    'Si alguna fila tiene un error, NO se carga nada: se le muestra la lista completa de filas con problema ' +
      '(número de fila, columna y motivo) y usted decide entre corregir y volver a subir, o cargar solo las válidas.',
    'Los importes van en pesos SIN separador de miles (250000, no 250.000): no hay forma de saber si el punto ' +
      'separa miles o decimales, y un importe mal interpretado en un motor tributario no se nota hasta el cierre.',
    'Las tarifas se escriben como fracción decimal con coma, o como porcentaje añadiendo el signo de por ' +
      'ciento al final. Un número mayor que uno sin ese signo se rechaza: no se adivina cuál de las dos cosas quiso decir.',
    'Los códigos con ceros a la izquierda (DANE, CIIU) están formateados como texto: no los reformatee a número.',
  ];
  const tituloReglas = hoja.addRow(['CÓMO SE LLENA']);
  tituloReglas.font = { bold: true, size: 12 };
  for (const regla of reglas) {
    const fila = hoja.addRow([`• ${regla}`]);
    fila.alignment = { wrapText: true, vertical: 'top' };
    fila.height = 28;
  }
  hoja.addRow([]);

  const tituloColumnas = hoja.addRow(['COLUMNA POR COLUMNA']);
  tituloColumnas.font = { bold: true, size: 12 };
  const cabeceraTabla = hoja.addRow([
    'Columna',
    '¿Obligatoria?',
    'Formato',
    'Qué espera',
    'De dónde salen los valores válidos',
    'Ejemplo',
  ]);
  cabeceraTabla.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabeceraTabla.eachCell((celda) => {
    celda.fill = relleno(AZUL);
  });

  for (const c of definicion.columnas) {
    const fila = hoja.addRow([
      c.nombre,
      c.obligatoria ? 'OBLIGATORIA' : 'opcional',
      FORMATO[c.tipo],
      c.descripcion,
      c.valores ? `Uno de: ${c.valores.join(', ')}` : (c.origen ?? ''),
      c.ejemplo,
    ]);
    fila.alignment = { wrapText: true, vertical: 'top' };
    fila.getCell(1).font = { bold: true, color: { argb: c.obligatoria ? ROJO : AZUL } };
    fila.getCell(2).font = { color: { argb: c.obligatoria ? ROJO : AZUL } };
  }

  // La cabecera "real" de la hoja (fila 1) sobra visualmente; se limpia para
  // que la hoja empiece por el título.
  hoja.spliceRows(1, 1);
}

export function construirPlantilla(definicion: DefinicionCarga<never>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Contable CO';
  wb.description = `Plantilla de carga masiva — ${definicion.titulo} (${definicion.tabla})`;
  construirHojaDatos(wb, definicion);
  construirHojaInstrucciones(wb, definicion);
  return wb;
}

export function nombreDeArchivo(definicion: DefinicionCarga<never>): string {
  return `${definicion.clave}.xlsx`;
}

/** Todas las plantillas, ya construidas. Lo usa el script y las pruebas. */
export function todasLasPlantillas(): Array<{ definicion: DefinicionCarga<never>; wb: ExcelJS.Workbook }> {
  return DEFINICIONES.map((definicion) => ({ definicion, wb: construirPlantilla(definicion) }));
}

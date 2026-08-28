/**
 * A9 — Construcción del libro Excel con las cuatro hojas obligatorias de la
 * sección 11.2: Datos, Papel de trabajo, Trazabilidad y Parámetros.
 *
 * Librería elegida: `exceljs`. Es la opción de servidor establecida para
 * Node/TypeScript, sin costo de licencia (MIT) y sin dependencia de un
 * binario nativo (a diferencia de otras que envuelven LibreOffice o requieren
 * un motor de cálculo). Pesa en el bundle del SERVIDOR, no en el del
 * navegador: estos módulos viven en `src/reports/` y los invoca un route
 * handler de Next.js (App Router corre en servidor), nunca un componente de
 * cliente, así que no infla el JavaScript que baja al contador.
 */
import ExcelJS from 'exceljs';
import { centavosANumeroPesos, tarifaATextoPorcentaje, type CentavosEntrada } from './formato';
import type { ColumnaDatos, HojaAdicional, LibroExcelSpec } from './tipos';

const NOMBRE_HOJA_DATOS = 'Datos';
const NOMBRE_HOJA_PAPEL = 'Papel de trabajo';
const NOMBRE_HOJA_TRAZA = 'Trazabilidad';
const NOMBRE_HOJA_PARAMETROS = 'Parámetros';

/**
 * Hoja "Datos": una fila por registro, sin celdas combinadas, sin ningún
 * formato que estorbe. Es la hoja que el contador filtra y tabula, así que
 * los valores de moneda van como número plano (no texto con separador) y las
 * fracciones tributarias van como el texto crudo que trae la base de datos.
 */
function construirHojaDatos(
  wb: ExcelJS.Workbook,
  columnas: ColumnaDatos[],
  filas: readonly unknown[],
): void {
  const hoja = wb.addWorksheet(NOMBRE_HOJA_DATOS);
  hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key }));
  for (const filaCruda of filas) {
    const fila = filaCruda as Record<string, unknown>;
    const plano: Record<string, unknown> = {};
    for (const c of columnas) {
      const valor = fila[c.key];
      plano[c.key] = c.tipo === 'moneda' ? centavosANumeroPesos(valor as CentavosEntrada) : valor ?? '';
    }
    hoja.addRow(plano);
  }
}

/** Hoja "Papel de trabajo": encabezado de empresa/NIT/período/responsable + tabla formateada. */
function construirHojaPapelDeTrabajo(
  wb: ExcelJS.Workbook,
  spec: LibroExcelSpec,
): void {
  const hoja = wb.addWorksheet(NOMBRE_HOJA_PAPEL);
  const e = spec.encabezado;

  const filaTitulo = hoja.addRow([e.tituloReporte]);
  filaTitulo.font = { bold: true, size: 14 };
  hoja.addRow([e.nombreComercial ? `${e.razonSocial} (${e.nombreComercial})` : e.razonSocial]);
  const dv = e.digitoVerificacion === null ? '' : `-${e.digitoVerificacion}`;
  hoja.addRow([`NIT: ${e.nit}${dv}`]);
  hoja.addRow([`Período / corte: ${e.periodo}`]);
  hoja.addRow([`Responsable: ${e.responsableNombre} <${e.responsableEmail}>`]);
  hoja.addRow([`Generado el: ${e.generadoEn}`]);
  hoja.addRow([]);

  const columnas = spec.resumenPapelDeTrabajo?.columnas ?? spec.columnasDatos;
  const filas = spec.resumenPapelDeTrabajo?.filas ?? spec.filasDatos;

  const filaEncabezadoTabla = hoja.addRow(columnas.map((c) => c.header));
  filaEncabezadoTabla.font = { bold: true };
  filaEncabezadoTabla.eachCell((celda) => {
    celda.border = { bottom: { style: 'thin' } };
  });

  for (const filaCruda of filas) {
    const fila = filaCruda as Record<string, unknown>;
    const valores = columnas.map((c) => {
      const valor = fila[c.key];
      if (c.tipo === 'moneda') return centavosANumeroPesos(valor as CentavosEntrada);
      if (c.tipo === 'porcentaje') return tarifaATextoPorcentaje(valor as string | null);
      return valor ?? '';
    });
    const filaHoja = hoja.addRow(valores);
    columnas.forEach((c, i) => {
      if (c.tipo === 'moneda') {
        const celda = filaHoja.getCell(i + 1);
        celda.numFmt = MASCARA_MONEDA;
      }
    });
  }

  hoja.columns.forEach((col, i) => {
    const ancho = columnas[i]?.width;
    if (ancho) col.width = ancho;
  });
}

/**
 * Máscara de formato numérico de Excel para pesos colombianos, con separador
 * de miles y sin decimales (el peso no circula fraccionado). Es notación de
 * PRESENTACIÓN de la celda, no una tarifa ni una base: no hay aquí un punto
 * decimal ni un signo de porcentaje junto a un número.
 */
const MASCARA_MONEDA = '#,##0';

/** Hoja "Trazabilidad": qué regla y qué vigencia se aplicó a cada partida. */
function construirHojaTrazabilidad(wb: ExcelJS.Workbook, spec: LibroExcelSpec): void {
  const hoja = wb.addWorksheet(NOMBRE_HOJA_TRAZA);
  if (spec.trazabilidad.length === 0) {
    hoja.addRow([
      spec.trazabilidadNota ??
        'Este reporte no contiene partidas con cálculo tributario: no aplica trazabilidad de regla y vigencia.',
    ]);
    return;
  }
  const encabezados = [
    'Referencia',
    'Tipo',
    'Regla (tax_rule_id)',
    'Tarifa',
    'Vigente desde',
    'Vigente hasta',
    'Norma de respaldo',
    'Base',
    'Valor',
    'Aplicada',
    'Motivo si no aplica',
    'Nota',
  ];
  const filaEncabezado = hoja.addRow(encabezados);
  filaEncabezado.font = { bold: true };
  for (const t of spec.trazabilidad) {
    hoja.addRow([
      t.referencia,
      t.tipo,
      t.taxRuleId ?? '',
      tarifaATextoPorcentaje(t.tarifaTexto),
      t.vigenteDesde ?? '',
      t.vigenteHasta ?? 'vigente',
      t.normaRespaldo,
      centavosANumeroPesos(t.baseTexto),
      centavosANumeroPesos(t.valorTexto),
      t.aplicada ? 'Sí' : 'No',
      t.motivoNoAplica ?? '',
      t.nota ?? '',
    ]);
  }
}

/** Hoja "Parámetros": los valores paramétricos usados, con su vigencia. */
function construirHojaParametros(wb: ExcelJS.Workbook, spec: LibroExcelSpec): void {
  const hoja = wb.addWorksheet(NOMBRE_HOJA_PARAMETROS);
  const filaEncabezado = hoja.addRow(['Parámetro', 'Valor', 'Vigente desde', 'Vigente hasta', 'Norma de respaldo', 'Notas']);
  filaEncabezado.font = { bold: true };
  for (const p of spec.parametros) {
    hoja.addRow([p.parametro, p.valor, p.vigenteDesde, p.vigenteHasta ?? 'vigente', p.normaRespaldo, p.notas ?? '']);
  }
  if (spec.parametros.length === 0) {
    hoja.addRow(['Este reporte no usó ningún valor paramétrico del período consultado.']);
  }
}

/**
 * Hoja EXTRA (A10, Ola 3). Mismo formateo de celda que "Papel de trabajo"
 * —moneda con la máscara de presentación, tarifa como texto— porque una hoja
 * adicional es siempre una hoja para LEER: el crudo filtrable sigue estando
 * en "Datos", que no cambia.
 */
function construirHojaAdicional(wb: ExcelJS.Workbook, hoja: HojaAdicional): void {
  const ws = wb.addWorksheet(hoja.nombre);

  for (const linea of hoja.encabezadoTexto ?? []) {
    ws.addRow([linea]);
  }
  if ((hoja.encabezadoTexto ?? []).length > 0) ws.addRow([]);

  const filaEncabezado = ws.addRow(hoja.columnas.map((c) => c.header));
  filaEncabezado.font = { bold: true };
  filaEncabezado.eachCell((celda) => {
    celda.border = { bottom: { style: 'thin' } };
  });

  for (const filaCruda of hoja.filas) {
    const fila = filaCruda as Record<string, unknown>;
    const valores = hoja.columnas.map((c) => {
      const valor = fila[c.key];
      if (c.tipo === 'moneda') return centavosANumeroPesos(valor as CentavosEntrada);
      if (c.tipo === 'porcentaje') return tarifaATextoPorcentaje(valor as string | null);
      return valor ?? '';
    });
    const filaHoja = ws.addRow(valores);
    hoja.columnas.forEach((c, i) => {
      if (c.tipo === 'moneda') filaHoja.getCell(i + 1).numFmt = MASCARA_MONEDA;
    });
  }

  if ((hoja.pie ?? []).length > 0) {
    ws.addRow([]);
    for (const linea of hoja.pie ?? []) ws.addRow([linea]);
  }

  ws.columns.forEach((col, i) => {
    const ancho = hoja.columnas[i]?.width;
    if (ancho) col.width = ancho;
  });
}

/**
 * Arma el libro completo con las cuatro hojas obligatorias, en este orden
 * fijo, y a continuación las hojas adicionales que declare el spec (A10).
 */
export function construirLibroExcel(spec: LibroExcelSpec): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'contable-co';
  wb.created = new Date();
  construirHojaDatos(wb, spec.columnasDatos, spec.filasDatos);
  construirHojaPapelDeTrabajo(wb, spec);
  construirHojaTrazabilidad(wb, spec);
  construirHojaParametros(wb, spec);
  for (const hoja of spec.hojasAdicionales ?? []) construirHojaAdicional(wb, hoja);
  return wb;
}

/** Serializa el libro a un buffer .xlsx, listo para servir como descarga. */
export async function libroABuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

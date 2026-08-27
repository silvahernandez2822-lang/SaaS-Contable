/**
 * A9 — Reportes exportables (sección 11 del mega-prompt).
 *
 * Tipos compartidos por los ocho libros obligatorios de la Ola 3. Ninguno de
 * ellos lleva un valor tributario: son la FORMA de la respuesta, igual que
 * `src/domain/tipos.ts` es la forma del motor de reglas. Las cifras llegan
 * siempre desde la base de datos.
 */

/** Encabezado obligatorio de la hoja "Papel de trabajo" (sección 11.2). */
export interface EncabezadoReporte {
  tituloReporte: string;
  razonSocial: string;
  nombreComercial: string | null;
  nit: string;
  digitoVerificacion: number | null;
  /** Descripción del rango o corte que cubre el reporte (p. ej. "2026-06-01 a 2026-06-30"). */
  periodo: string;
  responsableNombre: string;
  responsableEmail: string;
  generadoEn: string;
}

/** Una columna de la hoja "Datos": crudo, sin celdas combinadas. */
export interface ColumnaDatos {
  header: string;
  key: string;
  /** Ancho sugerido SOLO para la hoja "Papel de trabajo" (la hoja "Datos" no lleva formato). */
  width?: number;
  /** `'moneda'` y `'porcentaje'` solo dan formato en "Papel de trabajo"; en "Datos" el valor va crudo. */
  tipo?: 'texto' | 'entero' | 'moneda' | 'porcentaje' | 'fecha';
}

/** Una fila de la hoja "Trazabilidad": regla y vigencia aplicada a una partida. */
export interface FilaTrazabilidad {
  referencia: string;
  tipo: string;
  taxRuleId: string | null;
  tarifaTexto: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  normaRespaldo: string;
  baseTexto: string | null;
  valorTexto: string | null;
  aplicada: boolean;
  motivoNoAplica: string | null;
  nota: string | null;
}

/** Una fila de la hoja "Parámetros": el valor paramétrico usado y su vigencia. */
export interface FilaParametro {
  parametro: string;
  valor: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
}

/**
 * Tabla resumida para "Papel de trabajo" cuando conviene mostrar un
 * agregado (p. ej. el certificado de retenciones agrupado por tipo, o el
 * movimiento de terceros consolidado) en vez de repetir el crudo de "Datos".
 * Si no se provee, "Papel de trabajo" formatea la misma tabla que "Datos".
 */
export interface ResumenPapelDeTrabajo {
  columnas: ColumnaDatos[];
  /** Cualquier fila cuyas propiedades se lean por `columna.key` (se accede con un cast interno). */
  filas: readonly unknown[];
}

/** Especificación completa de un libro exportado: las cuatro hojas obligatorias. */
export interface LibroExcelSpec {
  encabezado: EncabezadoReporte;
  columnasDatos: ColumnaDatos[];
  /** Cualquier fila cuyas propiedades se lean por `columna.key` (se accede con un cast interno). */
  filasDatos: readonly unknown[];
  /** Tabla que se muestra en "Papel de trabajo" en vez del crudo de "Datos". */
  resumenPapelDeTrabajo?: ResumenPapelDeTrabajo;
  trazabilidad: FilaTrazabilidad[];
  /** Nota que se muestra cuando `trazabilidad` está vacía a propósito (el reporte no calcula tributos). */
  trazabilidadNota?: string;
  parametros: FilaParametro[];
}

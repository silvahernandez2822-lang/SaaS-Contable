/**
 * A9 — Pruebas unitarias (sin base de datos) de `src/reports/formato.ts` y
 * `src/reports/excel.ts`: la aritmética de presentación y las cuatro hojas
 * obligatorias de la sección 11.2.
 */
import { describe, expect, it } from 'vitest';
import {
  centavosATextoPesos,
  centavosANumeroPesos,
  tarifaATextoPorcentaje,
} from '../../src/reports/formato';
import { construirLibroExcel, libroABuffer } from '../../src/reports/excel';
import type { EncabezadoReporte, LibroExcelSpec } from '../../src/reports/tipos';

describe('tarifaATextoPorcentaje', () => {
  it('4% (0.040000) -> "4%"', () => {
    expect(tarifaATextoPorcentaje('0.040000')).toBe('4%');
  });
  it('2 por mil (0.002000) -> "0.2%"', () => {
    expect(tarifaATextoPorcentaje('0.002000')).toBe('0.2%');
  });
  it('15% (0.150000) -> "15%"', () => {
    expect(tarifaATextoPorcentaje('0.150000')).toBe('15%');
  });
  it('100% (1.000000) -> "100%"', () => {
    expect(tarifaATextoPorcentaje('1.000000')).toBe('100%');
  });
  it('11% (0.110000) -> "11%"', () => {
    expect(tarifaATextoPorcentaje('0.110000')).toBe('11%');
  });
  it('null/undefined/vacío -> cadena vacía', () => {
    expect(tarifaATextoPorcentaje(null)).toBe('');
    expect(tarifaATextoPorcentaje(undefined)).toBe('');
    expect(tarifaATextoPorcentaje('')).toBe('');
  });
});

describe('centavos -> pesos', () => {
  it('centavosANumeroPesos divide por 100 sin perder el entero', () => {
    expect(centavosANumeroPesos('119000000')).toBe(1190000);
    expect(centavosANumeroPesos(4000000)).toBe(40000);
    expect(centavosANumeroPesos(null)).toBeNull();
  });
  it('centavosATextoPesos formatea con separador de miles es-CO', () => {
    expect(centavosATextoPesos('119000000')).toBe((1190000).toLocaleString('es-CO'));
  });
});

function specMinimo(overrides: Partial<LibroExcelSpec> = {}): LibroExcelSpec {
  const encabezado: EncabezadoReporte = {
    tituloReporte: 'Reporte de prueba',
    razonSocial: 'Empresa de prueba S.A.S.',
    nombreComercial: null,
    nit: '900123456',
    digitoVerificacion: 7,
    periodo: '2026-06-01 a 2026-06-30',
    responsableNombre: 'Contador de prueba',
    responsableEmail: 'contador@ejemplo.co',
    generadoEn: '2026-07-01T00:00:00.000Z',
  };
  return {
    encabezado,
    columnasDatos: [
      { header: 'Fecha', key: 'fecha' },
      { header: 'Monto', key: 'monto', tipo: 'moneda' },
    ],
    filasDatos: [{ fecha: '2026-06-15', monto: '100000' }],
    trazabilidad: [],
    parametros: [],
    ...overrides,
  };
}

describe('construirLibroExcel', () => {
  it('produce exactamente las cuatro hojas obligatorias, en orden', () => {
    const wb = construirLibroExcel(specMinimo());
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Datos',
      'Papel de trabajo',
      'Trazabilidad',
      'Parámetros',
    ]);
  });

  it('"Datos" es crudo: una fila por registro, el monto en centavos convertido a un NÚMERO plano', () => {
    const wb = construirLibroExcel(specMinimo());
    const datos = wb.getWorksheet('Datos')!;
    expect(datos.getRow(1).getCell(1).value).toBe('Fecha');
    expect(datos.getRow(2).getCell(1).value).toBe('2026-06-15');
    expect(datos.getRow(2).getCell(2).value).toBe(1000); // 100000 centavos -> 1000 pesos
    expect(datos.rowCount).toBe(2);
  });

  it('"Papel de trabajo" trae el encabezado de empresa/NIT/período/responsable/fecha', () => {
    const wb = construirLibroExcel(specMinimo());
    const papel = wb.getWorksheet('Papel de trabajo')!;
    const textoCompleto = papel
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' | ');
    expect(textoCompleto).toContain('Empresa de prueba S.A.S.');
    expect(textoCompleto).toContain('900123456');
    expect(textoCompleto).toContain('2026-06-01 a 2026-06-30');
    expect(textoCompleto).toContain('Contador de prueba');
    expect(textoCompleto).toContain('Generado el');
  });

  it('"Papel de trabajo" usa el resumen provisto en vez del crudo, si se declara', () => {
    const wb = construirLibroExcel(
      specMinimo({
        resumenPapelDeTrabajo: {
          columnas: [{ header: 'Total', key: 'total', tipo: 'moneda' }],
          filas: [{ total: '500000' }],
        },
      }),
    );
    const papel = wb.getWorksheet('Papel de trabajo')!;
    const valores = papel.getSheetValues().flat();
    expect(valores).toContain('Total');
    expect(valores).not.toContain('Monto');
  });

  it('"Trazabilidad" vacía muestra la nota explicativa en vez de una tabla vacía', () => {
    const wb = construirLibroExcel(specMinimo({ trazabilidadNota: 'nota de prueba' }));
    const traza = wb.getWorksheet('Trazabilidad')!;
    expect(traza.getRow(1).getCell(1).value).toBe('nota de prueba');
  });

  it('"Trazabilidad" con datos trae regla, vigencia y norma de respaldo por partida', () => {
    const wb = construirLibroExcel(
      specMinimo({
        trazabilidad: [
          {
            referencia: 'ref-1',
            tipo: 'retefuente',
            taxRuleId: 'regla-1',
            tarifaTexto: '0.040000',
            vigenteDesde: '2026-01-01',
            vigenteHasta: null,
            normaRespaldo: 'Norma de prueba',
            baseTexto: '1000000',
            valorTexto: '40000',
            aplicada: true,
            motivoNoAplica: null,
            nota: null,
          },
        ],
      }),
    );
    const traza = wb.getWorksheet('Trazabilidad')!;
    const encabezados = traza.getRow(1).values as unknown[];
    expect(encabezados).toContain('Regla (tax_rule_id)');
    expect(encabezados).toContain('Vigente desde');
    expect(encabezados).toContain('Norma de respaldo');
    const fila = traza.getRow(2).values as unknown[];
    expect(fila).toContain('regla-1');
    expect(fila).toContain('4%');
  });

  it('"Parámetros" trae el valor y su vigencia', () => {
    const wb = construirLibroExcel(
      specMinimo({
        parametros: [
          {
            parametro: 'UVT 2026',
            valor: '$52.374',
            vigenteDesde: '2026-01-01',
            vigenteHasta: null,
            normaRespaldo: 'Resolución DIAN',
            notas: null,
          },
        ],
      }),
    );
    const parametros = wb.getWorksheet('Parámetros')!;
    const fila = parametros.getRow(2).values as unknown[];
    expect(fila).toContain('UVT 2026');
    expect(fila).toContain('Resolución DIAN');
  });

  it('se serializa a un buffer .xlsx no vacío', async () => {
    const wb = construirLibroExcel(specMinimo());
    const buffer = await libroABuffer(wb);
    expect(buffer.length).toBeGreaterThan(0);
    // Firma de archivo ZIP (.xlsx es un contenedor ZIP): "PK".
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
  });
});

// =============================================================================
// V-18 — las advertencias de alcance llegan al Excel, no solo al objeto de
// retorno ni a la cabecera del archivo plano.
// =============================================================================

describe('construirLibroExcel — advertencias de alcance (V-18)', () => {
  it('sin advertencias, "Papel de trabajo" no agrega ningún bloque de más', () => {
    const wb = construirLibroExcel(specMinimo());
    const papel = wb.getWorksheet('Papel de trabajo')!;
    const texto = papel.getSheetValues().flat().map((v) => String(v ?? '')).join(' ');
    expect(texto).not.toMatch(/ADVERTENCIAS DE ALCANCE/);
  });

  it('con advertencias, aparecen destacadas en "Papel de trabajo" en rojo y negrita', () => {
    const wb = construirLibroExcel(
      specMinimo({ advertencias: ['Este reporte no cubre las ventas: el producto no las procesa.'] }),
    );
    const papel = wb.getWorksheet('Papel de trabajo')!;
    const filas = papel.getSheetValues() as unknown[][];
    const idxTitulo = filas.findIndex((f) => (f ?? []).some((c) => String(c ?? '').includes('ADVERTENCIAS DE ALCANCE')));
    expect(idxTitulo).toBeGreaterThan(-1);
    const filaTitulo = papel.getRow(idxTitulo);
    expect(filaTitulo.font?.bold).toBe(true);
    expect((filaTitulo.font as any)?.color?.argb).toBe('FFC00000');
    const texto = filas.flat().map((v) => String(v ?? '')).join(' ');
    expect(texto).toContain('Este reporte no cubre las ventas');
  });

  it('las cuatro hojas obligatorias siguen siendo las cuatro primeras aunque haya advertencias y hojas adicionales', () => {
    const wb = construirLibroExcel(
      specMinimo({
        advertencias: ['Advertencia de alcance de prueba.'],
        hojasAdicionales: [
          {
            nombre: 'Advertencias',
            activarAlAbrir: true,
            columnas: [{ header: 'Advertencia', key: 'texto', width: 100 }],
            filas: [{ texto: 'Advertencia de alcance de prueba.' }],
          },
        ],
      }),
    );
    expect(wb.worksheets.slice(0, 4).map((w) => w.name)).toEqual([
      'Datos',
      'Papel de trabajo',
      'Trazabilidad',
      'Parámetros',
    ]);
    expect(wb.worksheets.map((w) => w.name)).toContain('Advertencias');
  });

  it('la hoja marcada `activarAlAbrir` queda como la pestaña activa al abrir el archivo', () => {
    const wb = construirLibroExcel(
      specMinimo({
        hojasAdicionales: [
          {
            nombre: 'Advertencias',
            activarAlAbrir: true,
            columnas: [{ header: 'Advertencia', key: 'texto', width: 100 }],
            filas: [{ texto: 'x' }],
          },
        ],
      }),
    );
    const indiceEsperado = wb.worksheets.findIndex((w) => w.name === 'Advertencias');
    expect(indiceEsperado).toBeGreaterThan(-1);
    expect(wb.views?.[0]?.activeTab).toBe(indiceEsperado);
  });

  it('sin ninguna hoja `activarAlAbrir`, no se fuerza ninguna pestaña activa', () => {
    const wb = construirLibroExcel(specMinimo());
    expect(wb.views ?? []).toHaveLength(0);
  });

  it('si dos hojas piden `activarAlAbrir`, gana la primera en el orden declarado', () => {
    const wb = construirLibroExcel(
      specMinimo({
        hojasAdicionales: [
          {
            nombre: 'Bloqueos',
            activarAlAbrir: true,
            columnas: [{ header: 'x', key: 'x' }],
            filas: [{ x: '1' }],
          },
          {
            nombre: 'Advertencias',
            activarAlAbrir: true,
            columnas: [{ header: 'texto', key: 'texto' }],
            filas: [{ texto: '2' }],
          },
        ],
      }),
    );
    const indiceBloqueos = wb.worksheets.findIndex((w) => w.name === 'Bloqueos');
    expect(wb.views?.[0]?.activeTab).toBe(indiceBloqueos);
  });
});

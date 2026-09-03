/**
 * D-086 · Módulo puro de dirección en formato DIAN (Formato 1001).
 * No toca base de datos. Verifica composición, validación y el desglose
 * conservador de direcciones heredadas.
 */
import { describe, expect, it } from 'vitest';
import {
  DireccionDianInvalidaError,
  componerDireccionDian,
  intentarDesglosarDireccionLibre,
  validarDireccionDian,
  type DireccionDian,
} from '../../src/domain/direccion-dian';

const BASE: DireccionDian = {
  tipoVia: 'CL',
  numeroVia: '100',
  numeroGeneradora: '15',
  placa: '20',
};

describe('componerDireccionDian', () => {
  it('compone la forma mínima con # y -', () => {
    expect(componerDireccionDian(BASE)).toBe('CL 100 # 15 - 20');
  });

  it('pega la letra al número, separa BIS y cuadrante, y añade complementos', () => {
    const d: DireccionDian = {
      tipoVia: 'CR',
      numeroVia: '7',
      letraVia: 'A',
      bisVia: true,
      letraBisVia: 'B',
      cuadranteVia: 'SUR',
      numeroGeneradora: '12',
      letraGeneradora: 'C',
      cuadranteGeneradora: 'ESTE',
      placa: '45',
      complementos: [
        { tipo: 'IN', valor: '3' },
        { tipo: 'AP', valor: '401' },
      ],
    };
    expect(componerDireccionDian(d)).toBe('CR 7A BIS B SUR # 12C ESTE - 45 IN 3 AP 401');
  });

  it('normaliza a mayúsculas', () => {
    expect(componerDireccionDian({ ...BASE, tipoVia: 'cl' })).toBe('CL 100 # 15 - 20');
  });

  it('lanza DireccionDianInvalidaError si falta un obligatorio', () => {
    expect(() => componerDireccionDian({ ...BASE, placa: '' })).toThrow(DireccionDianInvalidaError);
  });

  it('rechaza tipo de vía inventado', () => {
    expect(validarDireccionDian({ ...BASE, tipoVia: 'XX' })).toContainEqual(
      expect.stringContaining('no reconocido'),
    );
  });

  it('rechaza texto libre en el número y en el complemento', () => {
    expect(validarDireccionDian({ ...BASE, numeroVia: '15 esquina' }).length).toBeGreaterThan(0);
    expect(
      validarDireccionDian({ ...BASE, complementos: [{ tipo: 'AP', valor: 'la de la esquina' }] }).length,
    ).toBeGreaterThan(0);
  });

  it('rechaza letra de BIS sin BIS marcado', () => {
    expect(validarDireccionDian({ ...BASE, letraBisVia: 'B' })).toContainEqual(
      expect.stringContaining('BIS'),
    );
  });
});

describe('intentarDesglosarDireccionLibre', () => {
  it('desglosa un patrón inequívoco', () => {
    expect(intentarDesglosarDireccionLibre('Calle 100 # 15-20')).toMatchObject({
      tipoVia: 'CL',
      numeroVia: '100',
      numeroGeneradora: '15',
      placa: '20',
    });
    expect(intentarDesglosarDireccionLibre('Cra 43A # 5-15')).toMatchObject({
      tipoVia: 'CR',
      numeroVia: '43',
      letraVia: 'A',
      placa: '15',
    });
  });

  it('devuelve null cuando hay algo más que la estructura básica', () => {
    expect(intentarDesglosarDireccionLibre('Calle 123 # 45-67, oficina 890')).toBeNull();
    expect(intentarDesglosarDireccionLibre('Avenida Chile # 72-41, piso 8')).toBeNull();
    expect(intentarDesglosarDireccionLibre('Manzana 5 casa 3')).toBeNull();
  });

  it('lo que desglosa vuelve a componer al formato DIAN', () => {
    const d = intentarDesglosarDireccionLibre('Carrera 7 # 12-45')!;
    expect(componerDireccionDian(d)).toBe('CR 7 # 12 - 45');
  });
});

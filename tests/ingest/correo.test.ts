/**
 * Pruebas puras del manejador de webhook, SPF/DKIM, límites y conversión de
 * montos. Nada aquí toca red ni base de datos.
 */
import { describe, expect, it } from 'vitest';
import { manejarWebhookCorreo, elegirBuzonDestino } from '../../src/ingest/correo/webhook.js';
import { evaluarAutenticacion, autenticacionFalla } from '../../src/ingest/correo/spf-dkim.js';
import {
  excedeLimiteTasa,
  excedeTamanoAdjunto,
  excedeTamanoCorreo,
  LIMITE_CORREOS_POR_VENTANA,
  TAMANO_MAXIMO_ADJUNTO_BYTES,
  TAMANO_MAXIMO_CORREO_BYTES,
} from '../../src/ingest/correo/limites.js';
import { parseMontoACentavos, parsePorcentaje } from '../../src/ingest/ubl/dinero.js';

describe('manejarWebhookCorreo', () => {
  it('acepta un payload bien formado y normaliza valores por defecto', () => {
    const r = manejarWebhookCorreo({
      remitenteEmail: 'proveedor@ejemplo.co',
      destinatarios: ['empresa-abc@inbox.ejemplo.co'],
      adjuntos: [{ contenidoBase64: 'PEludm9pY2UvPg==' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.correo.messageId).toBeNull();
    expect(r.correo.headers).toEqual({});
    expect(r.correo.adjuntos).toHaveLength(1);
  });

  it('rechaza un payload sin destinatarios', () => {
    const r = manejarWebhookCorreo({ remitenteEmail: 'a@b.co', destinatarios: [] });
    expect(r.ok).toBe(false);
  });

  it('rechaza un payload sin remitenteEmail', () => {
    const r = manejarWebhookCorreo({ destinatarios: ['x@y.co'] });
    expect(r.ok).toBe(false);
  });

  it('nunca lanza: un payload arbitrario (no objeto) da { ok: false }, no una excepción', () => {
    expect(() => manejarWebhookCorreo('esto no es un correo')).not.toThrow();
    expect(() => manejarWebhookCorreo(null)).not.toThrow();
    expect(manejarWebhookCorreo(undefined).ok).toBe(false);
  });
});

describe('elegirBuzonDestino', () => {
  it('elige la dirección que matchea el patrón de buzón dedicado, aunque no sea la primera', () => {
    const correo = manejarWebhookCorreo({
      remitenteEmail: 'a@b.co',
      destinatarios: ['contabilidad-cc@otrodominio.com', 'empresa-900123456@inbox.ejemplo.co'],
    });
    if (!correo.ok) throw new Error('payload inválido');
    expect(elegirBuzonDestino(correo.correo)).toBe('empresa-900123456@inbox.ejemplo.co');
  });

  it('si ninguna dirección matchea, usa la primera tal cual (en minúscula)', () => {
    const correo = manejarWebhookCorreo({
      remitenteEmail: 'a@b.co',
      destinatarios: ['Buzon-Generico@Empresa.Com'],
    });
    if (!correo.ok) throw new Error('payload inválido');
    expect(elegirBuzonDestino(correo.correo)).toBe('buzon-generico@empresa.com');
  });
});

describe('evaluarAutenticacion (SPF/DKIM)', () => {
  it('sin cabecera Authentication-Results, ambos quedan no_verificado (nunca se asume pass)', () => {
    expect(evaluarAutenticacion({})).toEqual({ spf: 'no_verificado', dkim: 'no_verificado' });
  });

  it('interpreta spf=pass y dkim=pass', () => {
    const auth = evaluarAutenticacion({
      'Authentication-Results': 'mx.ejemplo.co; spf=pass smtp.mailfrom=proveedor.co; dkim=pass header.d=proveedor.co',
    });
    expect(auth).toEqual({ spf: 'pass', dkim: 'pass' });
    expect(autenticacionFalla(auth)).toBe(false);
  });

  it('interpreta spf=fail como fallo duro', () => {
    const auth = evaluarAutenticacion({ 'authentication-results': 'mx; spf=fail; dkim=none' });
    expect(auth.spf).toBe('fail');
    expect(autenticacionFalla(auth)).toBe(true);
  });

  it('un valor no reconocido en la cabecera no se cuela: cae a no_verificado', () => {
    const auth = evaluarAutenticacion({ 'Authentication-Results': 'mx; spf=quien-sabe' });
    expect(auth.spf).toBe('no_verificado');
  });
});

describe('límites del canal (sección 10.3)', () => {
  it('tamaño de correo y de adjunto', () => {
    expect(excedeTamanoCorreo(TAMANO_MAXIMO_CORREO_BYTES)).toBe(false);
    expect(excedeTamanoCorreo(TAMANO_MAXIMO_CORREO_BYTES + 1)).toBe(true);
    expect(excedeTamanoAdjunto(TAMANO_MAXIMO_ADJUNTO_BYTES + 1)).toBe(true);
  });

  it('límite de tasa: excede en el límite exacto, no solo por encima', () => {
    expect(excedeLimiteTasa(LIMITE_CORREOS_POR_VENTANA - 1)).toBe(false);
    expect(excedeLimiteTasa(LIMITE_CORREOS_POR_VENTANA)).toBe(true);
    expect(excedeLimiteTasa(5, 5)).toBe(true);
    expect(excedeLimiteTasa(4, 5)).toBe(false);
  });
});

describe('parseMontoACentavos (Regla de Oro 5: dinero entero, nunca float)', () => {
  it('convierte un monto con dos decimales exactos', () => {
    expect(parseMontoACentavos('1190000.00')).toBe(119000000n);
  });

  it('redondea half-up cuando hay más de dos decimales', () => {
    expect(parseMontoACentavos('100.005')).toBe(10001n);
    expect(parseMontoACentavos('100.004')).toBe(10000n);
  });

  it('acepta enteros sin parte decimal', () => {
    expect(parseMontoACentavos('500')).toBe(50000n);
  });

  it('maneja el signo negativo (notas de ajuste)', () => {
    expect(parseMontoACentavos('-238000.00')).toBe(-23800000n);
  });

  it('null/undefined/vacío → null, nunca 0 disfrazado de "no hay dato"', () => {
    expect(parseMontoACentavos(null)).toBeNull();
    expect(parseMontoACentavos(undefined)).toBeNull();
    expect(parseMontoACentavos('')).toBeNull();
  });

  it('texto no numérico → null, no lanza', () => {
    expect(parseMontoACentavos('no-es-un-numero')).toBeNull();
  });
});

describe('parsePorcentaje', () => {
  it('no divide entre 100: deja el número tal como viene del XML', () => {
    expect(parsePorcentaje('19.00')).toBe(19);
    expect(parsePorcentaje('2.5')).toBe(2.5);
  });
});

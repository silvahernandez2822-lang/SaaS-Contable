/**
 * Pruebas PURAS del pipeline de parsing UBL (sección 10.2) — sin base de
 * datos. `procesarAdjuntoXml` es la frontera con A6: aquí se demuestra que
 * bytes → documento normalizado o cuarentena, de forma determinista.
 *
 * Los fixtures de `tests/fixtures/ubl/` son CONSTRUIDOS a mano por A4, fieles
 * a la estructura del anexo técnico UBL 2.1 v1.9 en lo que se pudo verificar
 * sin un XML real de la DIAN. NO son capturas de producción. El CUFE de cada
 * fixture es un sha384 de un texto de prueba: tiene la forma correcta
 * (96 hex) pero no es criptográficamente auténtico. Ver docs/reportes/ola1-a4.md.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { procesarAdjuntoXml } from '../../src/ingest/procesar.js';
import { sha256Hex } from '../../src/ingest/hash.js';

const DIR_FIXTURES = fileURLToPath(new URL('../fixtures/ubl/', import.meta.url));

function leerFixture(nombre: string): Buffer {
  return readFileSync(path.join(DIR_FIXTURES, nombre));
}

describe('procesarAdjuntoXml — Invoice directo', () => {
  const bytes = leerFixture('invoice-simple.xml');

  it('extrae tipo, CUFE, emisor, adquirente y totales', () => {
    const r = procesarAdjuntoXml(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const d = r.documento;
    expect(d.tipoDocumento).toBe('Invoice');
    expect(d.veniaEnAttachedDocument).toBe(false);
    expect(d.cufe).toBe(
      'b72bdb621c3e9ea07789eab738ada6fdbc37d7b81694472e54397c38d8b4fc65ea40182c21688f687bd7b71c30ba5932',
    );
    expect(d.numeroDocumento).toBe('SETP990000001');
    expect(d.prefijo).toBe('SETP');
    expect(d.emisor).toEqual({ nit: '900123456', nombre: 'Proveedor Fixture SAS' });
    expect(d.adquirente).toEqual({ nit: '800987654', nombre: 'Empresa Cliente Fixture SAS' });
    expect(d.fechaHechoEconomico).toBe('2026-06-15');
    expect(d.moneda).toBe('COP');
    expect(d.totales.neto).toBe(119000000n); // $1.190.000,00 en centavos
    expect(d.totales.bruto).toBe(100000000n);
    expect(d.totales.ivaTotal).toBe(19000000n);
  });

  it('extrae la línea de detalle con su impuesto discriminado', () => {
    const r = procesarAdjuntoXml(bytes);
    if (!r.ok) throw new Error('se esperaba éxito');
    expect(r.documento.lineas).toHaveLength(1);
    const linea = r.documento.lineas[0]!;
    expect(linea.cantidad).toBe(1);
    expect(linea.subtotal).toBe(100000000n);
    expect(linea.impuestos).toHaveLength(1);
    expect(linea.impuestos[0]).toMatchObject({ codigo: '01', porcentaje: 19, valor: 19000000n });
  });

  it('el hash de contenido es el sha256 EXACTO de los bytes recibidos, y es determinista', () => {
    const r1 = procesarAdjuntoXml(bytes);
    const r2 = procesarAdjuntoXml(bytes);
    if (!r1.ok || !r2.ok) throw new Error('se esperaba éxito');
    expect(r1.documento.hashContenido).toBe(sha256Hex(bytes));
    // Determinismo: reprocesar el mismo adjunto da EXACTAMENTE el mismo
    // documento normalizado (precondición del caso dorado 18).
    expect(r1.documento).toEqual(r2.documento);
  });

  it('nombreArchivo pasa tal cual desde las opciones', () => {
    const r = procesarAdjuntoXml(bytes, { nombreArchivo: 'factura-001.xml' });
    if (!r.ok) throw new Error('se esperaba éxito');
    expect(r.documento.nombreArchivo).toBe('factura-001.xml');
  });
});

describe('procesarAdjuntoXml — CreditNote directa, referenciando la factura', () => {
  it('extrae el CUFE de la factura referenciada vía BillingReference', () => {
    const r = procesarAdjuntoXml(leerFixture('credit-note-simple.xml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.documento.tipoDocumento).toBe('CreditNote');
    expect(r.documento.documentoReferenciado).toEqual({
      numero: 'SETP990000001',
      cufe: 'b72bdb621c3e9ea07789eab738ada6fdbc37d7b81694472e54397c38d8b4fc65ea40182c21688f687bd7b71c30ba5932',
    });
    expect(r.documento.totales.neto).toBe(23800000n);
  });
});

describe('procesarAdjuntoXml — ApplicationResponse (evento)', () => {
  it('extrae el evento sin exigirle CUFE propio, y referencia el documento acusado', () => {
    const r = procesarAdjuntoXml(leerFixture('application-response.xml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.documento.tipoDocumento).toBe('ApplicationResponse');
    expect(r.documento.cufe).toBeNull();
    expect(r.documento.emisor.nit).toBe('800987654');
    expect(r.documento.adquirente.nit).toBe('900123456');
    expect(r.documento.documentoReferenciado?.cufe).toBe(
      'b72bdb621c3e9ea07789eab738ada6fdbc37d7b81694472e54397c38d8b4fc65ea40182c21688f687bd7b71c30ba5932',
    );
  });
});

describe('procesarAdjuntoXml — EL CASO CRÍTICO: Invoice embebido en AttachedDocument', () => {
  it('desempaqueta un Invoice codificado en BASE64 dentro de AttachedDocument y lo causa como Invoice', () => {
    const r = procesarAdjuntoXml(leerFixture('attached-document-invoice-base64.xml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const d = r.documento;
    // El tipo causable es el INTERNO (Invoice), no el contenedor.
    expect(d.tipoDocumento).toBe('Invoice');
    expect(d.veniaEnAttachedDocument).toBe(true);
    expect(d.cufe).toBe(
      '155de0bd45e87a419c99f2cf40b889009b2efc9bbcd6636b676fb3e3ea98f633f6e024d175a64b03e054cb78d599be71',
    );
    expect(d.numeroDocumento).toBe('SETP990000002');
    expect(d.totales.neto).toBe(59500000n);
    // El XML crudo guardado es el INTERNO ya desempaquetado, no el AttachedDocument.
    expect(d.xmlCrudo.includes('<AttachedDocument')).toBe(false);
    expect(d.xmlCrudo.includes('<Invoice')).toBe(true);
  });

  it('el hash de contenido sigue siendo el del ARCHIVO COMPLETO recibido (el AttachedDocument), no el del interno', () => {
    const bytes = leerFixture('attached-document-invoice-base64.xml');
    const r = procesarAdjuntoXml(bytes);
    if (!r.ok) throw new Error('se esperaba éxito');
    expect(r.documento.hashContenido).toBe(sha256Hex(bytes));
  });

  it('también desempaqueta un Invoice embebido como XML PLANO (sin base64) dentro de AttachedDocument', () => {
    const r = procesarAdjuntoXml(leerFixture('attached-document-invoice-plano.xml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.documento.tipoDocumento).toBe('Invoice');
    expect(r.documento.veniaEnAttachedDocument).toBe(true);
    expect(r.documento.cufe).toBe(
      '91e402dd2faf66d81a9091a52aa4ae1141ebf56b3cde345526e8d54ff31d8fd0521120a8b176f73cdb4a917a61c2d758',
    );
  });
});

describe('procesarAdjuntoXml — cuarentena', () => {
  it('adjunto vacío (0 bytes) → adjunto_vacio', () => {
    const r = procesarAdjuntoXml(Buffer.alloc(0));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('adjunto_vacio');
  });

  it('adjunto por encima del tamaño máximo → tamano_excedido, sin llegar a parsear', () => {
    const bytes = leerFixture('invoice-simple.xml');
    const r = procesarAdjuntoXml(bytes, { tamanoMaximoBytes: 10 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('tamano_excedido');
  });

  it('XML mal formado → xml_mal_formado', () => {
    const r = procesarAdjuntoXml(leerFixture('roto-xml-mal-formado.xml'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('xml_mal_formado');
  });

  it('raíz de un tipo no soportado (Waybill) → no_es_ubl_reconocible', () => {
    const r = procesarAdjuntoXml(leerFixture('roto-tipo-no-soportado.xml'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('no_es_ubl_reconocible');
  });

  it('Invoice sin ninguna línea → estructura_ubl_invalida', () => {
    const r = procesarAdjuntoXml(leerFixture('roto-sin-lineas.xml'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('estructura_ubl_invalida');
    expect(r.cuarentena.erroresValidacion?.some((e) => e.includes('InvoiceLine'))).toBe(true);
  });

  it('Invoice estructuralmente válido pero SIN cbc:UUID → cufe_faltante', () => {
    const r = procesarAdjuntoXml(leerFixture('roto-sin-cufe.xml'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('cufe_faltante');
  });

  it('AttachedDocument sin cac:Attachment → contenedor_sin_documento_interno', () => {
    const r = procesarAdjuntoXml(leerFixture('roto-attached-sin-contenido.xml'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('contenedor_sin_documento_interno');
  });

  it('AttachedDocument con base64 que no decodifica a XML → base64_invalido', () => {
    const r = procesarAdjuntoXml(leerFixture('roto-attached-base64-invalido.xml'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cuarentena.motivo).toBe('base64_invalido');
  });
});

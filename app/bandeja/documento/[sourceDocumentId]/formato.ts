/**
 * A7 · D-079 — indentado legible de un XML, sin dependencias.
 *
 * No valida ni interpreta el XML: solo lo re-sangra para que un humano pueda
 * leerlo en el visor. Entrada no confiable (viene de un tercero); la salida
 * es texto plano que React escapa al renderizar dentro de `<pre><code>`.
 */
export function formatearXml(xml: string): string {
  const sinBom = xml.replace(/^﻿/, '').trim();

  // Separa cada etiqueta en su propia línea antes de re-sangrar.
  const conSaltos = sinBom
    .replace(/>\s*</g, '>\n<')
    .replace(/\r\n?/g, '\n');

  const lineas = conSaltos.split('\n');
  const salida: string[] = [];
  let nivel = 0;
  const UNIDAD = '  ';

  for (const cruda of lineas) {
    const linea = cruda.trim();
    if (linea === '') continue;

    const esCierre = /^<\//.test(linea);
    const esDeclaracion = /^<\?/.test(linea) || /^<!--/.test(linea) || /^<!/.test(linea);
    const esAutocontenido = /\/>\s*$/.test(linea);
    const abreYcierra = /^<([\w:.-]+)(\s[^>]*)?>.*<\/\1>\s*$/.test(linea);

    if (esCierre) nivel = Math.max(0, nivel - 1);

    salida.push(UNIDAD.repeat(nivel) + linea);

    if (!esCierre && !esDeclaracion && !esAutocontenido && !abreYcierra && /^<[^/]/.test(linea)) {
      nivel += 1;
    }
  }

  return salida.join('\n');
}

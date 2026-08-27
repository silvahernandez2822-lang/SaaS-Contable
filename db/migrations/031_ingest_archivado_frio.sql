-- =============================================================================
-- 031_ingest_archivado_frio.sql — A4, Ola 1: espacio reservado para archivado
-- frío del XML crudo. NO IMPLEMENTA archivado — mismo tratamiento que el
-- espacio RADIAN de 008_documentos.sql.
--
-- Origen: A15 (revisión de presupuesto de la Ola 0) calculó que el XML crudo
-- conservado 10 años (art. 28 Ley 962/2005, reproducción exacta) rompe el
-- techo de USD 20–50/mes en Postgres transaccional hacia el año 7–10 (~60
-- empresas × 300 facturas/mes × 35 KB ≈ 75,6 GB crudos a 10 años). La
-- exigencia, dirigida a A2 y A4: `source_document` debe poder mover el XML a
-- almacenamiento frío (S3/R2/B2) dejando un puntero y un hash de integridad,
-- SIN que el parser ni el modelo tengan que cambiar el día que eso se active.
--
-- Lo que esta migración agrega, y nada más:
--   - `xml_almacenamiento`: dónde vive el XML AHORA MISMO. 'bd' es el único
--     valor real hoy (el 100% de lo que A4 escribe en la Ola 1 va a
--     `xml_crudo`). 'archivo_frio' queda declarado, sin código que lo
--     produzca: ninguna fila de la Ola 1 llegará con ese valor.
--   - `xml_archivo_url` y `xml_archivado_en`: puntero y fecha del archivado,
--     NULL siempre en la Ola 1.
--   - Reutiliza `hash_contenido` (008_documentos.sql) como el hash de
--     integridad que exige la "reproducción exacta": es un sha256 del XML tal
--     como se recibió, ya obligatorio y ya UNIQUE por empresa. No se agrega un
--     segundo hash porque sería una segunda fuente de verdad para la misma
--     garantía.
--   - El CHECK impone la única regla que puede violarse sin código de
--     archivado: si algo dice 'archivo_frio', tiene que traer dónde está.
--
-- Lo que esta migración NO hace, a propósito: no contrata ni configura ningún
-- proveedor de almacenamiento, no instala SDK de S3, no mueve un solo byte de
-- `xml_crudo` fuera de la base, y no borra `xml_crudo` de ninguna fila
-- existente. Ese trabajo es de una ola posterior (A6/A15), igual que RADIAN es
-- de una ola posterior.
--
-- Consecuencia para quien lea el XML (A4, A6, A9, A10 exógena): usar
-- `leerXmlDocumento` de `src/ingest/almacenamiento.ts` en vez de leer
-- `xml_crudo` directamente. Hoy esa función solo mira `xml_crudo`, porque no
-- hay ninguna fila archivada; el día que la haya, cambia una función, no cada
-- llamador.
-- =============================================================================

ALTER TABLE source_document
  ADD COLUMN xml_almacenamiento text NOT NULL DEFAULT 'bd'
    CHECK (xml_almacenamiento IN ('bd', 'archivo_frio')),
  ADD COLUMN xml_archivo_url    text,
  ADD COLUMN xml_archivado_en   timestamptz,
  ADD CONSTRAINT source_document_archivo_ck
    CHECK (xml_almacenamiento <> 'archivo_frio'
           OR (xml_archivo_url IS NOT NULL AND xml_archivado_en IS NOT NULL));

COMMENT ON COLUMN source_document.xml_almacenamiento IS
  'Dónde vive el XML crudo ahora mismo. Reservado para archivado frío (A15, presupuesto de la Ola 0): en la Ola 1 SIEMPRE es ''bd'' — ninguna fila se archiva todavía. No implementado, solo reservado, igual que radian_estado en 008_documentos.sql.';
COMMENT ON COLUMN source_document.xml_archivo_url IS
  'Puntero al objeto en almacenamiento frío (p. ej. clave S3/R2/B2). NULL mientras xml_almacenamiento = ''bd''. No hay proveedor contratado ni SDK instalado: esto es solo el espacio.';
COMMENT ON CONSTRAINT source_document_archivo_ck ON source_document IS
  'Si el documento dice estar archivado, tiene que traer dónde. hash_contenido (ya obligatorio y UNIQUE por empresa) es el hash de integridad que demuestra reproducción exacta al recuperarlo — no se duplica en una columna nueva.';

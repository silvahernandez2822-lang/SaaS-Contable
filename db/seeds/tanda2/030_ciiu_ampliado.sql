-- =============================================================================
-- 030_ciiu_ampliado.sql — Agente A1, Ola 1, Tanda 2 (secciones 7.3 y 7.8)
--
-- Catálogo CIIU (identidad, sin tarifa) ampliado sobre el único código de
-- tanda 1 (7490). El CIIU 4 A.C. tiene del orden de 1.500 clases; esto NO es
-- el catálogo completo, es la identidad de los códigos que la sección 7.3
-- cita explícitamente para autorretención (4711, 7110, 0510, 6411), más un
-- puñado de códigos adicionales de alta confianza para no dejar el catálogo
-- reducido a un solo renglón.
--
-- Sobre 6411: la sección 7.3 lo etiqueta "Servicios financieros". A1 usa
-- literalmente esa etiqueta porque es la que trae la fuente, aunque el
-- nombre oficial de 6411 en el CIIU 4 A.C. de Colombia podría ser más
-- específico ("Banco Central" en algunas versiones de la clasificación) —
-- queda marcado para verificación humana precisamente por esa duda.
-- =============================================================================

INSERT INTO ciiu_activity (tenant_id, company_id, codigo, nombre, seccion, division)
SELECT NULL, NULL, v.codigo, v.nombre, v.seccion, v.division
FROM (VALUES
  ('4711', 'Comercio al por menor en establecimientos no especializados con surtido compuesto principalmente por alimentos, bebidas o tabaco', 'G', '47'),
  ('7110', 'Actividades de arquitectura e ingeniería y otras actividades conexas de consultoría técnica', 'M', '71'),
  ('0510', 'Extracción de hulla (carbón de piedra)', 'B', '05'),
  ('6411', 'Servicios financieros', 'K', '64'), -- ver nota de verificación arriba
  ('5611', 'Expendio a la mesa de comidas preparadas', 'I', '56'),
  ('6201', 'Actividades de desarrollo de sistemas informáticos (planificación, análisis, diseño, programación, pruebas)', 'J', '62')
) AS v(codigo, nombre, seccion, division)
WHERE NOT EXISTS (
  SELECT 1 FROM ciiu_activity e WHERE e.tenant_id IS NULL AND e.company_id IS NULL AND e.codigo = v.codigo
);

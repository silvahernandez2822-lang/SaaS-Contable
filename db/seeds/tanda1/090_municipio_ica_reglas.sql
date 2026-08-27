-- =============================================================================
-- 090_municipio_ica_reglas.sql — Agente A1, Ola 1, Tanda 1 (sección 7.5)
--
-- Bases mínimas de servicios/compras y la regla de tarifa (si usa la de la
-- actividad o una tarifa general única) para Bogotá, Medellín y Cali.
--
-- `periodicidad` NO está dada por la sección 7.5 para ninguna de las tres
-- ciudades (solo trae base, tarifa y norma). Se deja el valor por defecto del
-- esquema ('mensual') y CADA FILA se marca `requiere_verificacion_humana =
-- true` por ese único campo — bases y tarifa sí están respaldadas y no
-- deberían bloquearse por esto, pero el contrato de la tabla (advertencia
-- 17.5) es que un campo sin verificar se declara, no se calla.
--
-- Bogotá y Cali resuelven la tarifa por actividad económica (`tax_rule` tipo
-- 'reteica'), y esa tabla NO se carga en la tanda 1: ver el hallazgo
-- estructural en 020_ciiu_minimo.sql (desajuste de dígitos CIIU) y la falta
-- de la tabla completa de Cali (Acuerdo 0321 de 2011) en la sección 7. Cali
-- queda además en la lista de pendientes.
-- =============================================================================

-- Bogotá — 4 UVT servicios, 27 UVT compras, tarifa de la actividad.
INSERT INTO municipality_ica_rule (
  tenant_id, company_id, municipality_id, practica_reteica,
  base_minima_servicios_uvt, base_minima_compras_uvt,
  usa_tarifa_de_actividad, tarifa_general, periodicidad,
  vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana, notas
)
SELECT NULL, NULL, m.id, true,
       4, 27,
       true, NULL, 'mensual',
       DATE '2026-01-01', NULL,
       'Decreto 352 de 2002 (ETD Bogotá); calendario Resolución SDH-000195 de 2025. Sección 7.5.',
       true,
       'periodicidad no confirmada por la sección 7.5 (se usó el valor por defecto del esquema); la tarifa por actividad (CIIU/código municipal) no se cargó — ver 020_ciiu_minimo.sql.'
FROM municipality m
WHERE m.tenant_id IS NULL AND m.codigo_dane = '11001'
  AND NOT EXISTS (
    SELECT 1 FROM municipality_ica_rule r
    WHERE r.municipality_id = m.id AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- Medellín — 15 UVT servicios y compras, tarifa GENERAL 2‰ (no usa la de la actividad).
INSERT INTO municipality_ica_rule (
  tenant_id, company_id, municipality_id, practica_reteica,
  base_minima_servicios_uvt, base_minima_compras_uvt,
  usa_tarifa_de_actividad, tarifa_general, periodicidad,
  vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana, notas
)
SELECT NULL, NULL, m.id, true,
       15, 15,
       false, 0.002000, 'mensual',
       DATE '2026-01-01', NULL,
       'Acuerdo 066 de 2017 (Medellín). Sección 7.5.',
       true,
       'periodicidad no confirmada por la sección 7.5 (se usó el valor por defecto del esquema). La regla general del 2‰ sí está dada explícitamente y no requiere tabla de actividad.'
FROM municipality m
WHERE m.tenant_id IS NULL AND m.codigo_dane = '05001'
  AND NOT EXISTS (
    SELECT 1 FROM municipality_ica_rule r
    WHERE r.municipality_id = m.id AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- Cali — 3 UVT servicios, 15 UVT compras, tarifa de la actividad (100% de la tarifa ICA).
INSERT INTO municipality_ica_rule (
  tenant_id, company_id, municipality_id, practica_reteica,
  base_minima_servicios_uvt, base_minima_compras_uvt,
  usa_tarifa_de_actividad, tarifa_general, periodicidad,
  vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana, notas
)
SELECT NULL, NULL, m.id, true,
       3, 15,
       true, NULL, 'mensual',
       DATE '2026-01-01', NULL,
       'Acuerdo 0321 de 2011 (Cali). Sección 7.5.',
       true,
       'periodicidad no confirmada por la sección 7.5 (se usó el valor por defecto del esquema); la tabla de tarifas por actividad del Acuerdo 0321 de 2011 no viene en la sección 7 y no se cargó — ver pendientes del reporte.'
FROM municipality m
WHERE m.tenant_id IS NULL AND m.codigo_dane = '76001'
  AND NOT EXISTS (
    SELECT 1 FROM municipality_ica_rule r
    WHERE r.municipality_id = m.id AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

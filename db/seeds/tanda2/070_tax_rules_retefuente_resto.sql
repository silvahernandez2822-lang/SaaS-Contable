-- =============================================================================
-- 070_tax_rules_retefuente_resto.sql — Agente A1, Ola 1, Tanda 2 (sección 7.2)
--
-- Completa la tabla de la sección 7.2 con los conceptos que NO hacían falta
-- para el conjunto mínimo de la tanda 1: productos agrícolas, combustibles,
-- rendimientos financieros, servicios integrales de salud y hoteles y
-- restaurantes.
--
-- Usa `tax_rule.comparador_base_minima` (columna añadida por A3 en la
-- migración 050, ver comentario ahí): productos agrícolas retiene "más de
-- 70 UVT" (estrictamente mayor), no "desde 70 UVT" — es la única fila de
-- toda la sección 7.2 con ese comparador distinto del que trae el DEFAULT.
--
-- La tabla progresiva de salarios (art. 383 ET) NO se carga: la sección 7
-- solo da el umbral de base (>95 UVT) y el rango de tarifas (19%-39%), no
-- los tramos marginales completos que exige `rango_desde_uvt` /
-- `rango_hasta_uvt` / `uvt_adicionales`. Inventar esos tramos de memoria es
-- precisamente lo que prohíbe la regla 17.5 para una tabla que golpea
-- directamente la nómina de cada empresa. Queda en pendientes.
-- =============================================================================

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', v.codigo, v.nombre, v.descripcion
FROM (VALUES
  ('productos_agricolas', 'Productos agrícolas o pecuarios sin procesamiento industrial', 'Base mínima superior a 70 UVT (comparador "mayor", no "mayor o igual"). Decreto 572 de 2025.'),
  ('combustibles', 'Combustibles derivados del petróleo', 'Sin base mínima especificada en la sección 7.2. Decreto 572 de 2025.'),
  ('rendimientos_financieros_generales', 'Rendimientos financieros generales', 'Retiene desde el primer peso. No modificado por el Decreto 572 de 2025.'),
  ('rendimientos_titulos_renta_fija', 'Rendimientos de títulos de renta fija (CDT/CDAT)', 'Sin base mínima especificada en la sección 7.2.'),
  ('servicios_integrales_salud', 'Servicios integrales de salud', 'Base mínima 2 UVT. Decreto 572 de 2025.'),
  ('hoteles_restaurantes', 'Hoteles y restaurantes', 'Base mínima 2 UVT. Decreto 572 de 2025.')
) AS v(codigo, nombre, descripcion)
WHERE NOT EXISTS (
  SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = v.codigo
);

-- Productos agrícolas — 1,5%, MÁS de 70 UVT (comparador 'mayor').
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt, comparador_base_minima,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.015000, 70, 'mayor',
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026. Sección 7.2 ("productos agrícolas/pecuarios sin proceso industrial", base ">70 UVT").'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'productos_agricolas'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

-- Combustibles — 0,1%, sin base mínima dada.
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.001000, NULL,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026. Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'combustibles'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

-- Rendimientos financieros generales — 7%, desde el primer peso. No modificado por el 572.
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.070000, 0,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Decreto 1625 de 2016 (DUT); no modificado por el Decreto 572 de 2025 (nota expresa sección 7.2). Fecha de vigencia usada como cota conocida.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'rendimientos_financieros_generales'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

-- Rendimientos títulos de renta fija (CDT/CDAT) — 4%.
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo, notas
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.040000, NULL,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Sección 7.2. Fecha de vigencia usada como cota conocida (Decreto 1625 de 2016, DUT), no como fecha de origen certificada.',
       'La sección 7.2 no aclara si este concepto está entre los que el Decreto 572 dejó sin modificar; se trató igual que rendimientos financieros generales por prudencia. Verificar.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'rendimientos_titulos_renta_fija'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

-- Servicios integrales de salud — 2%, base 2 UVT.
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.020000, 2,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026. Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'servicios_integrales_salud'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

-- Hoteles y restaurantes — 3,5%, base 2 UVT.
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.035000, 2,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026. Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'hoteles_restaurantes'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

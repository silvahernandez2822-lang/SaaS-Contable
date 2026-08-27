-- =============================================================================
-- 070_tax_rules_reteiva.sql — Agente A1, Ola 1, Tanda 1 (sección 7.4)
--
-- `aplica_sobre = 'valor_iva'`: la tarifa se calcula sobre el IVA de la
-- factura, no sobre la base gravable (regla crítica de la sección 7.4 y del
-- caso dorado 1: ReteIVA 15% sobre $190.000 de IVA, no sobre $1.000.000).
--
-- Vigencia usada como cota conocida (1-ene-2016, Decreto 1625 de 2016, DUT):
-- el art. 437-1 ET y su tarifa del 15% son de larga data y no aparecen en la
-- sección 7.4 con una fecha de reforma específica. A1 no certifica que esa
-- sea la fecha de origen legal, solo que basta para cubrir los casos dorados.
-- =============================================================================

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'reteiva', 0.150000, NULL,
       'valor_iva', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Art. 437-1 ET (sección 7.4 del mega-prompt). Techo legal 50%. Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'reteiva' AND tc.codigo = 'reteiva_general'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2367'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'reteiva' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'reteiva', 1.000000, NULL,
       'valor_iva', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Art. 437-2 ET numerales 3 y 8 (sección 7.4 del mega-prompt): no residentes/no domiciliados, servicios digitales desde el exterior, y bienes especiales (chatarra, tabaco, papel para reciclar). Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'reteiva' AND tc.codigo = 'reteiva_exterior'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2367'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'reteiva' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

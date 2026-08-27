-- =============================================================================
-- 060_iva.sql — Agente A1, Ola 1, Tanda 2 (sección 7.6)
--
-- Tarifas de IVA: general 19%, reducida 5%, exenta 0% (con derecho a
-- descontable, arts. 477/481 ET). Cuenta PUC: 2408 (impuesto sobre las
-- ventas por pagar).
--
-- Vigencia: 19% general se usa desde 2017-01-01, fecha ampliamente conocida
-- de la reforma de la Ley 1819 de 2016 que llevó la tarifa general del 16%
-- al 19%. Reducida y exenta usan 2016-01-01 (DUT) como cota conocida, sin
-- certificar que sea la fecha exacta de origen de esas tarifas.
--
-- PENDIENTE ESTRUCTURAL (no una fila, una nota): el criterio de periodicidad
-- del art. 600 ET —bimestral si los ingresos brutos del año anterior fueron
-- >= 92.000 UVT, cuatrimestral en los demás casos, bimestral obligatorio el
-- primer año para responsables nuevos— es una REGLA DE ELEGIBILIDAD sobre el
-- historial de ingresos de la empresa, no una tarifa ni una fecha de
-- vencimiento. Ninguna tabla del esquema congelado la representa limpiamente
-- (no es `tax_rule`, que es tarifa+base; no es `tax_calendar`, que es fecha
-- de vencimiento dado un período ya asignado). A1 no fuerza el dato en una
-- tabla que no le corresponde: queda documentada aquí en texto para que A2 o
-- A6 decidan dónde vive (candidato: un campo en `company_setting`, o una
-- tabla nueva de "criterio de periodicidad", si hace falta materializarla).
-- =============================================================================

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'iva', v.codigo, v.nombre, v.descripcion
FROM (VALUES
  ('iva_general', 'IVA — tarifa general', 'Tarifa general del 19%. Sección 7.6.'),
  ('iva_reducida', 'IVA — tarifa reducida', 'Tarifa reducida del 5% (art. 468-1 ET). Sección 7.6.'),
  ('iva_exenta', 'IVA — bienes y servicios exentos', 'Tarifa 0%, con derecho a impuestos descontables (arts. 477/481 ET). Distinto de "excluido", que no da derecho a descontable. Sección 7.6.')
) AS v(codigo, nombre, descripcion)
WHERE NOT EXISTS (
  SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'iva' AND codigo = v.codigo
);

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'iva', 0.190000, NULL,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2017-01-01', NULL,
       'Ley 1819 de 2016 (tarifa general del IVA al 19%, vigente desde 2017). Sección 7.6.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'iva' AND tc.codigo = 'iva_general'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2408'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'iva', 0.050000, NULL,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Art. 468-1 ET (tarifa reducida). Sección 7.6. Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'iva' AND tc.codigo = 'iva_reducida'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2408'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta, norma_respaldo
)
SELECT NULL, NULL, tc.id, 'iva', 0.000000, NULL,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Arts. 477/481 ET (exentos, con derecho a descontable). Sección 7.6. Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'iva' AND tc.codigo = 'iva_exenta'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2408'
  AND NOT EXISTS (SELECT 1 FROM tax_rule r WHERE r.tax_concept_id = tc.id AND r.tenant_id IS NULL AND r.company_id IS NULL);

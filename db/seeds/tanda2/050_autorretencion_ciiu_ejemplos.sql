-- =============================================================================
-- 050_autorretencion_ciiu_ejemplos.sql — Agente A1, Ola 1, Tanda 2 (sección 7.3)
--
-- La sección 7.3 es explícita: los cuatro valores que trae son "valores de
-- referencia" y dice textualmente que "A1 debe verificar la tabla completa
-- contra fuente DIAN antes de producción". NO es la tabla completa de
-- autorretención por CIIU (esa tabla, por Resolución DIAN 139 de 2012 y sus
-- modificatorias, tiene decenas de tarifas por actividad). Por eso las
-- cuatro filas se cargan CON `requiere_verificacion_humana = true`, no como
-- dato cerrado.
--
-- La autorretención es un ANTICIPO del propio contribuyente, no una deuda
-- con un tercero: se registra como activo (1355, anticipo de impuestos), no
-- como pasivo (2365 es para retenciones PRACTICADAS a terceros).
-- =============================================================================

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'autorretencion', 'autorretencion_renta_ciiu',
       'Autorretención especial de renta por CIIU de actividad principal',
       'Decreto 2201 de 2016. Aplica a sociedades nacionales exoneradas de aportes (art. 114-1 ET). Tarifa según CIIU de actividad principal (Resolución DIAN 139 de 2012 y modificatorias). Declaración mensual, formulario 350.'
WHERE NOT EXISTS (
  SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'autorretencion' AND codigo = 'autorretencion_renta_ciiu'
);

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, ciiu_activity_id, account_id,
  vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana, notas
)
SELECT NULL, NULL, tc.id, 'autorretencion', v.tarifa, NULL,
       'base_gravable', 'ambos', 'juridica', ci.id, acc.id,
       DATE '2026-07-01', NULL,
       'Decreto 2201 de 2016; tarifas del Decreto 572 de 2025 desde el 1-jul-2026. CIIU según Resolución DIAN 139 de 2012 y modificatorias. Sección 7.3: valor de REFERENCIA, no la tabla completa.',
       true,
       'A1 no cargó la tabla completa de autorretención por CIIU: la sección 7.3 trae 4 ejemplos, no el listado de la Resolución DIAN 139 de 2012. Verificar contra fuente DIAN antes de producción.'
FROM tax_concept tc
CROSS JOIN (VALUES
  ('4711', 0.011000),
  ('7110', 0.022000),
  ('0510', 0.032000),
  ('6411', 0.044000)
) AS v(codigo, tarifa)
JOIN ciiu_activity ci ON ci.tenant_id IS NULL AND ci.company_id IS NULL AND ci.codigo = v.codigo
JOIN account acc ON acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '1355'
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'autorretencion' AND tc.codigo = 'autorretencion_renta_ciiu'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'autorretencion' AND r.ciiu_activity_id = ci.id
      AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

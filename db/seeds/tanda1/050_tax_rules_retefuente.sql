-- =============================================================================
-- 050_tax_rules_retefuente.sql — Agente A1, Ola 1, Tanda 1
--
-- Tarifas y bases mínimas del Decreto 572 de 2025 (vigente desde el 1-jul-2026
-- tras la revocatoria de la suspensión — auto del 2-jun-2026, exp. 30229;
-- DIAN Comunicado 070 del 8-may-2026), sección 7.2 del mega-prompt.
--
-- ADVERTENCIA PARA A3 (caso dorado 16, "aplica la vigencia de junio"):
-- para los conceptos que el Decreto 572 SÍ modificó (servicios generales,
-- compras generales, arrendamiento de inmuebles, transporte, temporales,
-- vigilancia) NO existe aquí una vigencia anterior al 1-jul-2026. La sección 7
-- solo trae la tabla posterior al decreto; A1 no inventa las tarifas/bases
-- vigentes antes de esa fecha (regla 17.5). El caso dorado 16, tal como está
-- redactado, queda BLOQUEADO para estos conceptos hasta que un humano aporte
-- esas tarifas históricas. Alternativa práctica para no bloquear a A3: probar
-- la resolución por fecha con `uvt_value` (2025 vs. 2026), que sí tiene ambas
-- vigencias cargadas y verificadas, o construir una vigencia sintética
-- claramente marcada como dato de prueba (no de producción) dentro de la
-- propia suite de A3/A14.
--
-- Los cuatro conceptos que el Decreto 572 NO modificó (honorarios, comisiones,
-- arrendamiento de muebles) usan como `vigente_desde` el 1-ene-2016, fecha de
-- compilación del Decreto Único Tributario (Decreto 1625 de 2016). A1 NO
-- certifica que esa sea la fecha de origen legal de la tarifa (probablemente
-- es anterior); se usa como una cota conocida y verificable que basta para
-- cubrir cualquier fecha de hecho económico de los casos dorados.
--
-- Todas las tarifas como FRACCIÓN (D-005): 4% = 0.040000.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Servicios generales — 4% declarante (PJ o PN declarante) / 6% PN no declarante
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.040000, 2,
       'base_gravable', 'declarante', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025 (DUT, Decreto 1625 de 2016); vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229; DIAN Comunicado 070/2026-05-08). Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'servicios_generales'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.aplica_a = 'declarante'
      AND r.tipo_persona = 'ambos' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.060000, 2,
       'base_gravable', 'no_declarante', 'natural', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025 (DUT, Decreto 1625 de 2016); vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229; DIAN Comunicado 070/2026-05-08). Sección 7.2 ("servicios a PN no declarante").'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'servicios_generales'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.aplica_a = 'no_declarante'
      AND r.tipo_persona = 'natural' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Compras generales — 2,5% declarante / 3,5% no declarante
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.025000, 10,
       'base_gravable', 'declarante', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'compras_generales'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.aplica_a = 'declarante'
      AND r.tipo_persona = 'ambos' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.035000, 10,
       'base_gravable', 'no_declarante', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'compras_generales'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.aplica_a = 'no_declarante'
      AND r.tipo_persona = 'ambos' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Honorarios y comisiones — PJ 11% / PN 10% (ver nota en 040 sobre la escalada
-- a 11% por acumulación anual >3.300 UVT, que A1 NO representa como fila).
-- No modificados por el Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.110000, 0,
       'base_gravable', 'ambos', 'juridica', acc.id, DATE '2016-01-01', NULL,
       'Decreto 1625 de 2016 (DUT); no modificado por el Decreto 572 de 2025 (nota expresa de la sección 7.2). Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'honorarios_pj'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo, notas
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.100000, 0,
       'base_gravable', 'ambos', 'natural', acc.id, DATE '2016-01-01', NULL,
       'Decreto 1625 de 2016 (DUT); no modificado por el Decreto 572 de 2025 (nota expresa de la sección 7.2). Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.',
       'Tarifa base 10%. Sube a 11% si los contratos con el mismo contratante superan 3.300 UVT en el año gravable (umbral acumulado anual, no representable en base_minima_uvt de una sola factura). Resolución de esa escalada es responsabilidad del motor (A3).'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'honorarios_pn'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Arrendamiento de bienes muebles — 4%, desde el primer peso. No modificado
-- por el Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.040000, 0,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2016-01-01', NULL,
       'Decreto 1625 de 2016 (DUT); no modificado por el Decreto 572 de 2025 (nota expresa de la sección 7.2). Fecha de vigencia usada como cota conocida, no como fecha de origen certificada.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'arrendamiento_muebles'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Arrendamiento de bienes inmuebles — 3,5%, base 10 UVT. Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.035000, 10,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'arrendamiento_inmuebles'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Transporte de carga — 1%, base 2 UVT. Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.010000, 2,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'transporte_carga'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Transporte de pasajeros — 3,5%, base 10 UVT. Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.035000, 10,
       'base_gravable', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2.'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'transporte_pasajeros'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Servicios temporales de empleo — 1% SOBRE EL AIU, base 2 UVT. Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.010000, 2,
       'aiu', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2. Base = AIU, no el valor total del contrato (sección 9.3 / caso dorado 11).'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'servicios_temporales'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- -----------------------------------------------------------------------------
-- Vigilancia y aseo — 2% SOBRE EL AIU, base 2 UVT. Decreto 572.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
  aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, vigente_hasta,
  norma_respaldo
)
SELECT NULL, NULL, tc.id, 'retefuente', 0.020000, 2,
       'aiu', 'ambos', 'ambos', acc.id, DATE '2026-07-01', NULL,
       'Decreto 572 de 2025; vigente desde 1-jul-2026 (auto 2-jun-2026, exp. 30229). Sección 7.2. Base = AIU, no el valor total del contrato (caso dorado 11).'
FROM tax_concept tc, account acc
WHERE tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'retefuente' AND tc.codigo = 'vigilancia_aseo'
  AND acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM tax_rule r
    WHERE r.tax_concept_id = tc.id AND r.tipo = 'retefuente' AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

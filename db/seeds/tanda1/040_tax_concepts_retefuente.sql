-- =============================================================================
-- 040_tax_concepts_retefuente.sql — Agente A1, Ola 1, Tanda 1
--
-- Identidad estable (D-013) de los conceptos de retefuente que citan los 20
-- casos dorados de la sección 12. Sin tarifa: la tarifa va en tax_rule
-- (050_tax_rules_retefuente.sql).
-- =============================================================================

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'servicios_generales',
       'Servicios generales',
       'Servicios prestados por PJ o PN declarante (4%) o PN no declarante (6%). Decreto 572 de 2025, sección 7.2.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'servicios_generales');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'compras_generales',
       'Compras generales de bienes',
       'Compra de bienes muebles/inmuebles no sometidos a tarifa especial. Declarante 2,5%, no declarante 3,5%.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'compras_generales');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'honorarios_pj',
       'Honorarios y comisiones a persona jurídica',
       'Retiene desde el primer peso, sin base mínima. No modificado por el Decreto 572 de 2025.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'honorarios_pj');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'honorarios_pn',
       'Honorarios y comisiones a persona natural',
       'Tarifa general 10%; sube a 11% si los contratos con el mismo contratante superan 3.300 UVT en el año '
       || 'gravable — umbral ACUMULADO ANUAL, no una base por factura. A1 solo carga la tarifa base (10%); la '
       || 'escalada a 11% por acumulación es responsabilidad del motor de reglas (A3), no de una fila de tax_rule '
       || 'adicional, porque no hay forma de expresar "acumulado del año" como base_minima_uvt de una sola factura.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'honorarios_pn');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'arrendamiento_muebles',
       'Arrendamiento de bienes muebles',
       'Retiene desde el primer peso, sin base mínima. No modificado por el Decreto 572 de 2025.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'arrendamiento_muebles');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'arrendamiento_inmuebles',
       'Arrendamiento de bienes inmuebles',
       'Base mínima 10 UVT. Decreto 572 de 2025.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'arrendamiento_inmuebles');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'transporte_carga',
       'Transporte de carga',
       'Base mínima 2 UVT. Decreto 572 de 2025.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'transporte_carga');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'transporte_pasajeros',
       'Transporte de pasajeros',
       'Base mínima 10 UVT. Decreto 572 de 2025.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'transporte_pasajeros');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'servicios_temporales',
       'Servicios temporales de empleo',
       'La base es el AIU (administración, imprevistos y utilidad), NO el valor total del contrato. Base mínima 2 UVT sobre el AIU.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'servicios_temporales');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'retefuente', 'vigilancia_aseo',
       'Vigilancia y aseo',
       'La base es el AIU, NO el valor total del contrato. Base mínima 2 UVT sobre el AIU.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'retefuente' AND codigo = 'vigilancia_aseo');

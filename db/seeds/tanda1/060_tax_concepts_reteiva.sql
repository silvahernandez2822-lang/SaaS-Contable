-- =============================================================================
-- 060_tax_concepts_reteiva.sql — Agente A1, Ola 1, Tanda 1 (sección 7.4)
-- =============================================================================

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'reteiva', 'reteiva_general',
       'Retención de IVA — tarifa general',
       '15% del valor del IVA de la factura (art. 437-1 ET). Se calcula sobre el IVA, no sobre la base gravable.'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'reteiva' AND codigo = 'reteiva_general');

INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'reteiva', 'reteiva_exterior',
       'Retención de IVA — 100% (exterior y bienes especiales)',
       'Servicios gravados prestados por no residentes/no domiciliados y prestadores de servicios digitales desde '
       || 'el exterior (art. 437-2 ET numerales 3 y 8); también bienes especiales (chatarra, tabaco, papel para '
       || 'reciclar). El motor (A3) debe decidir cuándo aplica este concepto en vez de reteiva_general usando '
       || 'third_party.es_del_exterior u otro discriminador equivalente: tax_rule no lleva una columna dedicada '
       || 'a "es del exterior".'
WHERE NOT EXISTS (SELECT 1 FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'reteiva' AND codigo = 'reteiva_exterior');

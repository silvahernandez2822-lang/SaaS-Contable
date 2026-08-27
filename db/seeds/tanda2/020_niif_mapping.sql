-- =============================================================================
-- 020_niif_mapping.sql — Agente A1, Ola 1, Tanda 2 (sección 7.8)
--
-- Mapeo NIIF para PYMES de una selección de cuentas del PUC operativo
-- cargado en 010_puc_operativo.sql. Mismo alcance parcial: cubre las cuentas
-- más comunes, no las 2.470 del decreto. `requiere_verificacion_humana =
-- true` en toda fila: es clasificación general por naturaleza del rubro, no
-- una revisión cuenta por cuenta contra el Marco Técnico Normativo.
--
-- Norma de respaldo: Decreto 2420 de 2015 (Marco Técnico Normativo para
-- las NIIF para las PYMES, Anexo 2), sección 7.8 del mega-prompt.
-- =============================================================================

INSERT INTO niif_mapping (tenant_id, company_id, account_id, clasificacion_niif, vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana)
SELECT NULL, NULL, a.id, v.clasificacion, DATE '2016-01-01', NULL,
       'Decreto 2420 de 2015 (NIIF para las PYMES, Anexo 2); clasificación general por naturaleza del rubro, sección 7.8.',
       true
FROM (VALUES
  ('1105', 'activo_corriente'), ('1110', 'activo_corriente'), ('1120', 'activo_corriente'),
  ('1305', 'activo_corriente'), ('1355', 'activo_corriente'), ('1365', 'activo_corriente'), ('1380', 'activo_corriente'),
  ('1435', 'activo_corriente'),
  ('1504', 'activo_no_corriente'), ('1516', 'activo_no_corriente'), ('1524', 'activo_no_corriente'),
  ('1528', 'activo_no_corriente'), ('1540', 'activo_no_corriente'), ('1592', 'activo_no_corriente'),
  ('1605', 'activo_no_corriente'), ('1610', 'activo_no_corriente'), ('1698', 'activo_no_corriente'),
  ('1705', 'activo_corriente'),
  ('2105', 'pasivo_corriente'),
  ('2205', 'pasivo_corriente'), ('2210', 'pasivo_corriente'),
  ('2335', 'pasivo_corriente'), ('2355', 'pasivo_corriente'), ('2360', 'pasivo_corriente'),
  ('2365', 'pasivo_corriente'), ('2367', 'pasivo_corriente'), ('2368', 'pasivo_corriente'),
  ('2370', 'pasivo_corriente'), ('2380', 'pasivo_corriente'),
  ('2404', 'pasivo_corriente'), ('2408', 'pasivo_corriente'), ('2412', 'pasivo_corriente'),
  ('2505', 'pasivo_corriente'), ('2510', 'pasivo_corriente'), ('2515', 'pasivo_corriente'),
  ('2520', 'pasivo_corriente'), ('2525', 'pasivo_corriente'),
  ('2610', 'pasivo_corriente'), ('2615', 'pasivo_corriente'),
  ('2705', 'pasivo_corriente'), ('2805', 'pasivo_corriente'),
  ('3105', 'patrimonio'), ('3205', 'patrimonio'), ('3305', 'patrimonio'),
  ('3605', 'patrimonio'), ('3705', 'patrimonio'),
  ('4135', 'ingreso'), ('4155', 'ingreso'), ('4210', 'ingreso'), ('4245', 'ingreso'),
  ('5105', 'gasto'), ('5110', 'gasto'), ('5120', 'gasto'), ('5135', 'gasto'), ('5195', 'gasto'),
  ('5205', 'gasto'), ('5220', 'gasto'), ('5235', 'gasto'),
  ('5305', 'gasto'), ('5395', 'gasto'), ('5405', 'gasto'),
  ('6135', 'costo'), ('6155', 'costo'), ('6205', 'costo'),
  ('7105', 'costo'), ('7205', 'costo'), ('7305', 'costo'), ('7405', 'costo')
) AS v(codigo, clasificacion)
JOIN account a ON a.tenant_id IS NULL AND a.company_id IS NULL AND a.codigo = v.codigo
WHERE NOT EXISTS (
  SELECT 1 FROM niif_mapping m WHERE m.tenant_id IS NULL AND m.company_id IS NULL AND m.account_id = a.id
);

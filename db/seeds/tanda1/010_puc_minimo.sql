-- =============================================================================
-- 010_puc_minimo.sql — Agente A1, Ola 1, Tanda 1
--
-- Subconjunto MÍNIMO del PUC (Decreto 2650 de 1993) necesario para que las
-- reglas de retención de la tanda 1 tengan una cuenta contable a la cual
-- apuntar (`tax_rule.account_id`). El PUC COMPLETO es tarea de la tanda 2
-- (ver db/seeds/tanda2/010_puc_operativo.sql) y de ninguna manera pretende
-- sustituir la transcripción íntegra de las 2.470 cuentas del decreto.
--
-- Alcance global (tenant_id IS NULL, company_id IS NULL) — catálogo híbrido,
-- D-015. Debe cargarse con `asAdmin` / rol superusuario.
--
-- Norma de respaldo de TODA fila de esta tabla: Decreto 2650 de 1993, Plan
-- Único de Cuentas para Comerciantes. Es catálogo estructural estable (no una
-- tarifa que cambie por vigencia), pero de todas formas se marca
-- requiere_verificacion_humana = true porque A1 lo reconstruyó de memoria a
-- partir de la codificación estándar y no transcribiendo el texto oficial del
-- decreto: un contador debe cotejarlo contra el decreto antes de producción.
--
-- Idempotente: cada INSERT usa WHERE NOT EXISTS, así que correr este archivo
-- más de una vez no duplica filas ni choca con el trigger de vigencia (esta
-- tabla no tiene vigencia: `account` es catálogo sin fecha).
-- =============================================================================

-- Clases (nivel 1)
INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento, requiere_base_gravable)
SELECT NULL, NULL, '1', 'ACTIVO', 1, NULL, 'debito', false, false
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '1');

INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
SELECT NULL, NULL, '2', 'PASIVO', 1, NULL, 'credito', false
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2');

INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
SELECT NULL, NULL, '5', 'GASTOS', 1, NULL, 'debito', false
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '5');

-- Grupos (nivel 2), bajo PASIVO
INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
SELECT NULL, NULL, '22', 'PROVEEDORES', 2,
       (SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2'),
       'credito', false
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '22');

INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
SELECT NULL, NULL, '23', 'CUENTAS POR PAGAR', 2,
       (SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2'),
       'credito', false
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '23');

-- Cuentas (nivel 3, 4 dígitos)
INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento, requiere_tercero)
SELECT NULL, NULL, '2205', 'NACIONALES', 3,
       (SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '22'),
       'credito', true, true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2205');

INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento, requiere_tercero)
SELECT NULL, NULL, '2365', 'RETENCIÓN EN LA FUENTE', 3,
       (SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '23'),
       'credito', true, true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2365');

INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento, requiere_tercero)
SELECT NULL, NULL, '2367', 'IMPUESTO A LAS VENTAS RETENIDO', 3,
       (SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '23'),
       'credito', true, true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2367');

INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento, requiere_tercero)
SELECT NULL, NULL, '2368', 'IMPUESTO DE INDUSTRIA Y COMERCIO RETENIDO', 3,
       (SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '23'),
       'credito', true, true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2368');

COMMENT ON TABLE account IS
  'Global (tenant_id IS NULL) poblado parcialmente por A1 (seeds/tanda1 y tanda2), Decreto 2650 de 1993. Ver docs/reportes/ola1-a1.md para el subconjunto cargado y lo pendiente.';

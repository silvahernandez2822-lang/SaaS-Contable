-- =============================================================================
-- 080_municipios.sql — Agente A1, Ola 1, Tanda 1 (sección 7.5)
--
-- Catálogo DANE, identidad estable (sin vigencia). Los códigos DANE son datos
-- públicos y muy estables (DIVIPOLA); se cargan sin marca de verificación
-- humana. Las bases y tarifas de ReteICA (con vigencia) van en
-- 090_municipio_ica_reglas.sql.
-- =============================================================================

INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
SELECT NULL, NULL, '11001', 'Bogotá, D.C.', 'Bogotá, D.C.', '11'
WHERE NOT EXISTS (SELECT 1 FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '11001');

INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
SELECT NULL, NULL, '05001', 'Medellín', 'Antioquia', '05'
WHERE NOT EXISTS (SELECT 1 FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '05001');

INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
SELECT NULL, NULL, '76001', 'Cali', 'Valle del Cauca', '76'
WHERE NOT EXISTS (SELECT 1 FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '76001');

-- =============================================================================
-- 040_municipios_resto.sql — Agente A1, Ola 1, Tanda 2 (sección 7.5)
--
-- Barranquilla: la sección 7.5 SÍ da base, tarifa y norma completas, igual
-- que Bogotá/Medellín/Cali (tanda 1) — se carga completo.
--
-- Bucaramanga y Cartagena: la sección 7.5 los marca EXPLÍCITAMENTE
-- "(verificar)". Se carga solo la identidad del municipio (código DANE,
-- dato público y estable, sin relación con la tarifa) y se deja SIN CARGAR
-- `municipality_ica_rule` para los dos. Quedan en la lista de pendientes,
-- exactamente como ya los anticipaba ESTADO_PROYECTO.md antes de esta carga.
-- =============================================================================

-- Identidad de los tres municipios (Barranquilla se usa además abajo).
INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
SELECT NULL, NULL, v.codigo_dane, v.nombre, v.departamento, v.codigo_dpto
FROM (VALUES
  ('08001', 'Barranquilla', 'Atlántico', '08'),
  ('68001', 'Bucaramanga', 'Santander', '68'),
  ('13001', 'Cartagena de Indias', 'Bolívar', '13')
) AS v(codigo_dane, nombre, departamento, codigo_dpto)
WHERE NOT EXISTS (
  SELECT 1 FROM municipality e WHERE e.tenant_id IS NULL AND e.codigo_dane = v.codigo_dane
);

-- Barranquilla — 4 UVT servicios, 27 UVT compras, tarifa de la actividad (100%).
INSERT INTO municipality_ica_rule (
  tenant_id, company_id, municipality_id, practica_reteica,
  base_minima_servicios_uvt, base_minima_compras_uvt,
  usa_tarifa_de_actividad, tarifa_general, periodicidad,
  vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana, notas
)
SELECT NULL, NULL, m.id, true,
       4, 27,
       true, NULL, 'mensual',
       DATE '2026-01-01', NULL,
       'Decreto 924 de 2011, art. 352 (Barranquilla). Sección 7.5.',
       true,
       'periodicidad no confirmada por la sección 7.5 (se usó el valor por defecto del esquema); la tabla de tarifas por actividad no viene en la sección 7 y no se cargó.'
FROM municipality m
WHERE m.tenant_id IS NULL AND m.codigo_dane = '08001'
  AND NOT EXISTS (
    SELECT 1 FROM municipality_ica_rule r
    WHERE r.municipality_id = m.id AND r.tenant_id IS NULL AND r.company_id IS NULL
  );

-- Bucaramanga y Cartagena: a propósito NO se inserta municipality_ica_rule.
-- Ver docs/reportes/ola1-a1.md, lista de pendientes.

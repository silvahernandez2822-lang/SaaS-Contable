-- =============================================================================
-- 030_uvt.sql — Agente A1, Ola 1, Tanda 1 — UVT 2025 y 2026 (sección 7.1)
--
-- Solo se cargan 2025 y 2026 porque son las únicas dos filas de la tabla de
-- la sección 7.1 con norma de respaldo explícita. 2024 y 2023 aparecen en la
-- tabla con norma "—" (sin dato): la advertencia 17.5 obliga a dejarlas sin
-- cargar antes que inventar la resolución DIAN correspondiente. Quedan en la
-- lista de pendientes del reporte.
--
-- Valores en CENTAVOS (D-005). Vigencias contiguas y sin solape: 2025 cierra
-- el 31-dic-2025 y 2026 abre el 1-ene-2026 sin `vigente_hasta` (sigue
-- vigente hoy).
-- =============================================================================

INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana)
SELECT NULL, NULL, 2025, 4979900, DATE '2025-01-01', DATE '2025-12-31',
       'Resolución DIAN 000193 de 2024 (sección 7.1 del mega-prompt)', false
WHERE NOT EXISTS (
  SELECT 1 FROM uvt_value WHERE tenant_id IS NULL AND company_id IS NULL AND anio = 2025
);

INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, vigente_hasta, norma_respaldo, requiere_verificacion_humana)
SELECT NULL, NULL, 2026, 5237400, DATE '2026-01-01', NULL,
       'Resolución DIAN 000238 del 15-dic-2025 (sección 7.1 del mega-prompt)', false
WHERE NOT EXISTS (
  SELECT 1 FROM uvt_value WHERE tenant_id IS NULL AND company_id IS NULL AND anio = 2026
);

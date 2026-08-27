-- =============================================================================
-- 020_ciiu_minimo.sql — Agente A1, Ola 1, Tanda 1
--
-- UNA sola fila de catálogo CIIU para la tanda 1, y a propósito no lleva
-- ninguna tarifa de ICA ni de autorretención asociada todavía.
--
-- HALLAZGO ESTRUCTURAL PARA A2/A3 (ver docs/reportes/ola1-a1.md):
-- la sección 7.5 da un ejemplo de tarifa de Bogotá para la actividad
-- "profesiones liberales", identificada como CIIU **74901** (5 dígitos, el
-- código propio del Decreto 352 de 2002 de Bogotá, NO el CIIU nacional de 4
-- dígitos). El CHECK `ciiu_codigo_ck` de `ciiu_activity` exige exactamente 4
-- dígitos (`^[0-9]{4}$`), así que "74901" no cabe.
--
-- A1 decidió NO truncar a "7490" y adjuntarle la tarifa 7,66‰ de Bogotá,
-- porque eso mapearía un número real a un código que no es el que ese número
-- describe (CIIU 7490 nacional agrupa más actividades que la subclase
-- municipal 74901 de Bogotá) — es precisamente el tipo de dato que la
-- advertencia 17.5 pide no inventar. Por eso esa tarifa queda SIN CARGAR y
-- registrada como pendiente.
--
-- Lo único que se carga aquí es el código CIIU nacional 7490 como catálogo
-- puro (identidad, sin tarifa), porque es información pública verificable
-- (CIIU Rev. 4 A.C.) y puede servirle a A3/A14 como referencia neutra.
-- =============================================================================

INSERT INTO ciiu_activity (tenant_id, company_id, codigo, nombre, seccion, division)
SELECT NULL, NULL, '7490', 'Otras actividades profesionales, científicas y técnicas n.c.p.', 'M', '74'
WHERE NOT EXISTS (SELECT 1 FROM ciiu_activity WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '7490');

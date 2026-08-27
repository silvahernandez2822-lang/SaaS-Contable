-- =============================================================================
-- 100_reteica_medellin.sql — Agente A1, desbloqueo de la compuerta de la Ola 1 (V-4)
--
-- Hasta esta tanda `tax_rule` no tenía ni una fila `tipo = 'reteica'`, ni
-- `tax_concept` ninguno de tipo 'reteica': el 2‰ de Medellín vivía solo en
-- `municipality_ica_rule.tarifa_general` (090_municipio_ica_reglas.sql,
-- tanda 1), y D-017 amarra toda `retention_applied` a una `tax_rule` con
-- vigencia — sin la fila materializada, el motor no tiene qué citar y todo
-- ReteICA cae en `sin_regla_vigente_a_la_fecha` aunque el dato exista.
--
-- Este archivo materializa esa regla de verdad, en dos pasos:
--
--   1. `tax_concept` de tipo 'reteica' (identidad estable, D-013). No lleva
--      tarifa: solo el puntero que un `concepto_causacion` puede referenciar.
--
--   2. `tax_rule` de tipo 'reteica' para Medellín. LA TARIFA NO SE ESCRIBE A
--      MANO: se copia con un INSERT ... SELECT desde
--      `municipality_ica_rule.tarifa_general` de Medellín (código DANE
--      05001), que es la fila que A1 ya cargó y verificó en la tanda 1
--      (Acuerdo 066 de 2017). Si esa fila cambiara de valor o de vigencia,
--      este archivo seguiría copiando lo que diga la fuente de verdad, no un
--      número congelado aquí.
--
-- Medellín NO usa tarifa de actividad (`usa_tarifa_de_actividad = false` en
-- la fila de origen): por eso esta regla queda con `ciiu_activity_id NULL`,
-- que es justo lo que el motor espera para una tarifa general de municipio
-- (`reglasIca` en src/domain/repositorio.ts compara con
-- `IS NOT DISTINCT FROM`).
--
-- Bogotá y Cali NO se tocan aquí: sus tarifas de ICA son por actividad y el
-- código municipal de Bogotá (74901, Decreto 352 de 2002) tiene 5 dígitos
-- contra el CHECK de 4 de `ciiu_activity` — desajuste de esquema que le
-- corresponde decidir a A2 (V-5), no a este seed. Cali además no tiene ni la
-- tabla del Acuerdo 0321 de 2011 en la sección 7. Ambas quedan en pendientes
-- de verificación humana / de esquema, sin materializar.
-- =============================================================================

-- 1. Identidad del concepto ReteICA (tarifa general de municipio, sin actividad).
INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion)
SELECT NULL, NULL, 'reteica', 'reteica_tarifa_general_municipio',
       'ReteICA — tarifa general del municipio (no por actividad)',
       'Identidad para los municipios cuya tarifa de ICA NO depende de la actividad económica del '
       || 'proveedor, sino que aplican una tarifa general única (p. ej. Medellín, Acuerdo 066 de 2017). '
       || 'Sin tarifa (D-013): la tarifa vive en tax_rule, por vigencia.'
WHERE NOT EXISTS (
  SELECT 1 FROM tax_concept
   WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = 'reteica'
     AND codigo = 'reteica_tarifa_general_municipio'
);

-- 2. Tarifa de Medellín — COPIADA de municipality_ica_rule, no escrita a mano.
INSERT INTO tax_rule (
  tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a, tipo_persona,
  municipality_id, ciiu_activity_id, account_id, vigente_desde, vigente_hasta,
  norma_respaldo, requiere_verificacion_humana, notas
)
SELECT NULL, NULL, tc.id, 'reteica', mir.tarifa_general, 'base_gravable', 'ambos', 'ambos',
       mir.municipality_id, NULL, acc.id, mir.vigente_desde, mir.vigente_hasta,
       'Tarifa copiada de municipality_ica_rule (' || mir.norma_respaldo || '). Sección 7.5.',
       mir.requiere_verificacion_humana,
       'Materializada en tax_rule para que el motor pueda amarrar retention_applied a una regla con '
       || 'vigencia (D-017); la TARIFA no se escribió aquí, se copió de la fila de municipality_ica_rule '
       || 'que A1 cargó y verificó en 090_municipio_ica_reglas.sql (tanda 1). Cualquier cambio de esa '
       || 'fila de origen debe reflejarse aquí con una vigencia nueva, nunca con un UPDATE (D-012).'
  FROM municipality_ica_rule mir
  JOIN municipality m ON m.id = mir.municipality_id
  JOIN tax_concept tc ON tc.tenant_id IS NULL AND tc.company_id IS NULL AND tc.tipo = 'reteica'
                     AND tc.codigo = 'reteica_tarifa_general_municipio'
  JOIN account acc ON acc.tenant_id IS NULL AND acc.company_id IS NULL AND acc.codigo = '2368'
 WHERE m.tenant_id IS NULL AND m.codigo_dane = '05001'
   AND mir.tenant_id IS NULL AND mir.company_id IS NULL
   AND mir.tarifa_general IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM tax_rule r
      WHERE r.tenant_id IS NULL AND r.company_id IS NULL AND r.tipo = 'reteica'
        AND r.municipality_id = mir.municipality_id AND r.ciiu_activity_id IS NULL
   );

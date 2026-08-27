-- =============================================================================
-- 090_rounding_rule.sql — Agente A1, desbloqueo de la compuerta de la Ola 1 (V-6)
--
-- `rounding_rule` está en el catálogo obligatorio de la sección 6.3 ("reglas
-- de redondeo, al peso, a la decena, etc.") y la exige la Regla de Oro 5: el
-- motor (src/domain/dinero.ts) no elige un modo de redondeo por sí mismo,
-- lo lee de esta tabla, y sin una fila vigente manda TODA resolución a
-- revisión manual (motivo `sin_regla_de_redondeo_vigente`).
--
-- IMPORTANTE — esto NO es un dato normativo, y por eso NO aplica la
-- prohibición de inventar de la advertencia 17.5: no existe un decreto que
-- diga "redondee así". Es un PARÁMETRO OPERATIVO: una práctica contable y una
-- elección configurable por el usuario (sección 6.3 lo llama explícitamente
-- "reglas de redondeo" junto a "al peso, a la decena"). Lo que aquí se carga
-- es el modo por defecto para Colombia, con uno de los CINCO modos que el
-- motor de A3 soporta de verdad (`src/domain/dinero.ts`, MODOS_REDONDEO:
-- half_up | half_even | truncar | techo | piso). No se inventa un sexto modo.
--
-- Elección: redondeo AL PESO (multiplo = 100 centavos; el peso colombiano no
-- circula en fracciones desde hace décadas) con MEDIA HACIA ARRIBA
-- (half_up), que es la convención contable/tributaria más extendida en
-- Colombia para aproximar retenciones y bases (la propia DIAN redondea así
-- sus formularios). `aplica_a = 'todos'` para que sea el valor por defecto de
-- cualquier tipo de retención mientras no exista una regla más específica.
--
-- Es GLOBAL (tenant_id/company_id NULL, D-015): sigue siendo el valor de
-- MENOR prioridad de resolución (PRIORIDAD_ALCANCE en repositorio.ts
-- desempata primero por company_id, luego por tenant_id), así que una firma
-- o una empresa que necesite otro modo u otro múltiplo (p. ej. redondeo a la
-- decena) puede insertar su propia fila de `rounding_rule` con
-- `tenant_id`/`company_id` propios y esa fila gana sin tocar esta ni el
-- código — es exactamente el mecanismo que A8 va a exponer en la interfaz de
-- parametrización.
-- =============================================================================

INSERT INTO rounding_rule (
  tenant_id, company_id, codigo, nombre, modo, multiplo, aplica_a,
  vigente_desde, vigente_hasta, norma_respaldo, notas, requiere_verificacion_humana
)
SELECT NULL, NULL, 'peso_half_up', 'Redondeo al peso (media hacia arriba)', 'half_up', 100, 'todos',
       DATE '2000-01-01', NULL,
       'PARÁMETRO OPERATIVO, no norma tributaria (sección 6.3: "reglas de redondeo, al peso, a la '
       || 'decena, etc."; Regla de Oro 5). Modo tomado del catálogo que implementa src/domain/dinero.ts '
       || '(MODOS_REDONDEO), no inventado.',
       'Valor por defecto para Colombia: el peso no circula en fracciones, y half_up (media hacia '
       || 'arriba) es la convención contable más extendida para aproximar retenciones. Es la regla de '
       || 'MENOR prioridad (global, tipo "todos"): cualquier empresa o firma puede sobreescribirla con '
       || 'una fila propia (tenant_id/company_id) o más específica (aplica_a distinto de "todos") sin '
       || 'tocar esta fila ni el código, cerrando esta vigencia solo si algún día hay que descontinuarla.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM rounding_rule
   WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = 'peso_half_up' AND aplica_a = 'todos'
);

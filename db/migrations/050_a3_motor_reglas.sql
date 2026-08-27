-- =============================================================================
-- 050_a3_motor_reglas.sql — Agente A3, Ola 1
--
-- El esquema de A2 está congelado y esta migración NO lo reabre: agrega tres
-- columnas, todas aditivas, todas porque el motor de la sección 9 no puede
-- resolver sin ellas y la alternativa sería que el motor SUPUSIERA el dato.
-- Suponer un dato tributario es exactamente lo que prohíbe la advertencia 17.5.
--
-- -----------------------------------------------------------------------------
-- (1) tax_rule.comparador_base_minima
-- -----------------------------------------------------------------------------
-- La tabla de la sección 7.2 no usa un solo comparador: la mayoría de los
-- conceptos retienen «desde 10 UVT» (mayor o igual) pero los productos
-- agrícolas sin proceso industrial retienen «desde MÁS de 70 UVT». Sin esta
-- columna el motor tendría que elegir uno de los dos por su cuenta, y en el
-- borde exacto —una compra agrícola de exactamente 70 UVT— la diferencia entre
-- retener y no retener sería una decisión del código, no de la norma.
--
-- El valor por defecto NO es un valor tributario: es el comparador de la
-- inmensa mayoría de las filas de la sección 7.2. A1 debe poner 'mayor' en las
-- reglas cuya norma diga «superiores a».
--
-- -----------------------------------------------------------------------------
-- (2) concepto_causacion.tipo_operacion_ica
-- -----------------------------------------------------------------------------
-- `municipality_ica_rule` distingue base mínima de SERVICIOS de base mínima de
-- COMPRAS, y en Bogotá esa diferencia es de 4 UVT contra 27 UVT. Nada en el
-- esquema decía cuál de las dos aplica a una operación concreta:
-- `concepto_causacion.naturaleza` clasifica el documento (compra / venta /
-- nómina), que es otra cosa. Se pone en el concepto porque es el concepto el
-- que sabe qué se compró, y queda NULL-able a propósito: un concepto sin este
-- dato no calcula ReteICA con base mínima diferenciada, va a revisión manual.
--
-- -----------------------------------------------------------------------------
-- (3) concepto_causacion.tax_concept_reteiva_exterior_id
-- -----------------------------------------------------------------------------
-- La sección 9.3 exige ReteIVA del 100% al proveedor del exterior (art. 437-2
-- ET num. 3 y 8). Eso no es «la misma regla con otra tarifa»: es otra regla,
-- con otra norma de respaldo. Si el motor la fabricara poniendo la tarifa al
-- tope, estaría escribiendo un valor tributario en el código. Con este segundo
-- puntero, el concepto referencia LAS DOS reglas —la general y la del
-- exterior— y el motor solo elige entre punteros, como manda la sección 8.2.
-- Sin puntero de exterior y con proveedor del exterior: revisión manual.
-- =============================================================================

ALTER TABLE tax_rule
  ADD COLUMN comparador_base_minima text NOT NULL DEFAULT 'mayor_o_igual';

ALTER TABLE tax_rule
  ADD CONSTRAINT tax_rule_comparador_ck
  CHECK (comparador_base_minima IN ('mayor_o_igual', 'mayor'));

COMMENT ON COLUMN tax_rule.comparador_base_minima IS
  'Cómo se compara la base gravable contra la base mínima. mayor_o_igual = «desde N UVT»; mayor = «superiores a N UVT» (agrícolas, sección 7.2). Lo fija A1 según la norma de cada regla.';

ALTER TABLE concepto_causacion
  ADD COLUMN tipo_operacion_ica text;

ALTER TABLE concepto_causacion
  ADD CONSTRAINT concepto_causacion_tipo_operacion_ica_ck
  CHECK (tipo_operacion_ica IS NULL OR tipo_operacion_ica IN ('servicios', 'compras'));

COMMENT ON COLUMN concepto_causacion.tipo_operacion_ica IS
  'Contra cuál de las dos bases mínimas del municipio se compara (municipality_ica_rule distingue servicios de compras). NULL = el motor no lo supone: manda el documento a revisión manual.';

ALTER TABLE concepto_causacion
  ADD COLUMN tax_concept_reteiva_exterior_id uuid REFERENCES tax_concept(id);

COMMENT ON COLUMN concepto_causacion.tax_concept_reteiva_exterior_id IS
  'Puntero a la REGLA de ReteIVA aplicable cuando el proveedor es del exterior. Es otra regla y otra norma, no la misma con otra tarifa (sección 9.3).';

-- -----------------------------------------------------------------------------
-- El guardia de alcance de la migración 018 se instaló con la lista de columnas
-- que existían entonces. Una columna FK nueva sin guardia sería justo el hueco
-- que D-032 cerró, así que se reinstala el trigger con la lista completa.
-- -----------------------------------------------------------------------------
DROP TRIGGER concepto_causacion_fk_alcance ON concepto_causacion;

SELECT app.instalar_guardia_alcance('concepto_causacion',
  'company_id', 'company', 'cost_center_id', 'cost_center',
  'cuenta_contrapartida_id', 'account', 'cuenta_gasto_id', 'account',
  'cuenta_iva_descontable_id', 'account',
  'tax_concept_autorretencion_id', 'tax_concept', 'tax_concept_retefuente_id', 'tax_concept',
  'tax_concept_reteica_id', 'tax_concept', 'tax_concept_reteiva_id', 'tax_concept',
  'tax_concept_reteiva_exterior_id', 'tax_concept');

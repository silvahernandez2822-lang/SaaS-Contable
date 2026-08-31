-- =============================================================================
-- 160_a14_v20_atributos_fiscales_sin_default.sql — Agente A14 (QA adversarial)
--
-- V-20. HALLAZGO: `third_party_fiscal_attribute` nacio en la migracion 005 con
-- DEFAULT en OCHO de las nueve banderas fiscales y en `regimen_tributario`.
-- Solo `es_declarante_renta` quedo sin valor por omision, que es el caso
-- concreto que D-014 nombro (asumir "no declarante" mueve la retefuente del 4%
-- al 6%).
--
-- A8 documento en V-17 tres capas que impiden guardar un atributo sin declarar:
-- el tipo de TypeScript, `requerirBooleano` en el servicio y los radios sin
-- `defaultChecked` en el HTML. Las tres son de APLICACION. A14 lo comprobo por
-- el cuarto camino, el que el mega-prompt exige que sea el ultimo en fallar:
-- un INSERT directo bajo el rol `app_user`, con el permiso legitimo
-- `tercero.atributos_fiscales`, omitiendo ocho columnas. No fallo: la base
-- INVENTO los ocho valores y grabo la vigencia.
--
-- Por que importa, con la consecuencia tributaria de cada uno:
--   * es_responsable_iva = false        -> el motor no practica ReteIVA.
--   * es_regimen_simple = false         -> descarta el tratamiento del caso 13.
--   * es_gran_contribuyente = false     -> cambia el eje "tercero" del caso 1/2.
--   * es_autorretenedor_renta = false   -> decide si se retiene o no.
--   * es_agente_retencion_* = false     -> decide el rol del tercero.
--   * es_autorretenedor_ica = false     -> decide el ReteICA.
--   * regimen_tributario = 'ordinario'  -> un regimen inventado.
-- Advertencia 17.5: "un valor inventado en un motor tributario es peor que uno
-- faltante: el faltante se ve, el inventado no". Un DEFAULT es exactamente la
-- forma en que un valor faltante se vuelve invisible.
--
-- QUE HACE: quita el DEFAULT. Las columnas siguen siendo NOT NULL, asi que un
-- INSERT que omita cualquiera de ellas falla en el motor (23502) en vez de
-- grabar una suposicion. No cambia ni una fila existente (quitar un DEFAULT no
-- reescribe datos), no toca RLS, ni triggers, ni el ledger.
--
-- NO se toca `fuente` ni `requiere_verificacion_humana`: describen la
-- procedencia y el flujo de trabajo del dato, no son atributos fiscales del
-- tercero y no entran en ningun calculo.
-- =============================================================================

ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_autorretenedor_renta  DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_gran_contribuyente    DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_regimen_simple        DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_responsable_iva       DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_agente_retencion_renta DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_agente_retencion_iva  DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_agente_retencion_ica  DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN es_autorretenedor_ica    DROP DEFAULT;
ALTER TABLE third_party_fiscal_attribute ALTER COLUMN regimen_tributario       DROP DEFAULT;

COMMENT ON TABLE third_party_fiscal_attribute IS
  'Atributos fiscales del tercero, versionados por vigencia (Regla de Oro 3). '
  'D-014 / V-20: NINGUNA bandera fiscal tiene valor por omision. Quien registra '
  'una vigencia declara las nueve y el regimen, o el INSERT falla. Asumir un '
  'atributo fiscal es inventar un dato tributario (advertencia 17.5).';

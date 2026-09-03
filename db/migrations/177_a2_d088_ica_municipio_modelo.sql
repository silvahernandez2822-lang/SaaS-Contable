-- =============================================================================
-- 177_a2_d088_ica_municipio_modelo.sql — D-088, parametrización de ICA por
-- municipio: SOLO el modelo de datos.
--
-- DECISIÓN TOMADA CON EL USUARIO ANTES DE ESCRIBIR UNA LÍNEA: se EXTIENDE el
-- modelo que ya existe. NO se crean tablas paralelas de parámetros de ICA por
-- municipio ni un catálogo de actividades propio. El ICA por municipio ya está
-- modelado desde la Ola 0:
--
--   · `municipality_ica_rule` (004) — parámetros del municipio POR VIGENCIA:
--     practica_reteica, bases mínimas de servicios/compras en UVT o en pesos,
--     usa_tarifa_de_actividad, tarifa_general, periodicidad de declaración y
--     regla de desempate de actividad. Con sus dos triggers de vigencia.
--   · `tax_rule` con tipo='reteica' + municipality_id + ciiu_activity_id (006) —
--     la TARIFA por actividad del municipio, también por vigencia.
--   · `ciiu_activity` (004) — el catálogo de actividades. Ya sembrado y en uso
--     por D-084. Esta migración NO lo toca ni lo duplica.
--
-- Lo que falta y añade esta migración son TRES piezas de esquema:
--
--   1. Cómo se MIDE la base mínima: contra la factura individual o contra el
--      acumulado del tercero en el municipio durante un periodo. Hoy el modelo
--      solo sabía expresar la primera forma.
--   2. Un flag EXPLÍCITO de actividad gravada / no gravada, con guarda de
--      consistencia. Hoy "no gravada" se representaba por AUSENCIA de fila en
--      `tax_rule`, que es indistinguible de "todavía no la hemos cargado".
--   3. El acumulador por periodo que necesita la medición del punto 1.
--
-- REGLA DE ORO 2: aquí no hay ni una tarifa, ni una base, ni una UVT, ni un
-- tope, ni un calendario. Todos los DEFAULT son neutros o NULL: qué municipio
-- mide por periodo, cada cuántos meses, con qué base y con qué tarifa lo
-- decide el contador desde la interfaz y queda como fila con su norma de
-- respaldo y su vigencia, jamás como literal en el esquema.
--
-- REGLAS DE ORO 1 y 3: no se toca el ledger ni la resolución por vigencia. Las
-- dos columnas nuevas de `municipality_ica_rule` y la de `tax_rule` viajan CON
-- la fila de vigencia que las contiene, así que un cambio de medición o de
-- "gravada" abre vigencia nueva por el mismo camino que todo lo demás y una
-- factura vieja se sigue recalculando con la regla que estaba vigente ese día.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cómo se mide la base mínima del municipio
--
-- Los dos patrones que existen en la práctica municipal son estructuralmente
-- distintos y no se pueden expresar con un solo campo:
--
--   · 'por_factura' — se compara CADA factura contra la base mínima. Es el
--     patrón de retefuente / ReteIVA y el único que el modelo sabía expresar
--     hasta hoy. Sigue siendo el DEFAULT: no cambia el comportamiento de
--     ninguna fila existente.
--   · 'por_periodo' — se compara el ACUMULADO del tercero en ese municipio
--     durante el periodo contra la base mínima. Una factura pequeña no retiene
--     sola, pero la que hace cruzar el umbral sí, y el motor necesita saber
--     cuánto llevaba acumulado ese tercero. De ahí la tabla del punto 3.
--
-- La columna es NOT NULL con DEFAULT 'por_factura' a propósito: el estado
-- indeterminado en algo que decide si se retiene o no es peor que un default
-- explícito y conservador que reproduce el comportamiento actual.
-- -----------------------------------------------------------------------------
ALTER TABLE municipality_ica_rule
  ADD COLUMN tipo_medicion_base_minima text NOT NULL DEFAULT 'por_factura'
    CHECK (tipo_medicion_base_minima IN ('por_factura','por_periodo'));

COMMENT ON COLUMN municipality_ica_rule.tipo_medicion_base_minima IS
  'D-088. Contra qué se compara la base mínima del municipio. ''por_factura'': se compara la factura individual (patrón de retefuente/IVA; es el DEFAULT y el comportamiento previo a D-088). ''por_periodo'': se compara el acumulado del tercero en ese municipio durante el periodo vigente — el motor consulta reteica_periodo_acumulado. Viaja con la fila de vigencia: cambiar de medición abre vigencia nueva y no altera el pasado.';

-- -----------------------------------------------------------------------------
-- 2. Cada cuántos meses corre el periodo de acumulación
--
-- NO CONFUNDIR con la columna `periodicidad` que ya existía en esta misma
-- tabla. Son dos cosas distintas y ambas hacen falta:
--
--   · `periodicidad` (004) es la frecuencia con la que el AGENTE RETENEDOR
--     declara y paga el ICA retenido ante el municipio. Es una obligación
--     formal del cliente: no entra en el cálculo de si una factura retiene.
--   · `periodo_meses` (D-088) es la ventana sobre la que se ACUMULA la base
--     del tercero para compararla con la base mínima. Entra directamente en el
--     cálculo. Un municipio puede declarar bimestralmente y acumular la base
--     mínima anualmente, o al revés.
--
-- Solo tiene sentido cuando la medición es por periodo: el CHECK cruzado lo
-- impone la base de datos, no la aplicación. Nullable y sin default numérico:
-- cuántos meses son es un dato del acuerdo municipal (Regla de Oro 2), lo
-- carga el contador con su norma de respaldo.
-- -----------------------------------------------------------------------------
ALTER TABLE municipality_ica_rule
  ADD COLUMN periodo_meses smallint
    CHECK (periodo_meses IS NULL OR periodo_meses BETWEEN 1 AND 12);

ALTER TABLE municipality_ica_rule
  ADD CONSTRAINT municipality_ica_periodo_medicion_ck
    CHECK (tipo_medicion_base_minima = 'por_periodo' OR periodo_meses IS NULL);

COMMENT ON COLUMN municipality_ica_rule.periodo_meses IS
  'D-088. Meses de la ventana de ACUMULACIÓN de la base del tercero cuando tipo_medicion_base_minima = ''por_periodo''. NO es periodicidad: `periodicidad` (004) es cada cuánto DECLARA el agente retenedor ante el municipio (obligación formal, ajena al cálculo); `periodo_meses` es la ventana sobre la que se suma la base para compararla con la base mínima (entra en el cálculo). Un municipio puede declarar bimestral y acumular anual. NULL obligatorio si la medición es por factura (municipality_ica_periodo_medicion_ck).';

COMMENT ON CONSTRAINT municipality_ica_periodo_medicion_ck ON municipality_ica_rule IS
  'D-088: periodo_meses solo tiene sentido con medición por periodo. Una fila con ventana de acumulación y medición por factura sería una regla que se contradice a sí misma; la rechaza el motor, no la aplicación.';

-- -----------------------------------------------------------------------------
-- 3. Actividad GRAVADA / NO GRAVADA, explícita
--
-- Hasta hoy, "esta actividad no está gravada en este municipio" se representaba
-- por AUSENCIA de fila en `tax_rule`. Eso es indistinguible de "todavía no se
-- ha cargado la tarifa", y las dos situaciones exigen respuestas opuestas: la
-- primera es una decisión normativa que el motor debe respetar en silencio; la
-- segunda es un vacío de parametrización que debe salir a la superficie (§17:
-- un dato faltante se ve, uno inventado no).
--
-- Se hace explícito con un flag de tres estados:
--   NULL  — no aplica / no declarado. Es el estado de TODAS las filas que ya
--           existen: esta migración no reinterpreta ni una sola fila cargada.
--   true  — la actividad está gravada en ese municipio con esa tarifa.
--   false — la actividad NO está gravada. El motor no retiene, sin importar
--           qué diga la tarifa.
--
-- Nullable porque solo tiene sentido para tipo='reteica' con ciiu_activity_id:
-- un NOT NULL obligaría a responder "¿gravada?" a una fila de retefuente sobre
-- honorarios, donde la pregunta no significa nada.
--
-- El CHECK impide la fila peligrosa: gravada=false con tarifa > 0. Sin él, el
-- esquema admitiría una regla que dice dos cosas contrarias, y bastaría que un
-- consumidor futuro leyera la tarifa y no el flag para retener sobre una
-- actividad no gravada. Con gravada = false la tarifa tiene que ser cero, así
-- que las dos lecturas dan el mismo resultado y la contradicción no existe.
-- -----------------------------------------------------------------------------
ALTER TABLE tax_rule ADD COLUMN gravada boolean;

ALTER TABLE tax_rule
  ADD CONSTRAINT tax_rule_gravada_ck CHECK (gravada IS NOT FALSE OR tarifa = 0);

COMMENT ON COLUMN tax_rule.gravada IS
  'D-088. Flag explícito de actividad gravada, pensado para tipo=''reteica'' con ciiu_activity_id. NULL = no aplica o no declarado (estado de todas las filas anteriores a D-088; el motor se comporta como siempre). true = gravada. false = NO gravada: el motor NO retiene, sin importar la tarifa. Antes de D-088 la actividad no gravada se representaba por ausencia de fila, indistinguible de "falta cargar la tarifa".';

COMMENT ON CONSTRAINT tax_rule_gravada_ck ON tax_rule IS
  'D-088: una actividad declarada NO gravada no puede llevar tarifa distinta de cero. Evita la fila que se contradice a sí misma, donde leer la tarifa y leer el flag darían resultados opuestos.';

-- -----------------------------------------------------------------------------
-- 4. reteica_periodo_acumulado — acumulador del tercero por municipio y periodo
--
-- QUÉ ES Y QUÉ NO ES. NO es ledger y NO es paramétrica:
--
--   · No es ledger. No lleva vigencia, no es append-only y SÍ admite UPDATE.
--     Es estado DERIVADO: la verdad sigue estando en los documentos y en el
--     ledger, y esta tabla se puede reconstruir entera desde ellos. Por eso la
--     Regla de Oro 1 no le aplica: no se corrige por reversa, se recalcula.
--     (`documentos_contados` es justamente lo que hace el recálculo idempotente
--     y evita sumar dos veces el mismo documento en un reproceso.)
--   · No es paramétrica. No lleva `vigente_desde`, `norma_respaldo` ni
--     `clave_vigencia`, y no debe llevarlos: aquí no hay ninguna decisión
--     normativa, solo la suma de lo que ya ocurrió. Tampoco lleva el trigger de
--     `parametro.editar`: quien escribe aquí es el motor de causación durante
--     una causación normal, no un administrador tributario abriendo vigencia.
--
-- El PERIODO se materializa como par de fechas (periodo_inicio, periodo_fin) y
-- no como "año + número de periodo": la ventana la define `periodo_meses` de la
-- regla del municipio VIGENTE A LA FECHA DEL HECHO ECONÓMICO, y esa regla puede
-- cambiar. Guardando las fechas concretas, el acumulado de un periodo pasado
-- sigue significando exactamente lo que significaba, aunque el municipio cambie
-- la ventana mañana (Regla de Oro 3).
--
-- La UNIQUE es por (company_id, ...) y no por (tenant_id, company_id, ...)
-- porque `company_id` ya determina el tenant: es el mismo criterio de
-- `third_party_doc_uq` (005).
-- -----------------------------------------------------------------------------
CREATE TABLE reteica_periodo_acumulado (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  company_id              uuid NOT NULL REFERENCES company(id),
  third_party_id          uuid NOT NULL,
  municipality_id         uuid NOT NULL REFERENCES municipality(id),
  tipo_operacion_ica      text NOT NULL CHECK (tipo_operacion_ica IN ('servicios','compras')),
  periodo_inicio          date NOT NULL,
  periodo_fin             date NOT NULL,
  base_acumulada_centavos bigint NOT NULL DEFAULT 0 CHECK (base_acumulada_centavos >= 0),
  documentos_contados     jsonb NOT NULL DEFAULT '[]'::jsonb
                            CHECK (jsonb_typeof(documentos_contados) = 'array'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reteica_periodo_acumulado_uq
    UNIQUE (company_id, third_party_id, municipality_id, tipo_operacion_ica, periodo_inicio),
  CONSTRAINT reteica_periodo_acumulado_rango_ck CHECK (periodo_fin >= periodo_inicio),
  CONSTRAINT reteica_periodo_acumulado_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  -- FK COMPUESTA al tercero, no simple: amarra el alcance en el motor. Un
  -- acumulado de la empresa A no puede apuntar al tercero de la empresa B ni
  -- por error de la aplicación (mismo patrón que source_document, 008).
  CONSTRAINT reteica_periodo_acumulado_tercero_fk
    FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id)
);

CREATE INDEX reteica_periodo_acumulado_busqueda_idx
  ON reteica_periodo_acumulado (company_id, third_party_id, municipality_id, periodo_inicio);

COMMENT ON TABLE reteica_periodo_acumulado IS
  'D-088. Acumulado de base de un tercero en un municipio dentro de un periodo, para los municipios cuya base mínima se mide por periodo (municipality_ica_rule.tipo_medicion_base_minima = ''por_periodo''). ESTADO DERIVADO Y RECALCULABLE, no ledger: admite UPDATE, no lleva vigencia y se puede reconstruir desde los documentos. No es paramétrica: no contiene ninguna decisión normativa, solo la suma de lo ya ocurrido.';

COMMENT ON COLUMN reteica_periodo_acumulado.periodo_inicio IS
  'Primer día de la ventana de acumulación, derivada de municipality_ica_rule.periodo_meses vigente a la fecha del hecho económico. Se guarda la fecha concreta, no "año + periodo", para que un acumulado pasado no cambie de significado si el municipio cambia la ventana.';

COMMENT ON COLUMN reteica_periodo_acumulado.base_acumulada_centavos IS
  'Centavos de COP (Regla de Oro 5: BIGINT, jamás float).';

COMMENT ON COLUMN reteica_periodo_acumulado.documentos_contados IS
  'Array JSON de los source_document.id ya sumados a este acumulado. Hace idempotente la acumulación: un reproceso del mismo documento no suma dos veces, y el acumulado se puede reconstruir y comparar contra el ledger.';

COMMENT ON COLUMN reteica_periodo_acumulado.tipo_operacion_ica IS
  'Separa servicios de compras porque el municipio puede fijar bases mínimas distintas para cada uno (municipality_ica_rule.base_minima_servicios_* / base_minima_compras_*), y mezclarlas en un solo acumulado haría cruzar el umbral antes de tiempo.';

-- RLS de doble nivel, patrón A de 012 (dato de una empresa: tenant Y company).
SELECT app.instalar_rls_tenant_company('reteica_periodo_acumulado');

-- Guardia de alcance de la FK a `municipality`: es catálogo híbrido
-- (tenant_id puede ser NULL), así que la FK compuesta no es expresable y va el
-- trigger genérico de 018. Las FK a company y third_party ya son compuestas.
SELECT app.instalar_guardia_alcance('reteica_periodo_acumulado',
  'municipality_id', 'municipality');

CREATE TRIGGER reteica_periodo_acumulado_updated_at
  BEFORE UPDATE ON reteica_periodo_acumulado
  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON reteica_periodo_acumulado TO app_user;

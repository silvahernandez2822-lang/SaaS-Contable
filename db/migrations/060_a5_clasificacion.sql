-- =============================================================================
-- 060_a5_clasificacion.sql — Agente A5, Ola 2: sistema de conceptos y caché
-- (sección 8 del mega-prompt).
--
-- Las tres tablas del subsistema (`concepto_causacion`, `memoria_clasificacion`
-- y `company_setting`) ya existen desde la Ola 0. Esta migración NO las
-- reabre: agrega lo que la sección 8 exige y no existía todavía.
--
-- (1) `parametro_clasificacion` — los cuatro parámetros configurables que
--     nombra la sección 8.3 («umbral de auto-aprobación, umbral de propuesta,
--     si la memoria es por empresa o compartida a nivel de firma, y antigüedad
--     tras la cual una entrada de memoria se revalida») más los del control de
--     costo de A15. `company_setting` no sirve para esto: tiene `company_id`
--     NOT NULL y el alcance de la memoria es una decisión DE LA FIRMA, no de
--     una empresa; además hacen falta valores por defecto de plataforma que
--     ninguna firma tiene que escribir. Aquí el alcance es de tres niveles:
--     global (tenant NULL) → firma (company NULL) → empresa.
--
--     Los valores por defecto que siembra esta migración NO son valores
--     tributarios: son umbrales de confianza de un modelo y precios de un
--     proveedor de cómputo. No hay ni una tarifa, ni una base, ni una UVT.
--     Aun así viven en tabla y no en el código, porque la sección 8.3 los
--     declara configurables y porque el contador tiene que poder subirlos.
--
-- (2) `prompt_clasificacion` — prompts VERSIONADOS (sección 8.4). Es
--     append-only: cambiar un prompt no edita la fila, inserta una versión
--     nueva, y el trigger de auditoría deja el evento en `audit_log`. Qué
--     versión está activa lo dice el parámetro `prompt_version`, cuyo cambio
--     también queda auditado. Así, dado un `extraction.prompt_version`, la
--     plantilla exacta con la que se produjo una propuesta se puede recuperar
--     dentro de seis meses aunque el prompt ya haya cambiado tres veces.
--
-- (3) `clasificacion_pendiente` — la cola de revisión del paso 5 de la 8.3.
--     Una fila por (documento, línea). Guarda la propuesta SOLO si el score
--     superó el umbral de propuesta; por debajo, la fila existe sin propuesta,
--     que es exactamente lo que pide la sección: «va a cola de revisión manual
--     SIN propuesta». Sirve además de caché de propuestas: una segunda factura
--     con el mismo patrón, mientras el humano no ha decidido todavía, reutiliza
--     la propuesta pendiente en vez de gastar otra llamada.
--
-- (4) El alcance de la memoria, impuesto por el MOTOR y no por la aplicación
--     (Regla de Oro 7). Compartir la memoria a nivel de firma no se implementa
--     con un `if` en TypeScript que quite el filtro de empresa: se implementa
--     con una política RLS adicional de SELECT que solo se activa cuando el
--     parámetro de ESA firma lo dice. Con el valor por defecto ('empresa') la
--     política es falsa y el aislamiento entre empresas queda como está hoy.
--     Nunca cruza la frontera de firma: la política sigue exigiendo
--     `tenant_id = app.current_tenant_id()`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) Parámetros del subsistema de clasificación
-- -----------------------------------------------------------------------------
CREATE TABLE parametro_clasificacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id),   -- NULL = valor por defecto de plataforma
  company_id  uuid REFERENCES company(id),  -- NULL = valor de la firma
  clave       text NOT NULL,
  valor       jsonb NOT NULL,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parametro_clasificacion_uq
    UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, clave),
  CONSTRAINT parametro_clasificacion_id_scope_uq UNIQUE NULLS NOT DISTINCT (id, tenant_id, company_id),
  CONSTRAINT parametro_clasificacion_alcance_ck
    CHECK (company_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT parametro_clasificacion_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id)
);

CREATE INDEX parametro_clasificacion_lookup_idx
  ON parametro_clasificacion (clave, tenant_id, company_id);

COMMENT ON TABLE parametro_clasificacion IS
  'Parámetros configurables del subsistema de clasificación (sección 8.3), en tres niveles: global, firma y empresa. No es una tabla tributaria: aquí no va ni una tarifa ni una base.';

CREATE TRIGGER parametro_clasificacion_updated_at
  BEFORE UPDATE ON parametro_clasificacion
  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

-- -----------------------------------------------------------------------------
-- (2) Prompts versionados
-- -----------------------------------------------------------------------------
CREATE TABLE prompt_clasificacion (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES tenant(id),  -- NULL = prompt de plataforma
  codigo                text NOT NULL,
  version               integer NOT NULL CHECK (version > 0),
  plantilla_sistema     text NOT NULL,
  plantilla_usuario     text NOT NULL,
  modelo                text NOT NULL,
  -- Determinismo (8.4): la temperatura se guarda en milésimas para no meter
  -- un decimal en el esquema. Cero es el mínimo y es el valor sembrado.
  temperatura_milesimas integer NOT NULL DEFAULT 0
                          CHECK (temperatura_milesimas >= 0 AND temperatura_milesimas <= 2000),
  max_tokens_salida     integer NOT NULL CHECK (max_tokens_salida > 0),
  -- sha256 hex de (plantilla_sistema || '\n' || plantilla_usuario), calculado
  -- por la base. Si alguien intentara editar la plantilla, el append-only lo
  -- impide; el hash es la comprobación independiente de que no cambió.
  hash_plantilla        text NOT NULL,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_clasificacion_uq UNIQUE NULLS NOT DISTINCT (tenant_id, codigo, version),
  CONSTRAINT prompt_clasificacion_hash_ck
    CHECK (hash_plantilla = encode(sha256(convert_to(plantilla_sistema || E'\n' || plantilla_usuario, 'UTF8')), 'hex'))
);

CREATE INDEX prompt_clasificacion_lookup_idx ON prompt_clasificacion (codigo, version);

COMMENT ON TABLE prompt_clasificacion IS
  'Prompts versionados (sección 8.4). Append-only: cambiar un prompt inserta una versión nueva y el trigger de auditoría lo registra en audit_log. La versión activa la decide el parámetro prompt_version.';
COMMENT ON COLUMN prompt_clasificacion.temperatura_milesimas IS
  'Temperatura del modelo en milésimas. 0 = mínimo, que es lo que exige la sección 8.4.';

CREATE TRIGGER prompt_clasificacion_append_only
  BEFORE UPDATE OR DELETE ON prompt_clasificacion
  FOR EACH ROW EXECUTE FUNCTION app.trg_append_only();

-- -----------------------------------------------------------------------------
-- (3) Cola de revisión de clasificación
-- -----------------------------------------------------------------------------
CREATE TABLE clasificacion_pendiente (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  company_id            uuid NOT NULL REFERENCES company(id),
  source_document_id    uuid NOT NULL REFERENCES source_document(id),
  linea_numero          integer NOT NULL CHECK (linea_numero > 0),
  third_party_id        uuid NOT NULL REFERENCES third_party(id),
  descripcion_original  text,
  patron_descripcion    text NOT NULL,
  -- Propuesta de la IA. NULL cuando el score no alcanzó el umbral de
  -- propuesta: la sección 8.3 exige que en ese caso la cola NO lleve propuesta.
  concepto_propuesto_id uuid REFERENCES concepto_causacion(id),
  score_milesimas       integer CHECK (score_milesimas IS NULL
                                       OR (score_milesimas >= 0 AND score_milesimas <= 1000)),
  origen                text NOT NULL
                          CHECK (origen IN ('llm','cola','memoria_vencida','sin_propuesta')),
  extraction_id         uuid REFERENCES extraction(id),
  estado                text NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente','resuelto','descartado')),
  concepto_confirmado_id uuid REFERENCES concepto_causacion(id),
  memoria_clasificacion_id uuid REFERENCES memoria_clasificacion(id),
  resuelto_por          uuid REFERENCES "user"(id),
  resuelto_en           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clasificacion_pendiente_uq UNIQUE (source_document_id, linea_numero),
  CONSTRAINT clasificacion_pendiente_id_scope_uq UNIQUE (id, tenant_id, company_id),
  CONSTRAINT clasificacion_pendiente_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT clasificacion_pendiente_documento_fk
    FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT clasificacion_pendiente_tercero_fk
    FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id),
  CONSTRAINT clasificacion_pendiente_patron_ck
    CHECK (patron_descripcion = lower(patron_descripcion)
           AND patron_descripcion = btrim(patron_descripcion)
           AND patron_descripcion <> ''),
  CONSTRAINT clasificacion_pendiente_resuelto_ck
    CHECK (estado <> 'resuelto'
           OR (concepto_confirmado_id IS NOT NULL AND resuelto_en IS NOT NULL)),
  -- Sin propuesta no puede haber score, y con score bajo no puede haber
  -- propuesta: es la regla del paso 5 de la 8.3, impuesta por la base.
  CONSTRAINT clasificacion_pendiente_propuesta_ck
    CHECK ((concepto_propuesto_id IS NULL) = (score_milesimas IS NULL))
);

CREATE INDEX clasificacion_pendiente_cola_idx
  ON clasificacion_pendiente (company_id, created_at)
  WHERE estado = 'pendiente';

CREATE INDEX clasificacion_pendiente_patron_idx
  ON clasificacion_pendiente (company_id, third_party_id, patron_descripcion);

CREATE INDEX clasificacion_pendiente_documento_idx
  ON clasificacion_pendiente (source_document_id);

COMMENT ON TABLE clasificacion_pendiente IS
  'Cola de revisión humana de clasificación (sección 8.3, pasos 4 a 6). Una fila por línea de documento. Con score bajo la fila existe SIN propuesta. Al resolverla se graba la decisión en memoria_clasificacion.';

CREATE TRIGGER clasificacion_pendiente_updated_at
  BEFORE UPDATE ON clasificacion_pendiente
  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Endurecimiento de `memoria_clasificacion`
--
-- `normalizador_version` es lo que permite que convivan las entradas escritas
-- por la normalización MÍNIMA de la Ola 1 (D-013: minúsculas + trim) con las
-- de la sección 8.3 completa, sin reescribir ni una fila existente y sin que
-- una factura deje de encontrar su memoria. El buscador consulta los dos
-- patrones y prefiere el de la versión más alta.
-- -----------------------------------------------------------------------------
ALTER TABLE memoria_clasificacion
  ADD COLUMN normalizador_version integer NOT NULL DEFAULT 1
    CHECK (normalizador_version > 0);

COMMENT ON COLUMN memoria_clasificacion.normalizador_version IS
  'Versión del normalizador que produjo patron_descripcion. 1 = mínima de la Ola 1 (minúsculas + trim). 2 = sección 8.3 completa (sin tildes, sin números variables, sin fechas).';

ALTER TABLE memoria_clasificacion
  ADD CONSTRAINT memoria_clasificacion_patron_limpio_ck
  CHECK (patron_descripcion = btrim(patron_descripcion) AND patron_descripcion <> '');

-- -----------------------------------------------------------------------------
-- Resolución de parámetros dentro del motor.
--
-- No es SECURITY DEFINER a propósito: corre con los privilegios y la RLS de
-- quien llama, y además filtra por tenant/company explícitamente para que se
-- comporte igual bajo el contexto de administración del worker, donde no hay
-- RLS que la respalde.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.parametro_clasificacion(p_clave text) RETURNS jsonb
  LANGUAGE sql STABLE AS $$
  SELECT p.valor
    FROM parametro_clasificacion p
   WHERE p.clave = p_clave
     AND (p.tenant_id  IS NULL OR p.tenant_id  = app.current_tenant_id())
     AND (p.company_id IS NULL OR p.company_id = app.current_company_id())
   ORDER BY (p.company_id IS NOT NULL) DESC, (p.tenant_id IS NOT NULL) DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION app.parametro_clasificacion(text) IS
  'Resuelve un parámetro de clasificación con precedencia empresa → firma → plataforma. Devuelve NULL si nadie lo definió: quien la llama debe negarse a suponer un valor, no inventarlo.';

CREATE OR REPLACE FUNCTION app.memoria_compartida_en_firma() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app.parametro_clasificacion('memoria_alcance') = '"firma"'::jsonb, false);
$$;

-- -----------------------------------------------------------------------------
-- (4) Alcance de la memoria impuesto por el motor.
--
-- Política ADICIONAL de SELECT, permisiva: se suma (OR) a la política de doble
-- nivel que instaló 012. Con el valor por defecto ('empresa') es falsa y no
-- cambia absolutamente nada. Con 'firma' deja LEER —nunca escribir— las
-- entradas de las demás empresas de LA MISMA firma. La frontera de tenant no
-- se toca en ningún caso.
-- -----------------------------------------------------------------------------
CREATE POLICY memoria_clasificacion_firma_rls ON memoria_clasificacion
  FOR SELECT
  USING (tenant_id = app.current_tenant_id() AND app.memoria_compartida_en_firma());

COMMENT ON POLICY memoria_clasificacion_firma_rls ON memoria_clasificacion IS
  'Sección 8.3: «si la memoria es por empresa o compartida a nivel de firma» es un parámetro. Se implementa en el motor, no con un filtro de aplicación (Regla de Oro 7). Solo SELECT, solo dentro de la misma firma.';

-- -----------------------------------------------------------------------------
-- RLS, permisos y auditoría de las tablas nuevas
-- -----------------------------------------------------------------------------
SELECT app.instalar_rls_hibrida('parametro_clasificacion');
SELECT app.instalar_rls_hibrida_tenant('prompt_clasificacion');
SELECT app.instalar_rls_tenant_company('clasificacion_pendiente');

-- Tocar los umbrales de confianza es configurar la empresa, no editar un
-- parámetro tributario: se exige 'empresa.administrar', que solo tiene el
-- administrador de firma. Cambiar un prompt es más sensible todavía y se
-- exige 'parametro.editar'. Resolver una fila de la cola es decidir un
-- concepto: 'concepto.editar', el mismo permiso que ya protege
-- memoria_clasificacion desde 016.
SELECT app.instalar_permiso_escritura('parametro_clasificacion',  'empresa.administrar');
SELECT app.instalar_permiso_escritura('prompt_clasificacion',     'parametro.editar');
SELECT app.instalar_permiso_escritura('clasificacion_pendiente',  'concepto.editar');

SELECT app.instalar_trigger_auditoria('parametro_clasificacion');
SELECT app.instalar_trigger_auditoria('prompt_clasificacion');

-- Guardias de alcance (D-032): ninguna columna FK nueva puede apuntar a una
-- fila de otra firma o de otra empresa.
SELECT app.instalar_guardia_alcance('parametro_clasificacion', 'company_id', 'company');
SELECT app.instalar_guardia_alcance('clasificacion_pendiente',
  'company_id', 'company',
  'source_document_id', 'source_document',
  'third_party_id', 'third_party',
  'concepto_propuesto_id', 'concepto_causacion',
  'concepto_confirmado_id', 'concepto_causacion',
  'memoria_clasificacion_id', 'memoria_clasificacion',
  'extraction_id', 'extraction',
  'resuelto_por', 'user');

-- 013_grants.sql concedió sobre las tablas que existían entonces.
GRANT SELECT, INSERT, UPDATE, DELETE ON parametro_clasificacion  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON clasificacion_pendiente  TO app_user;
-- El prompt no se corrige ni se borra: se versiona.
GRANT SELECT, INSERT ON prompt_clasificacion TO app_user;

-- =============================================================================
-- VALORES POR DEFECTO DE PLATAFORMA (tenant_id NULL, company_id NULL)
--
-- Umbrales, en milésimas para no escribir un decimal en ninguna parte:
--
--  · auto-aprobación 900/1000. Por encima, la propuesta se aplica sola a la
--    causación —que sigue yendo a la bandeja de aprobación humana, la Regla de
--    Oro no se toca—. Se elige alto a propósito: un concepto equivocado
--    arrastra la cuenta PUC Y la regla de retención, y el error termina en una
--    declaración presentada. Revisar una factura de más cuesta minutos;
--    corregir una retención mal practicada cuesta una corrección.
--
--  · propuesta 700/1000. Entre 700 y 899 la propuesta se muestra precargada
--    pero exige confirmación explícita. Por debajo de 700 la fila va a la cola
--    SIN propuesta: una sugerencia mala precargada es peor que ninguna, porque
--    induce a aprobarla por inercia.
--
--  · memoria por empresa. Compartirla en la firma se activa por parámetro.
--
--  · revalidación a los 365 días: una entrada que lleva un año sin que nadie
--    la confirme vuelve a la cola de revisión (con su concepto como propuesta,
--    sin gastar una llamada) en vez de aplicarse sola para siempre.
--
-- Precios del proveedor, en millonésimas de USD por millón de tokens
-- (verificados el 26-ago-2026 para Haiku 4.5: USD 1 de entrada y USD 5 de
-- salida por millón). No son valores tributarios: son el precio de un servicio
-- de cómputo, y por eso mismo cambian sin que cambie ninguna norma. Viven en
-- tabla para que A15 los actualice sin tocar código.
--
-- Techo de costo por documento: 20.000 millonésimas de USD = USD 0,02, el
-- límite duro que fijó A15 antes de caché.
-- =============================================================================
INSERT INTO parametro_clasificacion (tenant_id, company_id, clave, valor, descripcion) VALUES
  (NULL, NULL, 'umbral_auto_aprobacion_milesimas', '900'::jsonb,
   'Score mínimo, en milésimas, para aplicar la propuesta sin confirmación previa de concepto.'),
  (NULL, NULL, 'umbral_propuesta_milesimas', '700'::jsonb,
   'Score mínimo, en milésimas, para mostrar la propuesta precargada. Por debajo, cola de revisión sin propuesta.'),
  (NULL, NULL, 'memoria_alcance', '"empresa"'::jsonb,
   'empresa | firma. Con firma, la memoria se lee entre empresas de la misma firma (política RLS memoria_clasificacion_firma_rls).'),
  (NULL, NULL, 'memoria_revalidar_tras_dias', '365'::jsonb,
   'Antigüedad de la última confirmación tras la cual una entrada de memoria vuelve a revisión humana.'),
  (NULL, NULL, 'prompt_codigo', '"clasificacion_concepto"'::jsonb,
   'Código del prompt de clasificación en uso.'),
  (NULL, NULL, 'prompt_version', '1'::jsonb,
   'Versión activa del prompt. Cambiarla es un evento auditado (sección 8.4).'),
  (NULL, NULL, 'precio_micros_usd_por_millon_entrada', '1000000'::jsonb,
   'Precio del modelo por millón de tokens de entrada, en millonésimas de USD. Verificado 26-ago-2026.'),
  (NULL, NULL, 'precio_micros_usd_por_millon_salida', '5000000'::jsonb,
   'Precio del modelo por millón de tokens de salida, en millonésimas de USD. Verificado 26-ago-2026.'),
  (NULL, NULL, 'costo_maximo_micros_usd_por_documento', '20000'::jsonb,
   'Techo de A15 por documento antes de caché, en millonésimas de USD. Superarlo aborta la clasificación por IA.'),
  (NULL, NULL, 'catalogo_maximo_conceptos', '120'::jsonb,
   'Cuántos conceptos como máximo entran en el prompt. Acota el costo por llamada y mantiene el catálogo cerrado.');

-- -----------------------------------------------------------------------------
-- Prompt de plataforma, versión 1.
--
-- Está escrito para que la respuesta sea un identificador de un catálogo
-- CERRADO y un score, nunca texto libre y nunca una tarifa (Regla de Oro 4).
-- El hash lo calcula la propia base a partir de las plantillas, así que no se
-- puede sembrar un hash que no corresponda.
-- -----------------------------------------------------------------------------
INSERT INTO prompt_clasificacion (
  tenant_id, codigo, version, plantilla_sistema, plantilla_usuario,
  modelo, temperatura_milesimas, max_tokens_salida, hash_plantilla, notas)
SELECT
  NULL,
  'clasificacion_concepto',
  1,
  s.sistema,
  u.usuario,
  'claude-haiku-4-5',
  0,
  64,
  encode(sha256(convert_to(s.sistema || E'\n' || u.usuario, 'UTF8')), 'hex'),
  'Versión inicial de A5 (Ola 2). Catálogo cerrado, salida JSON de dos campos, temperatura mínima.'
FROM (SELECT
  'Eres un clasificador contable colombiano. Recibes la descripcion de una linea de una factura de compra y un CATALOGO CERRADO de conceptos de causacion. '
  || 'Devuelves UNICAMENTE un objeto JSON con dos campos: "codigo" (un codigo textual copiado EXACTAMENTE del catalogo, o null si ninguno corresponde) y "score" (entero de 0 a 1000 que expresa tu confianza). '
  || 'Prohibido: inventar codigos que no esten en el catalogo, devolver texto fuera del JSON, calcular impuestos, mencionar porcentajes, bases o retenciones. '
  || 'No decides cuanto se retiene: solo que concepto es. El calculo lo hace un motor determinista a partir de reglas parametrizadas.' AS sistema) s,
(SELECT
  'CATALOGO:' || E'\n' || '{{catalogo}}' || E'\n\n'
  || 'PROVEEDOR: {{proveedor}}' || E'\n'
  || 'DESCRIPCION NORMALIZADA: {{descripcion}}' || E'\n\n'
  || 'Responde solo el JSON.' AS usuario) u;

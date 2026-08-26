-- =============================================================================
-- 018_a2_alcance_fk_y_truncate.sql — Agente A2, corrección posterior a la Ola 0
--
-- Cierra los dos defectos que A14 levantó contra A2:
--
-- D-032 (bloqueaba la Ola 1) — `journal_line.account_id` llevaba una FK simple
--   a `account`. Como las comprobaciones de clave foránea NO pasan por RLS, una
--   partida de la firma A podía imputarse contra una cuenta de la firma B, y esa
--   partida, una vez publicada, es inmutable. No es fuga de confidencialidad
--   (la RLS sigue tapando la lectura), es un agujero de integridad: el ledger
--   quedaba capaz de referenciar un plan de cuentas ajeno.
--
--   Era incoherente con mi propia D-016. Al recorrer TODAS las claves foráneas
--   desde `pg_constraint` en vez de arreglar solo la columna denunciada,
--   aparecieron 71 huecos del mismo patrón, no uno. Entre ellos
--   `retention_applied.tax_rule_id`, que estaba escondido detrás de la FK
--   compuesta de vigencia `(tax_rule_id, regla_vigente_desde)`: es compuesta,
--   pero no lleva `tenant_id`, así que no acota el alcance.
--
-- D-033 (no bloqueaba) — no había trigger `ON TRUNCATE`. Un `BEFORE DELETE FOR
--   EACH ROW` no se dispara con TRUNCATE, así que la única defensa era que
--   ningún rol de aplicación tuviera el privilegio. Eso es mitigación por GRANT,
--   y un GRANT se concede por error. Ahora lo impone el motor.
--
-- -----------------------------------------------------------------------------
-- DOS MECANISMOS, SEGÚN LA FORMA DEL PADRE
-- -----------------------------------------------------------------------------
--   a) Padre de alcance ESTRICTO (`tenant_id` NOT NULL): FK compuesta
--      `(columna, tenant_id[, company_id])`. Declarativa, la impone el motor sin
--      código y es la que ya usa D-016. 18 casos.
--
--   b) Padre HÍBRIDO (`tenant_id` puede ser NULL porque es catálogo global:
--      `account`, `municipality`, `tax_rule`, `role`...): la FK compuesta NO es
--      expresable, porque la fila global tiene `tenant_id IS NULL` y la hija lo
--      tiene NOT NULL. Ahí va un trigger genérico que compara alcances y deja
--      pasar lo global. 53 casos en 21 tablas.
--
-- SQLSTATE nuevo: AL001 (FK_ALCANCE_AJENO).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Falta el índice único de alcance en memoria_clasificacion para poder
-- referenciarla con FK compuesta desde extraction.
-- -----------------------------------------------------------------------------
ALTER TABLE memoria_clasificacion
  ADD CONSTRAINT memoria_clasificacion_id_scope_uq UNIQUE (id, tenant_id, company_id);

-- =============================================================================
-- (a) FK COMPUESTAS — padre de alcance estricto
-- =============================================================================
CREATE OR REPLACE FUNCTION app.reemplazar_fk_por_compuesta(
  p_tabla        text,
  p_columna      text,
  p_padre        text,
  p_cols_alcance text[]
) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  v_con    text;
  v_hijas  text;
  v_padres text;
  v_nombre text;
BEGIN
  -- La FK simple que se va a sustituir. Se busca por catálogo y no por nombre
  -- porque las creadas con REFERENCES en línea llevan nombre autogenerado.
  SELECT con.conname INTO v_con
    FROM pg_constraint con
    JOIN pg_class h ON h.oid = con.conrelid
    JOIN pg_class p ON p.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = h.relnamespace
   WHERE con.contype = 'f'
     AND n.nspname = 'public'
     AND h.relname = p_tabla
     AND p.relname = p_padre
     AND array_length(con.conkey, 1) = 1
     AND (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) = p_columna;

  IF v_con IS NULL THEN
    RAISE EXCEPTION 'No se encontró la FK simple %.% -> %', p_tabla, p_columna, p_padre;
  END IF;

  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_tabla, v_con);

  SELECT quote_ident(p_columna) || ', ' || string_agg(quote_ident(c), ', ' ORDER BY o),
         'id, '                 || string_agg(quote_ident(c), ', ' ORDER BY o)
    INTO v_hijas, v_padres
    FROM unnest(p_cols_alcance) WITH ORDINALITY AS u(c, o);

  v_nombre := p_tabla || '_' || p_columna || '_alcance_fk';

  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.%I (%s)',
    p_tabla, v_nombre, v_hijas, p_padre, v_padres);
END $$;

SELECT app.reemplazar_fk_por_compuesta('cost_center', 'parent_id', 'cost_center', '{tenant_id,company_id}');
SELECT app.reemplazar_fk_por_compuesta('extraction', 'company_id', 'company', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('extraction', 'memoria_clasificacion_id', 'memoria_clasificacion', '{tenant_id,company_id}');
SELECT app.reemplazar_fk_por_compuesta('fiscal_period', 'cerrado_por', 'user', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('journal_entry', 'created_by', 'user', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('journal_entry', 'posted_by', 'user', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('journal_line', 'company_id', 'company', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('memoria_clasificacion', 'company_id', 'company', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('memoria_clasificacion', 'confirmado_por', 'user', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('memoria_clasificacion', 'cost_center_id', 'cost_center', '{tenant_id,company_id}');
SELECT app.reemplazar_fk_por_compuesta('retention_applied', 'company_id', 'company', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('retention_applied', 'third_party_id', 'third_party', '{tenant_id,company_id}');
SELECT app.reemplazar_fk_por_compuesta('source_document', 'documento_referenciado_id', 'source_document', '{tenant_id,company_id}');
SELECT app.reemplazar_fk_por_compuesta('third_party_activity', 'company_id', 'company', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('third_party_activity', 'created_by', 'user', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('third_party_fiscal_attribute', 'company_id', 'company', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('third_party_fiscal_attribute', 'created_by', 'user', '{tenant_id}');
SELECT app.reemplazar_fk_por_compuesta('user_company_access', 'otorgado_por', 'user', '{tenant_id}');

-- =============================================================================
-- (b) GUARDIA DE ALCANCE — padre híbrido
-- =============================================================================
-- SECURITY DEFINER a propósito: la función tiene que ver la fila del padre
-- AUNQUE la RLS se la esconda al llamante. Si no, "no la veo" y "no existe"
-- serían indistinguibles, y una referencia cruzada pasaría el trigger y después
-- pasaría la FK (que tampoco mira RLS). Es decir, el agujero seguiría abierto.
--
-- `row_security = off` hace que, si algún día se despliega con un rol dueño
-- SUJETO a RLS, esto falle a gritos en vez de dejar pasar la comprobación en
-- silencio. Es la contrapartida de D-015: migraciones y seeds con rol
-- superusuario o BYPASSRLS.
--
-- No filtra nada: solo lee `tenant_id`/`company_id` del padre y el mensaje de
-- error no nombra a la otra firma.
CREATE OR REPLACE FUNCTION app.trg_fk_alcance() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
  AS $$
DECLARE
  v_fila     jsonb := to_jsonb(NEW);
  v_hijo_t   uuid  := NULLIF(v_fila->>'tenant_id',  '')::uuid;
  v_hijo_c   uuid  := NULLIF(v_fila->>'company_id', '')::uuid;
  i          int   := 0;
  v_col      text;
  v_padre    text;
  v_valor    uuid;
  v_pf       jsonb;
  v_pt       uuid;
  v_pc       uuid;
BEGIN
  WHILE i < TG_NARGS LOOP
    v_col   := TG_ARGV[i];
    v_padre := TG_ARGV[i + 1];
    v_valor := NULLIF(v_fila->>v_col, '')::uuid;

    IF v_valor IS NOT NULL THEN
      EXECUTE format('SELECT to_jsonb(p) FROM public.%I p WHERE p.id = $1', v_padre)
        INTO v_pf USING v_valor;

      -- Si la fila no existe, que lo diga la clave foránea real (23503). Aquí
      -- solo se juzga el alcance.
      IF v_pf IS NOT NULL THEN
        v_pt := NULLIF(v_pf->>'tenant_id',  '')::uuid;
        v_pc := NULLIF(v_pf->>'company_id', '')::uuid;

        -- El alcance se hereda hacia abajo, nunca de lado:
        --   global  (tenant NULL)            -> lo usa cualquiera
        --   de firma (company NULL)          -> lo usa cualquier empresa suya
        --   de empresa                       -> solo esa empresa
        -- Se rechaza el cruce, no el uso de algo más amplio. Por eso la
        -- comparación de empresa exige que AMBAS estén definidas: una regla de
        -- firma apuntando a una cuenta de firma es legítima, y el daño real
        -- (una partida imputada a la cuenta de otra empresa) lo caza igual,
        -- porque ahí las dos columnas sí están definidas.
        IF v_pt IS NOT NULL THEN
          IF v_pt IS DISTINCT FROM v_hijo_t THEN
            RAISE EXCEPTION
              'FK_ALCANCE_AJENO: %.% referencia una fila de % que pertenece a otra firma',
              TG_TABLE_NAME, v_col, v_padre
              USING ERRCODE = 'AL001';
          END IF;
          IF v_pc IS NOT NULL AND v_hijo_c IS NOT NULL AND v_pc <> v_hijo_c THEN
            RAISE EXCEPTION
              'FK_ALCANCE_AJENO: %.% referencia una fila de % que pertenece a otra empresa de la misma firma',
              TG_TABLE_NAME, v_col, v_padre
              USING ERRCODE = 'AL001';
          END IF;
        END IF;
      END IF;
    END IF;

    i := i + 2;
  END LOOP;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.instalar_guardia_alcance(
  p_tabla text,
  VARIADIC p_pares text[]
) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  v_args text;
BEGIN
  IF array_length(p_pares, 1) IS NULL OR array_length(p_pares, 1) % 2 <> 0 THEN
    RAISE EXCEPTION 'instalar_guardia_alcance espera pares (columna, tabla_padre)';
  END IF;

  SELECT string_agg(quote_literal(x), ', ' ORDER BY o) INTO v_args
    FROM unnest(p_pares) WITH ORDINALITY AS u(x, o);

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION app.trg_fk_alcance(%s)',
    p_tabla || '_fk_alcance', p_tabla, v_args);
END $$;

SELECT app.instalar_guardia_alcance('account', 'parent_id', 'account');
SELECT app.instalar_guardia_alcance('audit_log', 'company_id', 'company', 'user_id', 'user');
SELECT app.instalar_guardia_alcance('ciiu_activity', 'company_id', 'company');
SELECT app.instalar_guardia_alcance('company', 'ciiu_principal_id', 'ciiu_activity', 'municipality_id', 'municipality');
SELECT app.instalar_guardia_alcance('concepto_causacion',
  'company_id', 'company', 'cost_center_id', 'cost_center',
  'cuenta_contrapartida_id', 'account', 'cuenta_gasto_id', 'account',
  'cuenta_iva_descontable_id', 'account',
  'tax_concept_autorretencion_id', 'tax_concept', 'tax_concept_retefuente_id', 'tax_concept',
  'tax_concept_reteica_id', 'tax_concept', 'tax_concept_reteiva_id', 'tax_concept');
SELECT app.instalar_guardia_alcance('extraction', 'account_propuesta_id', 'account', 'concepto_propuesto_id', 'concepto_causacion');
SELECT app.instalar_guardia_alcance('journal_line', 'account_id', 'account');
SELECT app.instalar_guardia_alcance('memoria_clasificacion', 'account_id', 'account', 'concepto_causacion_id', 'concepto_causacion');
SELECT app.instalar_guardia_alcance('municipality', 'company_id', 'company');
SELECT app.instalar_guardia_alcance('municipality_ica_rule', 'company_id', 'company', 'created_by', 'user', 'municipality_id', 'municipality');
SELECT app.instalar_guardia_alcance('niif_mapping', 'account_id', 'account', 'company_id', 'company', 'created_by', 'user');
SELECT app.instalar_guardia_alcance('retention_applied',
  'account_id', 'account', 'ciiu_activity_id', 'ciiu_activity',
  'concepto_causacion_id', 'concepto_causacion', 'municipality_id', 'municipality',
  'rounding_rule_id', 'rounding_rule', 'tax_rule_id', 'tax_rule');
SELECT app.instalar_guardia_alcance('rounding_rule', 'company_id', 'company', 'created_by', 'user');
SELECT app.instalar_guardia_alcance('smmlv_value', 'company_id', 'company', 'created_by', 'user');
SELECT app.instalar_guardia_alcance('tax_calendar', 'company_id', 'company', 'created_by', 'user', 'municipality_id', 'municipality');
SELECT app.instalar_guardia_alcance('tax_concept', 'company_id', 'company');
SELECT app.instalar_guardia_alcance('tax_rule',
  'account_id', 'account', 'ciiu_activity_id', 'ciiu_activity', 'company_id', 'company',
  'created_by', 'user', 'municipality_id', 'municipality', 'tax_concept_id', 'tax_concept');
SELECT app.instalar_guardia_alcance('third_party', 'municipality_id', 'municipality');
SELECT app.instalar_guardia_alcance('third_party_activity', 'ciiu_activity_id', 'ciiu_activity', 'municipality_id', 'municipality');
SELECT app.instalar_guardia_alcance('user_company_access', 'role_id', 'role');
SELECT app.instalar_guardia_alcance('uvt_value', 'company_id', 'company', 'created_by', 'user');

-- Los instaladores son DDL, no API de aplicación.
REVOKE EXECUTE ON FUNCTION app.reemplazar_fk_por_compuesta(text, text, text, text[]) FROM app_user;
REVOKE EXECUTE ON FUNCTION app.instalar_guardia_alcance(text, text[])                FROM app_user;

-- `trg_fk_alcance` es SECURITY DEFINER, así que NO puede quedar en la lista de
-- funciones invocables por la aplicación: engorda la superficie que A14 audita
-- sin ninguna razón. El privilegio EXECUTE sobre una función de trigger se
-- comprueba al CREAR el trigger, no al dispararlo, así que revocarlo no impide
-- que el guardia funcione. Se revoca también de PUBLIC, que es el destinatario
-- por defecto de toda función nueva en PostgreSQL.
REVOKE EXECUTE ON FUNCTION app.trg_fk_alcance() FROM app_user;
REVOKE EXECUTE ON FUNCTION app.trg_fk_alcance() FROM PUBLIC;

-- =============================================================================
-- D-033 — TRUNCATE bloqueado por el motor, no por el privilegio
-- =============================================================================
CREATE OR REPLACE FUNCTION app.trg_prohibir_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'TRUNCATE_PROHIBIDO: % es append-only; TRUNCATE lo bloquea el motor, no el privilegio. Un BEFORE DELETE FOR EACH ROW no se dispara con TRUNCATE.',
    TG_TABLE_NAME
    USING ERRCODE = TG_ARGV[0];
END $$;

CREATE TRIGGER journal_entry_no_truncate
  BEFORE TRUNCATE ON journal_entry
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_prohibir_truncate('LG001');

CREATE TRIGGER journal_line_no_truncate
  BEFORE TRUNCATE ON journal_line
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_prohibir_truncate('LG001');

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_prohibir_truncate('AU001');

CREATE TRIGGER approval_no_truncate
  BEFORE TRUNCATE ON approval
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_prohibir_truncate('AU001');

CREATE TRIGGER retention_applied_no_truncate
  BEFORE TRUNCATE ON retention_applied
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_prohibir_truncate('LG001');

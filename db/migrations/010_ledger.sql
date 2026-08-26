-- =============================================================================
-- 010_ledger.sql — Ledger de doble partida append-only (Regla de Oro 1)
--
-- CICLO DE VIDA OBLIGATORIO DE UN ASIENTO:
--   1. INSERT en estado 'draft'  (insertar directamente en 'posted' se rechaza,
--      LG007: un asiento nace sin partidas y no podría validarse).
--   2. INSERT de las journal_line mientras el asiento sigue en 'draft'.
--   3. UPDATE único a 'posted'  -> app.publicar_asiento()
--   4. A partir de ahí NADA se modifica ni se borra. Toda corrección es un
--      asiento de reversa que apunta al original con `reverses_entry_id`.
--
-- La validación de balance es un CONSTRAINT TRIGGER DEFERRABLE INITIALLY
-- DEFERRED: se evalúa en el COMMIT, no en cada INSERT, porque durante la
-- construcción del asiento el descuadre es normal. Rechazar en el COMMIT es
-- rechazar en la base de datos, no en la aplicación.
--
-- `reversed_by` NO es columna física: marcarla exigiría un UPDATE sobre un
-- asiento ya publicado, que es exactamente lo que la Regla de Oro 1 prohíbe.
-- El vínculo lo guarda el asiento de reversa y se expone derivado en la vista
-- `v_journal_entry` (ver 011_vistas.sql).
-- =============================================================================

CREATE TABLE journal_entry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  company_id            uuid NOT NULL REFERENCES company(id),
  fiscal_period_id      uuid NOT NULL REFERENCES fiscal_period(id),
  numero                bigint NOT NULL,
  tipo                  text NOT NULL DEFAULT 'causacion'
                          CHECK (tipo IN ('causacion','reversa','ajuste','apertura','cierre','traslado')),
  fecha_hecho_economico date NOT NULL,
  descripcion           text NOT NULL,
  estado                text NOT NULL DEFAULT 'draft'
                          CHECK (estado IN ('draft','posted','anulado')),
  -- Relaciones obligatorias de la sección 15
  source_document_id    uuid NOT NULL REFERENCES source_document(id),
  approval_id           uuid NOT NULL REFERENCES approval(id),
  reverses_entry_id     uuid REFERENCES journal_entry(id),
  posted_at             timestamptz,
  posted_by             uuid REFERENCES "user"(id),
  -- Determinismo (sección 8.4 / caso dorado 18): reprocesar el mismo documento
  -- no puede crear un segundo asiento.
  idempotency_key       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES "user"(id),
  CONSTRAINT journal_entry_numero_uq      UNIQUE (company_id, numero),
  CONSTRAINT journal_entry_idem_uq        UNIQUE (company_id, idempotency_key),
  CONSTRAINT journal_entry_id_scope_uq    UNIQUE (id, tenant_id, company_id),
  CONSTRAINT journal_entry_reversa_uq     UNIQUE (reverses_entry_id),
  CONSTRAINT journal_entry_posted_ck      CHECK (estado <> 'posted' OR posted_at IS NOT NULL),
  CONSTRAINT journal_entry_reversa_tipo_ck
    CHECK (reverses_entry_id IS NULL OR tipo = 'reversa'),
  CONSTRAINT journal_entry_no_autoreversa_ck
    CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id),
  CONSTRAINT journal_entry_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT journal_entry_periodo_fk FOREIGN KEY (fiscal_period_id, tenant_id, company_id)
    REFERENCES fiscal_period (id, tenant_id, company_id),
  CONSTRAINT journal_entry_documento_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT journal_entry_approval_fk FOREIGN KEY (approval_id, tenant_id, company_id)
    REFERENCES approval (id, tenant_id, company_id),
  CONSTRAINT journal_entry_reversa_fk FOREIGN KEY (reverses_entry_id, tenant_id, company_id)
    REFERENCES journal_entry (id, tenant_id, company_id)
);

CREATE INDEX journal_entry_scope_idx     ON journal_entry (tenant_id, company_id, fecha_hecho_economico);
CREATE INDEX journal_entry_periodo_idx   ON journal_entry (fiscal_period_id);
CREATE INDEX journal_entry_documento_idx ON journal_entry (source_document_id);
CREATE INDEX journal_entry_estado_idx    ON journal_entry (company_id, estado);

COMMENT ON COLUMN journal_entry.idempotency_key IS
  'Clave determinista del asiento (documento + versión de reglas). Reprocesar N veces produce el mismo asiento, no N asientos.';

-- -----------------------------------------------------------------------------
CREATE TABLE journal_line (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  company_id           uuid NOT NULL REFERENCES company(id),
  journal_entry_id     uuid NOT NULL REFERENCES journal_entry(id),
  linea                smallint NOT NULL CHECK (linea > 0),
  account_id           uuid NOT NULL REFERENCES account(id),
  side                 text NOT NULL CHECK (side IN ('debito','credito')),
  -- Dinero entero en centavos, siempre positivo: el signo lo da `side` (D-005).
  monto                bigint NOT NULL CHECK (monto > 0),
  third_party_id       uuid REFERENCES third_party(id),
  cost_center_id       uuid REFERENCES cost_center(id),
  retention_applied_id uuid REFERENCES retention_applied(id),
  base_gravable        bigint CHECK (base_gravable IS NULL OR base_gravable >= 0),
  descripcion          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_line_uq UNIQUE (journal_entry_id, linea),
  CONSTRAINT journal_line_entry_fk FOREIGN KEY (journal_entry_id, tenant_id, company_id)
    REFERENCES journal_entry (id, tenant_id, company_id),
  CONSTRAINT journal_line_tercero_fk FOREIGN KEY (third_party_id, tenant_id, company_id)
    REFERENCES third_party (id, tenant_id, company_id),
  CONSTRAINT journal_line_cost_center_fk FOREIGN KEY (cost_center_id, tenant_id, company_id)
    REFERENCES cost_center (id, tenant_id, company_id),
  CONSTRAINT journal_line_retencion_fk FOREIGN KEY (retention_applied_id, tenant_id, company_id)
    REFERENCES retention_applied (id, tenant_id, company_id)
);

CREATE INDEX journal_line_entry_idx   ON journal_line (journal_entry_id);
CREATE INDEX journal_line_account_idx ON journal_line (tenant_id, company_id, account_id);
CREATE INDEX journal_line_tercero_idx ON journal_line (third_party_id);

-- FK pendiente de 008: la retención sabe en qué asiento quedó registrada.
ALTER TABLE retention_applied
  ADD CONSTRAINT retention_applied_asiento_fk
  FOREIGN KEY (journal_entry_id, tenant_id, company_id)
  REFERENCES journal_entry (id, tenant_id, company_id);

-- =============================================================================
-- TRIGGERS DE INMUTABILIDAD
-- =============================================================================

-- Consecutivo por empresa + prohibición de nacer publicado.
CREATE OR REPLACE FUNCTION app.trg_journal_entry_before_insert() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'posted' THEN
    RAISE EXCEPTION
      'ASIENTO_DEBE_NACER_BORRADOR: un journal_entry se inserta en estado ''draft'' y se publica después con app.publicar_asiento(); insertarlo ya publicado impediría validar sus partidas'
      USING ERRCODE = 'LG007';
  END IF;

  IF NEW.numero IS NULL OR NEW.numero <= 0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 0));
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM journal_entry WHERE company_id = NEW.company_id;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER journal_entry_before_insert
  BEFORE INSERT ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION app.trg_journal_entry_before_insert();

-- Regla de Oro 1: un asiento publicado no admite UPDATE. Nunca hay DELETE.
CREATE OR REPLACE FUNCTION app.trg_journal_entry_inmutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'LEDGER_INMUTABLE: journal_entry es append-only; DELETE está prohibido (asiento %, estado %). Corrija con un asiento de reversa.',
      OLD.id, OLD.estado
      USING ERRCODE = 'LG001';
  END IF;

  IF OLD.estado = 'posted' THEN
    RAISE EXCEPTION
      'LEDGER_INMUTABLE: el asiento % (número %) está publicado y no admite UPDATE. Corrija con un asiento de reversa que lo referencie.',
      OLD.id, OLD.numero
      USING ERRCODE = 'LG001';
  END IF;

  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION
      'LEDGER_INMUTABLE: el asiento borrador % fue anulado y no admite cambios',
      OLD.id
      USING ERRCODE = 'LG001';
  END IF;

  IF NEW.estado NOT IN ('draft','posted','anulado') THEN
    RAISE EXCEPTION 'LEDGER_INMUTABLE: transición de estado inválida % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'LG001';
  END IF;

  -- Datos de publicación: se sellan aquí, no los pone la aplicación.
  IF NEW.estado = 'posted' AND OLD.estado <> 'posted' THEN
    NEW.posted_at := COALESCE(NEW.posted_at, now());
    NEW.posted_by := COALESCE(NEW.posted_by, app.current_user_id());
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER journal_entry_inmutable
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION app.trg_journal_entry_inmutable();

-- Las partidas de un asiento publicado tampoco se tocan.
CREATE OR REPLACE FUNCTION app.trg_journal_line_inmutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_entry  uuid;
  v_estado text;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT estado INTO v_estado FROM journal_entry WHERE id = v_entry;

  IF v_estado = 'posted' THEN
    RAISE EXCEPTION
      'LEDGER_INMUTABLE: el asiento % está publicado; sus partidas no admiten % (Regla de Oro 1)',
      v_entry, TG_OP
      USING ERRCODE = 'LG001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER journal_line_inmutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION app.trg_journal_line_inmutable();

-- =============================================================================
-- VALIDACIÓN DIFERIDA DE LA PUBLICACIÓN — se evalúa en el COMMIT
-- =============================================================================
CREATE OR REPLACE FUNCTION app.trg_journal_entry_validar_publicacion() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_partidas   integer;
  v_saldo      bigint;
  v_cuenta     text;
  v_periodo    text;
  v_decision   text;
  v_rev_estado text;
BEGIN
  IF NEW.estado <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::int,
         COALESCE(SUM(CASE WHEN side = 'debito' THEN monto ELSE -monto END), 0)
    INTO v_partidas, v_saldo
    FROM journal_line
   WHERE journal_entry_id = NEW.id;

  IF v_partidas < 2 THEN
    RAISE EXCEPTION
      'ASIENTO_SIN_PARTIDAS: el asiento % se publica con % partida(s); la doble partida exige al menos 2',
      NEW.id, v_partidas
      USING ERRCODE = 'LG003';
  END IF;

  IF v_saldo <> 0 THEN
    RAISE EXCEPTION
      'ASIENTO_DESBALANCEADO: el asiento % descuadra en % centavos (débitos menos créditos)',
      NEW.id, v_saldo
      USING ERRCODE = 'LG002';
  END IF;

  SELECT a.codigo INTO v_cuenta
    FROM journal_line jl
    JOIN account a ON a.id = jl.account_id
   WHERE jl.journal_entry_id = NEW.id
     AND NOT a.permite_movimiento
   LIMIT 1;
  IF v_cuenta IS NOT NULL THEN
    RAISE EXCEPTION
      'CUENTA_NO_IMPUTABLE: la cuenta % no permite movimiento; solo se imputa sobre cuentas hoja del PUC',
      v_cuenta
      USING ERRCODE = 'LG004';
  END IF;

  SELECT estado INTO v_periodo FROM fiscal_period WHERE id = NEW.fiscal_period_id;
  IF v_periodo IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION
      'PERIODO_CERRADO: el período fiscal % está en estado "%" y no admite publicaciones',
      NEW.fiscal_period_id, COALESCE(v_periodo, 'inexistente')
      USING ERRCODE = 'LG005';
  END IF;

  SELECT decision INTO v_decision FROM approval WHERE id = NEW.approval_id;
  IF v_decision IS DISTINCT FROM 'aprobado' THEN
    RAISE EXCEPTION
      'ASIENTO_SIN_APROBACION: la aprobación % tiene decisión "%"; un asiento solo se publica con aprobación humana explícita',
      NEW.approval_id, COALESCE(v_decision, 'inexistente')
      USING ERRCODE = 'LG006';
  END IF;

  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT estado INTO v_rev_estado FROM journal_entry WHERE id = NEW.reverses_entry_id;
    IF v_rev_estado IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION
        'REVERSA_INVALIDA: el asiento % pretende reversar a %, que está en estado "%"; solo se reversa lo publicado',
        NEW.id, NEW.reverses_entry_id, COALESCE(v_rev_estado, 'inexistente')
        USING ERRCODE = 'LG008';
    END IF;
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_entry_validar_publicacion
  AFTER INSERT OR UPDATE ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.trg_journal_entry_validar_publicacion();

-- Red de seguridad: si alguna partida cambia dentro de la misma transacción en
-- que el asiento se publica, el balance se vuelve a verificar en el COMMIT.
CREATE OR REPLACE FUNCTION app.trg_journal_line_validar_balance() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_entry    uuid;
  v_estado   text;
  v_saldo    bigint;
  v_partidas integer;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT estado INTO v_estado FROM journal_entry WHERE id = v_entry;

  IF v_estado IS DISTINCT FROM 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::int,
         COALESCE(SUM(CASE WHEN side = 'debito' THEN monto ELSE -monto END), 0)
    INTO v_partidas, v_saldo
    FROM journal_line WHERE journal_entry_id = v_entry;

  -- Con menos de dos partidas el diagnóstico correcto es LG003, y lo emite el
  -- trigger del asiento. Aquí se calla para no tapar ese mensaje con un LG002.
  IF v_partidas < 2 THEN
    RETURN NULL;
  END IF;

  IF v_saldo <> 0 THEN
    RAISE EXCEPTION
      'ASIENTO_DESBALANCEADO: el asiento % descuadra en % centavos (débitos menos créditos)',
      v_entry, v_saldo
      USING ERRCODE = 'LG002';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_line_validar_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.trg_journal_line_validar_balance();

-- =============================================================================
-- API mínima de publicación, para que A6 no reinvente la transición de estado.
-- =============================================================================
CREATE OR REPLACE FUNCTION app.publicar_asiento(
  p_journal_entry_id uuid,
  p_user_id          uuid DEFAULT NULL
) RETURNS journal_entry
  LANGUAGE plpgsql AS $$
DECLARE
  v_row journal_entry;
BEGIN
  UPDATE journal_entry
     SET estado    = 'posted',
         posted_at = now(),
         posted_by = COALESCE(p_user_id, app.current_user_id())
   WHERE id = p_journal_entry_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASIENTO_INEXISTENTE: no se encontró el asiento % en el contexto actual', p_journal_entry_id
      USING ERRCODE = 'LG008';
  END IF;

  RETURN v_row;
END $$;

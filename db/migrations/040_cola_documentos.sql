-- =============================================================================
-- 040_cola_documentos.sql — A6, Ola 1: cola asíncrona de procesamiento sobre
-- la misma PostgreSQL (sección 5: sin servicio adicional pago).
--
-- QUÉ ENCOLA Y QUÉ NO. El parser de A4 (`procesarAdjuntoXml`, ver
-- `src/ingest/tipos.ts`) es una función PURA sin I/O: extraer campos de un XML
-- ya recibido no es "procesamiento de facturas" en el sentido que la sección 5
-- prohíbe dentro del request — es decodificación. Lo que la Regla de A15
-- prohíbe en el request HTTP es la CAUSACIÓN: resolver retenciones (A3, que sí
-- hace varias consultas por regla) y construir el asiento. Por eso la firma es
-- `document_processing_job(source_document_id, tipo)`: el documento YA existe
-- (ingest lo insertó, sincrónico y barato) y lo que se encola es su
-- procesamiento contable. Ver docs/reportes/ola1-a6.md, "Qué corre en el
-- request y qué corre en la cola" para la justificación completa.
--
-- DISEÑO: una fila por (source_document_id, tipo) que se REUTILIZA en cada
-- reintento — no se inserta una fila nueva por intento. `intentos` cuenta
-- cuántas veces se tomó, `max_intentos` es el límite, y agotarlo mueve la fila
-- a 'agotado' (la cola de fallidos: se lee con
-- `estado = 'agotado'`, no se pierde y no se retoma sola). Esto hace que
-- encolar sea, por construcción, IDEMPOTENTE a nivel de base de datos
-- (D-003): reencolar el mismo documento dos veces no crea un segundo trabajo,
-- choca con `document_processing_job_doc_tipo_uq` y el llamador recupera la
-- fila existente.
--
-- CONCURRENCIA: `reclamar_siguiente_job` hace
-- `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` en una
-- sola sentencia. Es atómico por construcción (una sola sentencia de
-- PostgreSQL) y `SKIP LOCKED` es lo que impide que dos workers concurrentes
-- reclamen la misma fila: el segundo, si llega mientras el primero la tiene
-- bloqueada, simplemente la salta y mira la siguiente en vez de esperar y
-- reclamarla también.
--
-- QUIÉN LA OPERA: el worker que reclama y cierra trabajos corre en el
-- contexto de administración (`withAdminContext`, `src/db/tenant-context.ts`)
-- porque tiene que ver la cola de TODAS las firmas para no tener que abrir una
-- conexión por tenant — es exactamente la definición de "tarea de plataforma"
-- que ese contexto ya documenta, no una petición de usuario. El INSERT que
-- ENCOLA un trabajo, en cambio, lo hace la sesión normal de quien ingesta el
-- documento (RLS activa, D-021), dentro de la MISMA transacción que crea el
-- `source_document` — si el INSERT del documento se revierte, el trabajo
-- encolado se revierte con él.
-- =============================================================================

CREATE TABLE document_processing_job (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  company_id          uuid NOT NULL REFERENCES company(id),
  source_document_id  uuid NOT NULL REFERENCES source_document(id),
  tipo                text NOT NULL DEFAULT 'causacion'
                        CHECK (tipo IN ('causacion')),
  estado              text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'en_proceso', 'completado', 'agotado')),
  intentos            integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  max_intentos        integer NOT NULL DEFAULT 5 CHECK (max_intentos > 0),
  -- Backoff: la fila no es reclamable antes de esta marca (D-011 la resuelve
  -- distinto para vigencias; aquí no hay solape que evitar, solo visibilidad).
  disponible_en       timestamptz NOT NULL DEFAULT now(),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado           jsonb,
  ultimo_error        text,
  tomado_por          text,
  tomado_en           timestamptz,
  completado_en       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_processing_job_id_scope_uq UNIQUE (id, tenant_id, company_id),
  -- La idempotencia de la COLA: un documento tiene a lo sumo un trabajo de
  -- cada tipo, que se reutiliza en cada reintento y en cada reencolado manual.
  CONSTRAINT document_processing_job_doc_tipo_uq UNIQUE (source_document_id, tipo),
  CONSTRAINT document_processing_job_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES company (id, tenant_id),
  CONSTRAINT document_processing_job_documento_fk FOREIGN KEY (source_document_id, tenant_id, company_id)
    REFERENCES source_document (id, tenant_id, company_id),
  CONSTRAINT document_processing_job_toma_ck
    CHECK (estado <> 'en_proceso' OR tomado_en IS NOT NULL),
  CONSTRAINT document_processing_job_completado_ck
    CHECK (estado <> 'completado' OR completado_en IS NOT NULL),
  CONSTRAINT document_processing_job_intentos_ck
    CHECK (estado <> 'agotado' OR intentos >= max_intentos)
);

-- Índice que soporta exactamente la consulta de `reclamar_siguiente_job`:
-- trabajos pendientes ya visibles, en orden de llegada.
CREATE INDEX document_processing_job_cola_idx
  ON document_processing_job (disponible_en)
  WHERE estado = 'pendiente';

CREATE INDEX document_processing_job_scope_idx
  ON document_processing_job (tenant_id, company_id, created_at);

CREATE INDEX document_processing_job_documento_idx
  ON document_processing_job (source_document_id);

CREATE TRIGGER document_processing_job_updated_at
  BEFORE UPDATE ON document_processing_job
  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();

COMMENT ON TABLE document_processing_job IS
  'Cola asíncrona de causación sobre la misma PostgreSQL (sección 5). Una fila por (source_document_id, tipo); los reintentos reutilizan la fila. El worker la opera en contexto de administración (ve todas las firmas); encolar lo hace la sesión normal del tenant, en la misma transacción que crea el source_document.';
COMMENT ON CONSTRAINT document_processing_job_doc_tipo_uq ON document_processing_job IS
  'Idempotencia de la cola impuesta por la BD (D-003): reencolar el mismo documento no crea un segundo trabajo.';

-- -----------------------------------------------------------------------------
-- RLS estándar de empresa (D-016): quien ingesta y quien consulta estado ven
-- solo los trabajos de su propia empresa. El worker, en contexto de
-- administración, no pasa por aquí (ver nota de cabecera).
-- -----------------------------------------------------------------------------
SELECT app.instalar_rls_tenant_company('document_processing_job');

-- -----------------------------------------------------------------------------
-- Permiso: encolar un trabajo de causación es parte de cargar el documento.
-- No es una tabla nueva de negocio con su propio permiso: reutiliza
-- 'documento.cargar', ya definido en 014/016. El UPDATE del worker corre bajo
-- `withAdminContext` (sin sesión: `app.session_id() IS NULL`), así que
-- `app.exigir_permiso` se auto-exime ahí igual que ya se exime hoy para
-- `journal_entry` y para el resto de tablas con `instalar_permiso_escritura`
-- (ver 016_permisos_y_auditoria_sensible.sql, `app.exigir_permiso`).
-- -----------------------------------------------------------------------------
SELECT app.instalar_permiso_escritura('document_processing_job', 'documento.cargar');

-- =============================================================================
-- API mínima de la cola, para que A6 no reimplemente SKIP LOCKED en cada
-- llamador y para que la atomicidad de reclamar-y-marcar sea una sola
-- sentencia SQL en vez de dos viajes desde TypeScript.
-- =============================================================================

-- Encola (o recupera, si ya existía) el trabajo de causación de un documento.
-- SECURITY INVOKER a propósito: corre con los privilegios y el RLS de quien
-- llama, para que solo pueda encolar documentos de su propia empresa —
-- exactamente lo que ya garantiza la FK compuesta más RLS, sin necesitar
-- privilegios elevados.
CREATE OR REPLACE FUNCTION app.encolar_causacion(
  p_source_document_id uuid,
  p_max_intentos        integer DEFAULT 5
) RETURNS document_processing_job
  LANGUAGE plpgsql AS $$
DECLARE
  v_row document_processing_job;
BEGIN
  INSERT INTO document_processing_job (tenant_id, company_id, source_document_id, max_intentos)
  SELECT sd.tenant_id, sd.company_id, sd.id, GREATEST(p_max_intentos, 1)
    FROM source_document sd
   WHERE sd.id = p_source_document_id
  ON CONFLICT (source_document_id, tipo) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Ya existía (reintento manual o carrera con otra sesión): se devuelve tal
  -- cual está, sin tocar su estado ni sus intentos.
  SELECT * INTO v_row FROM document_processing_job
   WHERE source_document_id = p_source_document_id AND tipo = 'causacion';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'DOCUMENTO_INEXISTENTE: no se encontró el source_document % en el contexto actual (¿RLS lo esconde?)',
      p_source_document_id;
  END IF;

  RETURN v_row;
END $$;

COMMENT ON FUNCTION app.encolar_causacion IS
  'Punto de entrada idempotente a la cola. Un documento sin acceso en el contexto actual (RLS) simplemente no se encuentra: no distingue "no existe" de "no es tuyo", igual que cualquier SELECT bajo RLS.';

-- Reclama el siguiente trabajo disponible, o ninguno. Es la única función de
-- la cola que corre en contexto de administración (ve todas las firmas): se
-- revoca su EXECUTE de app_user más abajo, en línea con D-037 (una función
-- SECURITY DEFINER / de plataforma no debe quedar al alcance de la sesión de
-- negocio). No es SECURITY DEFINER: el propio rol de administración ya
-- ignora RLS, así que no hace falta elevar privilegios dentro de la función.
CREATE OR REPLACE FUNCTION app.reclamar_siguiente_job(
  p_tomado_por text
) RETURNS document_processing_job
  LANGUAGE plpgsql AS $$
DECLARE
  v_row document_processing_job;
BEGIN
  UPDATE document_processing_job
     SET estado    = 'en_proceso',
         tomado_por = p_tomado_por,
         tomado_en  = now(),
         intentos   = intentos + 1
   WHERE id = (
     SELECT id FROM document_processing_job
      WHERE estado = 'pendiente' AND disponible_en <= now()
      ORDER BY disponible_en
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;

  RETURN v_row;  -- NULL (fila vacía con id NULL) si no había nada disponible.
END $$;

COMMENT ON FUNCTION app.reclamar_siguiente_job IS
  'SKIP LOCKED en una sola sentencia UPDATE: atómico frente a otros workers concurrentes por construcción, no por convención de la aplicación.';

-- Marca un trabajo como completado con éxito.
CREATE OR REPLACE FUNCTION app.completar_job(
  p_job_id    uuid,
  p_resultado jsonb DEFAULT NULL
) RETURNS void
  LANGUAGE sql AS $$
  UPDATE document_processing_job
     SET estado        = 'completado',
         completado_en = now(),
         resultado     = p_resultado,
         ultimo_error  = NULL
   WHERE id = p_job_id;
$$;

-- Registra un fallo: reintenta con backoff si quedan intentos, o agota la
-- cola (dead-letter) si no. `p_backoff_segundos` lo calcula TypeScript
-- (`src/services/cola.ts`), no esta función: la política de backoff no es un
-- valor tributario, pero tampoco es de la BD decidirla.
CREATE OR REPLACE FUNCTION app.fallar_job(
  p_job_id           uuid,
  p_error            text,
  p_backoff_segundos integer
) RETURNS document_processing_job
  LANGUAGE plpgsql AS $$
DECLARE
  v_row document_processing_job;
BEGIN
  UPDATE document_processing_job
     SET estado        = CASE WHEN intentos >= max_intentos THEN 'agotado' ELSE 'pendiente' END,
         disponible_en = now() + make_interval(secs => GREATEST(p_backoff_segundos, 0)),
         ultimo_error  = p_error
   WHERE id = p_job_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_INEXISTENTE: no se encontró el trabajo %', p_job_id;
  END IF;

  RETURN v_row;
END $$;

-- Reencola manualmente un trabajo agotado o completado (p. ej. tras corregir
-- la clasificación a mano). Exige el mismo permiso que reprocesar un
-- documento: no es un atajo para saltarse límites de intentos sin criterio
-- humano de por medio.
CREATE OR REPLACE FUNCTION app.reencolar_job(
  p_source_document_id uuid
) RETURNS document_processing_job
  LANGUAGE plpgsql AS $$
DECLARE
  v_row document_processing_job;
BEGIN
  PERFORM app.exigir_permiso('documento.reprocesar');

  UPDATE document_processing_job
     SET estado        = 'pendiente',
         intentos      = 0,
         disponible_en = now(),
         ultimo_error  = NULL,
         resultado     = NULL
   WHERE source_document_id = p_source_document_id AND tipo = 'causacion'
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'JOB_INEXISTENTE: el documento % no tiene un trabajo de causación que reencolar',
      p_source_document_id;
  END IF;

  RETURN v_row;
END $$;

-- `reclamar_siguiente_job`, `completar_job` y `fallar_job` son del worker de
-- plataforma (`withAdminContext`), nunca de una sesión de negocio: sin sesión
-- (`app.session_id() IS NULL`) `app.exigir_permiso` ya se autoexime, pero
-- estas tres además NO deben quedar invocables desde `app_user` ni con
-- sesión, porque le darían a cualquier usuario autenticado la capacidad de
-- fabricar "completado" sobre el trabajo de otra firma sin pasar por RLS (las
-- funciones PL/pgSQL sin SECURITY DEFINER corren con los privilegios de quien
-- las llama, pero esta consulta tampoco filtra por tenant/company a
-- propósito, porque el worker SÍ necesita verlas todas).
REVOKE ALL ON FUNCTION app.reclamar_siguiente_job(text)        FROM PUBLIC, app_user, app_auth;
REVOKE ALL ON FUNCTION app.completar_job(uuid, jsonb)          FROM PUBLIC, app_user, app_auth;
REVOKE ALL ON FUNCTION app.fallar_job(uuid, text, integer)     FROM PUBLIC, app_user, app_auth;

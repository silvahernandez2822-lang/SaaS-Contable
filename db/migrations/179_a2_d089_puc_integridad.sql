-- =============================================================================
-- 179_a2_d089_puc_integridad.sql — D-089, Módulo PUC / Plan de cuentas:
-- SOLO la capa de modelo de datos. Tres guardias, todos en el MOTOR.
--
-- Nada aquí crea tablas nuevas. El plan de cuentas ya está modelado desde la
-- Ola 0 (`account`, 003) y su resolución por precedencia empresa>firma>global
-- desde la Ola 4 (`v_account_efectivo`, 170). Lo que faltaba era INTEGRIDAD:
--
--   1. El ledger rechazaba imputar sobre una cuenta agrupadora (LG004) SOLO en
--      el trigger diferido de publicación. Un asiento borrador —el que la
--      bandeja de causación enseña al contador para que lo apruebe— podía
--      nacer imputando contra la clase 5 y solo reventaba al publicar, cuando
--      ya había pasado por revisión humana. Ahora muere en el INSERT.
--   2. `account` se podía degradar bajo los pies del histórico: cambiarle la
--      naturaleza a una cuenta con movimientos invierte el signo de todos los
--      reportes hacia atrás sin tocar una sola partida; volverla agrupadora
--      deja el histórico imputado sobre algo que ya no admite imputación.
--   3. La interfaz necesita saber, con EL MISMO criterio que el motor impone,
--      si una cuenta está en uso. Si no, promete botones que el backend niega
--      (mismo criterio que `app.tercero_tiene_movimientos`, D-084/174).
--
-- REGLA DE ORO 2: aquí no hay ni una tarifa, ni una base, ni una UVT, ni un
-- tope, ni un calendario. Es integridad referencial de un maestro de datos.
--
-- REGLA DE ORO 1: no se relaja nada del ledger. El guardia del punto 1 se suma
-- al de publicación, no lo sustituye — el diferido sigue ahí porque una cuenta
-- puede volverse agrupadora DESPUÉS de que la partida entrara (y de hecho el
-- punto 2 hace que eso solo pueda pasar por caminos que no tocan el histórico).
-- =============================================================================


-- =============================================================================
-- A. LA CUENTA SE VALIDA AL INSERTAR LA PARTIDA, NO AL PUBLICAR EL ASIENTO
-- =============================================================================
--
-- ORDEN DE DISPARO. PostgreSQL ejecuta los triggers BEFORE de fila en orden
-- alfabético. Sobre `journal_line` hay ya `journal_line_alcance` (018, la
-- cuenta pertenece a esta firma y a esta empresa) y `journal_line_inmutable`
-- (010, el asiento no está publicado). Este se llama `journal_line_valida_cuenta`
-- para quedar DESPUÉS de los dos: primero se comprueba que la cuenta sea
-- alcanzable, luego que el asiento admita partidas, y solo entonces que la
-- cuenta concreta sea imputable. Un intento sobre un asiento publicado debe
-- seguir diciendo LG001, no LG004.
--
-- SQLSTATE:
--   · LG004 (CUENTA_NO_IMPUTABLE) se REUTILIZA a propósito para
--     `permite_movimiento = false`. Es el mismo hecho contable que ya
--     diagnosticaba el trigger de publicación; darle un código nuevo obligaría
--     a todo el código existente a mirar dos, y la prueba de la Ola 0 que
--     exige LG004 sigue siendo válida palabra por palabra: lo único que cambia
--     es que el rechazo llega antes.
--   · LG009 (CUENTA_INACTIVA) es nuevo porque es un hecho DISTINTO: la cuenta
--     sí es imputable, pero está retirada del plan. El mensaje al contador y
--     el remedio no son los mismos (allí "escoja una hoja", aquí "reactívela o
--     escoja la que la sustituyó"), y colapsarlos en un código haría imposible
--     que la interfaz dijera cuál de las dos cosas pasó.
--
-- LA PUERTA DE LA REVERSA. Una reversa reproduce las partidas del asiento que
-- corrige, y ese asiento es del pasado: sus cuentas pueden haberse retirado o
-- reclasificado desde entonces. Bloquear la reversa dejaría un error
-- INCORREGIBLE en el ledger, que es exactamente lo contrario de la Regla de
-- Oro 1 (todo se corrige por reversa, nada se edita). Por eso una partida de
-- un asiento `tipo = 'reversa'` se admite si esa MISMA cuenta ya aparece en el
-- asiento que reversa. No es un portillo genérico: la cuenta tiene que estar
-- ya en el histórico que se está corrigiendo, así que no sirve para meter una
-- cuenta agrupadora nueva por la puerta de atrás.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_journal_line_valida_cuenta() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_codigo    text;
  v_nombre    text;
  v_permite   boolean;
  v_activo    boolean;
  v_nivel     smallint;
  v_tipo      text;
  v_reversa   uuid;
BEGIN
  -- Solo cuando la cuenta entra o cambia. Un UPDATE que toca el monto o la
  -- descripción de un borrador no vuelve a pagar esta consulta.
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NEW;
  END IF;

  SELECT a.codigo, a.nombre, a.permite_movimiento, a.activo, a.nivel
    INTO v_codigo, v_nombre, v_permite, v_activo, v_nivel
    FROM public.account a
   WHERE a.id = NEW.account_id;

  -- Cuenta inexistente: es cosa de la clave foránea, no de este guardia.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_permite AND v_activo THEN
    RETURN NEW;
  END IF;

  SELECT je.tipo, je.reverses_entry_id
    INTO v_tipo, v_reversa
    FROM public.journal_entry je
   WHERE je.id = NEW.journal_entry_id;

  IF v_tipo = 'reversa' AND v_reversa IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.journal_line jl
                  WHERE jl.journal_entry_id = v_reversa
                    AND jl.account_id = NEW.account_id) THEN
    RETURN NEW;
  END IF;

  IF NOT v_permite THEN
    RAISE EXCEPTION
      'CUENTA_NO_IMPUTABLE: la cuenta % (%) es de nivel % y no permite movimiento; solo se imputa sobre cuentas hoja del PUC. Escoja la subcuenta o el auxiliar que cuelga de ella.',
      v_codigo, v_nombre, v_nivel
      USING ERRCODE = 'LG004';
  END IF;

  RAISE EXCEPTION
    'CUENTA_INACTIVA: la cuenta % (%) está inactiva en el plan de cuentas y no admite partidas nuevas. Reactívela en Parámetros › Plan de cuentas o impute sobre la cuenta que la sustituyó.',
    v_codigo, v_nombre
    USING ERRCODE = 'LG009';
END $$;

COMMENT ON FUNCTION app.trg_journal_line_valida_cuenta() IS
  'D-089: una partida no entra al ledger —ni siquiera en borrador— contra una cuenta agrupadora (LG004) o inactiva (LG009). Excepción acotada: la reversa puede reproducir una cuenta del asiento que corrige, para que un error del pasado no quede incorregible.';

CREATE TRIGGER journal_line_valida_cuenta
  BEFORE INSERT OR UPDATE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION app.trg_journal_line_valida_cuenta();


-- =============================================================================
-- B. UNA CUENTA EN USO NO SE DEGRADA NI SE BORRA
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ¿Esta cuenta tiene movimientos en el ledger?
--
-- SECURITY DEFINER y STABLE por la misma razón que `tercero_tiene_movimientos`
-- (174): el guardia tiene que ver el histórico completo sin depender de qué
-- políticas RLS estén activas en la sesión que pregunta, y la interfaz tiene
-- que poder deshabilitar el control con EXACTAMENTE el mismo criterio que el
-- motor aplica. Recibe un id de cuenta que quien pregunta ya tuvo que resolver
-- pasando por la RLS de `account`, y devuelve un booleano: no filtra ni un
-- dato de otra firma.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.cuenta_tiene_movimientos(p_account_id uuid)
RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.journal_line WHERE account_id = p_account_id)
  $$;

COMMENT ON FUNCTION app.cuenta_tiene_movimientos(uuid) IS
  'D-089: true si la cuenta tiene al menos una partida en el ledger (publicada o en borrador). Una cuenta asi se INACTIVA, nunca se borra, y no admite cambio de naturaleza ni de codigo.';

GRANT EXECUTE ON FUNCTION app.cuenta_tiene_movimientos(uuid) TO app_user;


-- -----------------------------------------------------------------------------
-- ¿Cuántos conceptos de causación ACTIVOS apuntan a esta cuenta?
--
-- Cuenta las tres FK de `concepto_causacion` (gasto, IVA descontable,
-- contrapartida) y la de `memoria_clasificacion`. Solo las ACTIVAS: un
-- concepto ya retirado no debe impedir retirar la cuenta que usaba.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.cuenta_conceptos_activos(p_account_id uuid)
RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT (SELECT count(*) FROM public.concepto_causacion c
             WHERE c.activo
               AND p_account_id IN (c.cuenta_gasto_id, c.cuenta_iva_descontable_id,
                                    c.cuenta_contrapartida_id))
         + (SELECT count(*) FROM public.memoria_clasificacion m
             WHERE m.activo AND m.account_id = p_account_id)
  $$;

COMMENT ON FUNCTION app.cuenta_conceptos_activos(uuid) IS
  'D-089: cuantos conceptos de causacion activos (por cualquiera de sus tres cuentas) y cuantas memorias de clasificacion activas apuntan a esta cuenta. Si es > 0, retirar la cuenta romperia la causacion automatica en silencio.';

GRANT EXECUTE ON FUNCTION app.cuenta_conceptos_activos(uuid) TO app_user;


-- -----------------------------------------------------------------------------
-- El detalle del uso de una cuenta, para la interfaz.
--
-- NO es una vista sobre todas las cuentas: contar partidas de ledger por cada
-- fila de un PUC de miles de cuentas es un recorrido completo de la tabla más
-- grande del sistema cada vez que alguien abre la pantalla. Es una función por
-- cuenta, que es como se consulta de verdad (al abrir el detalle de UNA
-- cuenta, o antes de guardar UN cambio).
--
-- Devuelve CONTEOS, no nombres. El listado de "qué conceptos concretos usan
-- esta cuenta" lo hace la capa de servicio con una consulta normal bajo RLS
-- (tres LEFT JOIN sobre `concepto_causacion`): así el nombre de un concepto de
-- otra firma no puede salir nunca por una función SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.cuenta_uso(p_account_id uuid)
RETURNS TABLE (
  partidas_ledger    bigint,
  conceptos_activos  bigint,
  cuentas_hijas      bigint,
  niif_mappings      bigint,
  exogena_mappings   bigint
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app, public
  AS $$
    SELECT (SELECT count(*) FROM public.journal_line            WHERE account_id = p_account_id),
           app.cuenta_conceptos_activos(p_account_id),
           (SELECT count(*) FROM public.account                 WHERE parent_id  = p_account_id),
           (SELECT count(*) FROM public.niif_mapping            WHERE account_id = p_account_id),
           (SELECT count(*) FROM public.exogena_account_mapping WHERE account_id = p_account_id)
  $$;

COMMENT ON FUNCTION app.cuenta_uso(uuid) IS
  'D-089: conteos de uso de una cuenta, con el MISMO criterio que aplican los guardias de account. La interfaz los usa para no ofrecer acciones que el motor va a negar. Devuelve conteos, no nombres: el listado detallado lo hace el servicio bajo RLS.';

GRANT EXECUTE ON FUNCTION app.cuenta_uso(uuid) TO app_user;


-- -----------------------------------------------------------------------------
-- El guardia. Cinco reglas, y solo cinco.
--
-- QUÉ SE BLOQUEA Y POR QUÉ:
--
--   PU001 — DELETE de una cuenta en uso. Las FK ya lo impedían con un 23503
--     ilegible ("viola la restricción journal_line_account_id_fkey"). Aquí se
--     dice qué pasa y qué hacer. Es el mismo criterio de TP001 en terceros: lo
--     que el ledger, la exógena o un certificado ya citan tiene que poder
--     resolverse por su id para siempre.
--
--   PU002 — cambiar `naturaleza` con movimientos. Es el más grave de los
--     cinco y el más invisible: no toca ni una partida, pero invierte el signo
--     con que TODOS los reportes históricos leen esa cuenta. Un balance de
--     2025 emitido y firmado dejaría de cuadrar sin que nada en el ledger
--     hubiera cambiado. Se bloquea SIEMPRE que haya movimientos, sin excepción
--     y sin "forzar".
--
--   PU003 — quitar `permite_movimiento` con movimientos. Convertir en
--     agrupadora una cuenta que ya tiene partidas deja el histórico imputado
--     sobre algo que, por definición del PUC, no admite imputación: los
--     reportes por niveles la sumarían dos veces (como hoja y como grupo).
--     Para dejar de usarla el camino es `activo = false`, que sí se permite.
--
--   PU004 — cambiar `codigo` con movimientos. El código ES la identidad
--     contable de la cuenta en todo reporte, en la exógena y en los papeles de
--     trabajo ya emitidos; moverlo reclasifica el pasado en silencio.
--
--   PU005 — retirar (activo=false) o desimputar una cuenta a la que apunta un
--     concepto de causación activo. Sin esto, la causación automática se rompe
--     en la siguiente factura con un error que no menciona esta pantalla.
--     Reasigne el concepto primero.
--
-- QUÉ NO SE BLOQUEA, a propósito:
--   · `activo = false` con movimientos (y sin conceptos activos). Es EL camino
--     previsto para retirar una cuenta, igual que en terceros. Bloquearlo
--     dejaría el plan de cuentas sin manera de limpiarse.
--   · Tener `niif_mapping` o `exogena_account_mapping`. Son mapeos POR
--     VIGENCIA: retirar la cuenta no los invalida, y el estado financiero de
--     un período pasado se sigue armando con el mapeo de entonces. Se cuentan
--     en `app.cuenta_uso` para que la interfaz avise, pero no bloquean.
--   · Cambiar nombre, requiere_tercero, requiere_centro_costo,
--     requiere_base_gravable o parent_id. Ninguno reinterpreta el histórico.
--
-- ORDEN DE DISPARO: `account_restrict_uso` queda alfabéticamente después de
-- `account_alcance` (018) y de `account_permiso` (016) y antes de
-- `account_updated_at` (003). Primero se comprueba que la sesión pueda editar
-- el PUC (SE002) y solo entonces qué se está haciendo con esta cuenta.
--
-- Cada comparación usa IS DISTINCT FROM: reguardar una cuenta con los mismos
-- valores (lo que hace `guardarCuenta` en cada importación y cada vez que la
-- pantalla graba sin cambios) no dispara nada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trg_account_restrict_uso() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
DECLARE
  v_movimientos boolean;
  v_conceptos   bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app.cuenta_tiene_movimientos(OLD.id)
       OR app.cuenta_conceptos_activos(OLD.id) > 0
       OR EXISTS (SELECT 1 FROM public.account            WHERE parent_id  = OLD.id)
       OR EXISTS (SELECT 1 FROM public.niif_mapping       WHERE account_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.exogena_account_mapping WHERE account_id = OLD.id) THEN
      RAISE EXCEPTION
        'CUENTA_EN_USO: la cuenta % (%) está en uso (partidas del ledger, conceptos de causación, cuentas hijas o mapeos NIIF/exógena) y no se puede borrar. Inactívela en su lugar (activo = false): sigue en la base para que los reportes y la trazabilidad del pasado la resuelvan.',
        OLD.codigo, OLD.nombre
        USING ERRCODE = 'PU001';
    END IF;
    RETURN OLD;
  END IF;

  -- A partir de aquí, TG_OP = 'UPDATE'. Si nada de lo vigilado cambió, se sale
  -- sin consultar el ledger.
  IF NEW.naturaleza         IS NOT DISTINCT FROM OLD.naturaleza
     AND NEW.codigo         IS NOT DISTINCT FROM OLD.codigo
     AND NEW.permite_movimiento IS NOT DISTINCT FROM OLD.permite_movimiento
     AND NEW.activo         IS NOT DISTINCT FROM OLD.activo THEN
    RETURN NEW;
  END IF;

  v_movimientos := app.cuenta_tiene_movimientos(OLD.id);

  IF v_movimientos AND NEW.naturaleza IS DISTINCT FROM OLD.naturaleza THEN
    RAISE EXCEPTION
      'CUENTA_NATURALEZA_INMUTABLE: la cuenta % (%) ya tiene partidas en el ledger; cambiarle la naturaleza de "%" a "%" invertiría el signo con que se leen TODOS los reportes del pasado sin tocar una sola partida. Cree una cuenta nueva con la naturaleza correcta y traslade el saldo con un asiento.',
      OLD.codigo, OLD.nombre, OLD.naturaleza, NEW.naturaleza
      USING ERRCODE = 'PU002';
  END IF;

  IF v_movimientos AND OLD.permite_movimiento AND NOT NEW.permite_movimiento THEN
    RAISE EXCEPTION
      'CUENTA_CON_MOVIMIENTOS: la cuenta % (%) ya tiene partidas y no se puede convertir en cuenta de agrupación: el histórico quedaría imputado sobre una cuenta que no admite imputación. Si no quiere seguir usándola, inactívela (activo = false).',
      OLD.codigo, OLD.nombre
      USING ERRCODE = 'PU003';
  END IF;

  IF v_movimientos AND NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION
      'CUENTA_CODIGO_INMUTABLE: la cuenta % ya tiene partidas en el ledger; renumerarla a % reclasificaría en silencio los reportes, la exógena y los papeles de trabajo ya emitidos. Cree la cuenta nueva y traslade el saldo con un asiento.',
      OLD.codigo, NEW.codigo
      USING ERRCODE = 'PU004';
  END IF;

  IF (OLD.activo AND NOT NEW.activo)
     OR (OLD.permite_movimiento AND NOT NEW.permite_movimiento)
     OR NEW.naturaleza IS DISTINCT FROM OLD.naturaleza THEN
    v_conceptos := app.cuenta_conceptos_activos(OLD.id);
    IF v_conceptos > 0 THEN
      RAISE EXCEPTION
        'CUENTA_REFERENCIADA_POR_CONCEPTO: % concepto(s) de causación o memoria(s) de clasificación activos apuntan a la cuenta % (%). Retirarla o cambiarla rompería la causación automática en la siguiente factura, con un error que no menciona esta pantalla. Reasigne primero esos conceptos a otra cuenta.',
        v_conceptos, OLD.codigo, OLD.nombre
        USING ERRCODE = 'PU005';
    END IF;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.trg_account_restrict_uso() IS
  'D-089: una cuenta en uso no se borra (PU001) ni se degrada. Con movimientos no cambia de naturaleza (PU002), no se vuelve agrupadora (PU003) y no se renumera (PU004). Con conceptos de causacion activos no se retira ni se desimputa (PU005). Inactivarla SI se permite: es el camino previsto.';

CREATE TRIGGER account_restrict_uso
  BEFORE UPDATE OR DELETE ON account
  FOR EACH ROW EXECUTE FUNCTION app.trg_account_restrict_uso();

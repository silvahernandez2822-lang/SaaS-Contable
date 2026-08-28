-- =============================================================================
-- 120_a10_estados_financieros.sql — A10, Ola 3: resolución NIIF de las cuentas
--
-- Los estados financieros NO salen de la cuenta PUC directamente (sección 7.8:
-- bajo NIIF el Decreto 2650 dejó de ser catálogo único obligatorio, pero sigue
-- siendo el catálogo operativo del mercado). Salen del MAPEO: `niif_mapping`,
-- que A2 modeló y A1 pobló, y que es paramétrico y versionado por vigencia —
-- los estados de un período pasado se arman con la clasificación de entonces.
--
-- Esta migración no crea ninguna tabla ni inserta ningún dato. Solo aporta las
-- dos funciones de RESOLUCIÓN que las ocho consultas de `src/reports/estados/`
-- necesitan y que repetir ocho veces en SQL de aplicación sería peor:
--
--   1. `app.niif_de_cuenta(account_id, fecha)` — qué clasificación NIIF le
--      corresponde a una cuenta en una fecha, heredando del ancestro del PUC
--      cuando la cuenta concreta (una subcuenta o un auxiliar de la empresa)
--      no tiene mapeo propio.
--   2. `app.ancestro_puc(account_id, nivel)` — el código y el NOMBRE del
--      ancestro de la cuenta en un nivel del PUC. Es lo que da los rótulos de
--      los estados (p. ej. "Gastos operacionales de administración") SIN que
--      ningún código PUC quede escrito en TypeScript: el rótulo es un dato del
--      catálogo, no una constante del programa.
--
-- Las dos son SECURITY INVOKER (el modo por defecto, declarado aquí de forma
-- explícita para que se lea sin dudar): leen `account` y `niif_mapping`, que
-- llevan RLS híbrida (012_rls.sql), y deben ver exactamente lo que ve quien
-- llama. Una `SECURITY DEFINER` aquí sería una puerta trasera al aislamiento
-- entre firmas (Regla de Oro 7) a cambio de nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app.niif_de_cuenta
--
-- Resolución en cascada, de lo más específico a lo más general:
--   1. Mapeo de la CUENTA MISMA (`account_id` exacto).
--   2. Mapeo del ancestro más largo cuyo código sea prefijo del de la cuenta.
--      Un auxiliar '51359501' hereda de la subcuenta '513595', que hereda de
--      la cuenta '5135', que hereda del grupo '51', que hereda de la clase '5'.
--      Así funciona el PUC y así debe funcionar el mapeo: A1 cargó el catálogo
--      operativo hasta el nivel de cuenta (4 dígitos), y las subcuentas y
--      auxiliares que cada empresa cree después no tienen por qué remapearse.
--   3. Dentro del mismo nivel, gana el mapeo de la empresa sobre el de la
--      firma, y el de la firma sobre el global. Una empresa puede clasificar
--      distinto una cuenta sin tocar el catálogo global.
--   4. A igualdad de todo lo anterior, la vigencia más reciente que cubra la
--      fecha (Regla de Oro 3: se resuelve por la fecha del hecho económico).
--
-- Devuelve CERO filas si no hay mapeo aplicable. Eso NO es un error que haya
-- que tapar con un valor por defecto: es una cuenta con saldo que nadie ha
-- clasificado, y los estados financieros la muestran en una sección aparte
-- («Partidas sin clasificación NIIF») para que el contador la resuelva. Una
-- cuenta silenciosamente omitida descuadraría el estado sin dejar rastro.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.niif_de_cuenta(p_account_id uuid, p_fecha date)
RETURNS TABLE (
  clasificacion_niif    text,
  seccion_niif          text,
  rubro_esf             text,
  rubro_eri             text,
  rubro_efe             text,
  actividad_efe         text,
  actividad_efe_origen  text,
  es_efectivo           boolean,
  origen_account_id     uuid,
  origen_codigo         text,
  resolucion            text,
  vigente_desde         date,
  vigente_hasta         date,
  norma_respaldo        text,
  requiere_verificacion_humana boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH cuenta AS (
    SELECT a.id, a.codigo FROM account a WHERE a.id = p_account_id
  ),
  candidato AS (
    SELECT m.account_id,
           m.tenant_id,
           m.company_id,
           m.clasificacion_niif,
           m.seccion_niif,
           m.rubro_esf,
           m.rubro_eri,
           m.rubro_efe,
           m.vigente_desde,
           m.vigente_hasta,
           m.norma_respaldo,
           m.requiere_verificacion_humana,
           am.codigo AS origen_codigo,
           length(am.codigo) AS especificidad
      FROM niif_mapping m
      JOIN account am ON am.id = m.account_id
      CROSS JOIN cuenta c
     WHERE left(c.codigo, length(am.codigo)) = am.codigo
       AND m.vigente_desde <= p_fecha
       AND (m.vigente_hasta IS NULL OR m.vigente_hasta >= p_fecha)
  )
  SELECT
    x.clasificacion_niif,
    x.seccion_niif,
    x.rubro_esf,
    x.rubro_eri,
    x.rubro_efe,
    -- Actividad del Estado de Flujos de Efectivo. Si el contador la declaró en
    -- `niif_mapping.rubro_efe`, manda esa. Si no, se PRESUME por la
    -- clasificación NIIF y la fila queda marcada como presunción: el papel de
    -- trabajo del EFE la lista para que un humano la confirme. Presumir y
    -- avisar es honesto; presumir y callar sería inventar una revelación.
    COALESCE(
      NULLIF(x.rubro_efe, 'efectivo_y_equivalentes'),
      CASE x.clasificacion_niif
        WHEN 'activo_no_corriente' THEN 'inversion'
        WHEN 'pasivo_no_corriente' THEN 'financiacion'
        WHEN 'patrimonio'          THEN 'financiacion'
        ELSE 'operacion'
      END
    ) AS actividad_efe,
    CASE
      WHEN x.rubro_efe IS NOT NULL AND x.rubro_efe <> 'efectivo_y_equivalentes'
        THEN 'declarada'
      ELSE 'presumida'
    END AS actividad_efe_origen,
    (x.rubro_efe = 'efectivo_y_equivalentes') AS es_efectivo,
    x.account_id,
    x.origen_codigo,
    CASE WHEN x.account_id = p_account_id THEN 'directa' ELSE 'heredada' END AS resolucion,
    x.vigente_desde,
    x.vigente_hasta,
    x.norma_respaldo,
    x.requiere_verificacion_humana
  FROM candidato x
  ORDER BY (x.account_id = p_account_id) DESC,
           x.especificidad DESC,
           (x.company_id IS NOT NULL) DESC,
           (x.tenant_id IS NOT NULL) DESC,
           x.vigente_desde DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION app.niif_de_cuenta(uuid, date) IS
  'A10 (Ola 3): clasificación NIIF vigente de una cuenta PUC en una fecha, heredada del ancestro del catálogo cuando la cuenta no tiene mapeo propio. SECURITY INVOKER: hereda la RLS de account y niif_mapping. Cero filas = cuenta sin clasificar, que los estados muestran aparte en vez de omitir.';

-- -----------------------------------------------------------------------------
-- app.ancestro_puc
--
-- El ancestro de la cuenta en un nivel del PUC (1 clase, 2 grupo, 3 cuenta,
-- 4 subcuenta), con su NOMBRE tomado del catálogo. Es lo que rotula los
-- renglones de los estados financieros cuando `niif_mapping.rubro_*` está
-- vacío: mejor el nombre real que puso A1 en `account` ("Gastos operacionales
-- de administración") que un rótulo inventado en TypeScript.
--
-- No se navega por `parent_id` a propósito: en el PUC el código ES la
-- jerarquía (sección 7.8), y `parent_id` puede venir sin poblar en las cuentas
-- que crea una empresa (el fixture de pruebas de A2 ya lo deja así en tres de
-- sus cinco cuentas). Por prefijo del código nunca falla.
--
-- Si el ancestro no existe en el catálogo (A1 cargó un PUC operativo, no las
-- 2.470 cuentas del decreto), devuelve el código recortado y nombre NULL: el
-- estado muestra el código y el contador ve qué cuenta le falta al catálogo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.ancestro_puc(p_account_id uuid, p_nivel smallint)
RETURNS TABLE (codigo text, nombre text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH objetivo AS (
    SELECT a.codigo,
           a.tenant_id,
           a.company_id,
           left(a.codigo, LEAST(
             CASE p_nivel
               WHEN 1 THEN 1
               WHEN 2 THEN 2
               WHEN 3 THEN 4
               WHEN 4 THEN 6
               ELSE length(a.codigo)
             END,
             length(a.codigo))) AS codigo_ancestro
      FROM account a
     WHERE a.id = p_account_id
  )
  SELECT o.codigo_ancestro, anc.nombre
    FROM objetivo o
    LEFT JOIN LATERAL (
      SELECT am.nombre
        FROM account am
       WHERE am.codigo = o.codigo_ancestro
       ORDER BY (am.company_id IS NOT DISTINCT FROM o.company_id) DESC,
                (am.tenant_id  IS NOT DISTINCT FROM o.tenant_id)  DESC,
                (am.tenant_id IS NULL) DESC
       LIMIT 1
    ) anc ON true;
$$;

COMMENT ON FUNCTION app.ancestro_puc(uuid, smallint) IS
  'A10 (Ola 3): código y nombre del ancestro de una cuenta en un nivel del PUC, resuelto por prefijo del código (la jerarquía del Decreto 2650 ES el código). Da los rótulos de los estados financieros sin quemar ningún código PUC en TypeScript.';

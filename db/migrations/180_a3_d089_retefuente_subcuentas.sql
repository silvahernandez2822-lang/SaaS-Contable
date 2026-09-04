-- =============================================================================
-- 180_a3_d089_retefuente_subcuentas.sql — D-089, Módulo PUC / motor (A3).
--
-- REPARACIÓN DE DATOS YA ESCRITOS. Nada de esquema.
--
-- EL PROBLEMA. Hasta D-089 las dieciocho reglas de retefuente que cargan los
-- seeds (`tanda1/050`, doce, y `tanda2/070`, seis) apuntaban su `account_id` a
-- la cuenta `2365` «RETENCIÓN EN LA FUENTE». Con el PUC completo del Decreto
-- 2650 (seed `tanda2/011`), `2365` es una cuenta de nivel 3 CON subcuentas
-- (`236505` salarios, `236515` honorarios, `236520` comisiones, `236525`
-- servicios, `236530` arrendamientos, `236535` rendimientos financieros,
-- `236540` compras…). Imputar la retención sobre la agrupadora es plan de
-- cuentas mal armado: el saldo queda sin decir por qué concepto se retuvo, que
-- es justo lo que el certificado del art. 381 ET y el Formato 1001 de la
-- exógena exigen desagregado.
--
-- Los seeds ya quedaron corregidos y una base NUEVA nace bien: `2365` se crea
-- como agrupadora y cada regla apunta a su subcuenta desde su primera y única
-- vigencia. Esta migración existe SOLO para la base que YA está sembrada (la
-- Neon), donde las filas de `tax_rule` existen desde antes y el seed —que es
-- `INSERT ... WHERE NOT EXISTS`, jamás `UPDATE`— no las va a tocar nunca.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ ESTO CIERRA UNA VIGENCIA Y ABRE OTRA, Y NO HACE UN `UPDATE`
-- -----------------------------------------------------------------------------
-- La primera versión de esta migración hacía `UPDATE tax_rule SET account_id`,
-- razonando que la cuenta de destino no es un valor tributario (no es tarifa,
-- ni base, ni UVT, ni calendario) y que por tanto la Regla de Oro 3 no la
-- alcanzaba. **El motor de la base dice que no**: `tax_rule` lleva desde la
-- migración 001 el trigger `tax_rule_vigencia_append_only`, que rechaza con
-- `PR001` CUALQUIER `UPDATE` que toque algo distinto de `vigente_hasta`, y
-- `PR003` cualquier `DELETE` de una vigencia que ya surtió efecto. No hay
-- excepción para «esta columna sí» ni para «esto lo hace una migración». Y esa
-- es la conducta correcta: el día que una migración pueda desactivar el guardia
-- append-only «solo esta vez», el guardia deja de valer para todo lo demás.
--
-- Así que la corrección se hace por el camino que el sistema sí reconoce, que
-- es el mismo que usa la pantalla de parámetros: se CIERRA la vigencia vieja el
-- día anterior a hoy y se ABRE una vigencia nueva, gemela en todo —tarifa, base
-- mínima, comparador, discriminadores, norma— salvo en la cuenta.
--
-- CONSECUENCIA, DECLARADA A PROPÓSITO: en una base ya sembrada, una factura con
-- fecha de hecho económico ANTERIOR al día de esta migración se sigue
-- resolviendo contra la vigencia vieja y sigue acreditando `2365`. Eso no es un
-- defecto, es la sección 9.2 funcionando: se resuelve por la fecha del hecho
-- económico, y el pasado no se reinterpreta. Por eso el bloque B no desimputa
-- `2365` mientras quede una sola vigencia —viva o cerrada— apuntándole: si lo
-- hiciera, el reproceso de una factura vieja moriría con `LG004` por un cambio
-- que se hizo después de que ocurriera el hecho.
--
-- ORDEN DE EJECUCIÓN. Las migraciones corren ANTES que los seeds. En una base
-- limpia, cuando esto se ejecuta no existe todavía ni `2365`, ni `236515`, ni
-- una sola fila de `tax_rule`: los dos bloques son un no-op silencioso y el
-- resultado correcto lo dejan los seeds, sin vigencia partida y sin rastro de
-- la agrupadora. Todo aquí es idempotente y condicional: correrlo dos veces, o
-- sobre una base vacía, o sobre una base ya corregida a mano, da lo mismo.
-- =============================================================================


-- =============================================================================
-- A. CADA VIGENCIA GLOBAL DE RETEFUENTE QUE APUNTA A `2365` SE CIERRA, Y SE
--    ABRE SU GEMELA CONTRA LA SUBCUENTA QUE LE CORRESPONDE POR CONCEPTO
-- =============================================================================
--
-- Solo reglas de alcance GLOBAL (`tenant_id IS NULL AND company_id IS NULL`),
-- que son las que cargó A1. Una regla propia de una firma o de una empresa es
-- una decisión de ese cliente y esta migración no la reinterpreta: si apunta a
-- una agrupadora, el motor se lo dirá con un motivo entendible
-- (`regla_con_cuenta_no_imputable`) y el contador la corregirá desde la pantalla
-- de parámetros. Adivinarle la subcuenta a un dato que no pusimos nosotros sería
-- inventar.
--
-- El mapeo va por el CÓDIGO DEL CONCEPTO, que es estable y es el mismo que
-- documentan los dos seeds. Un concepto que no esté en la lista no se toca.
DO $$
DECLARE
  v_pares text[][] := ARRAY[
    ['servicios_generales',                '236525'],  -- SERVICIOS
    ['compras_generales',                  '236540'],  -- COMPRAS
    ['honorarios_pj',                      '236515'],  -- HONORARIOS
    ['honorarios_pn',                      '236515'],  -- HONORARIOS
    ['arrendamiento_muebles',              '236530'],  -- ARRENDAMIENTOS
    ['arrendamiento_inmuebles',            '236530'],  -- ARRENDAMIENTOS
    ['transporte_carga',                   '236525'],  -- SERVICIOS
    ['transporte_pasajeros',               '236525'],  -- SERVICIOS
    ['servicios_temporales',               '236525'],  -- SERVICIOS
    ['vigilancia_aseo',                    '236525'],  -- SERVICIOS
    ['productos_agricolas',                '236540'],  -- COMPRAS
    ['combustibles',                       '236540'],  -- COMPRAS
    ['rendimientos_financieros_generales', '236535'],  -- RENDIMIENTOS FINANCIEROS
    ['rendimientos_titulos_renta_fija',    '236535'],  -- RENDIMIENTOS FINANCIEROS
    ['servicios_integrales_salud',         '236525'],  -- SERVICIOS
    ['hoteles_restaurantes',               '236525']   -- SERVICIOS
  ];
  i          int;
  v_concepto text;
  v_cuenta   text;
  v_destino  uuid;
  v_regla    record;
BEGIN
  FOR i IN 1 .. array_length(v_pares, 1) LOOP
    v_concepto := v_pares[i][1];
    v_cuenta   := v_pares[i][2];

    SELECT a.id INTO v_destino
      FROM public.account a
     WHERE a.tenant_id IS NULL AND a.company_id IS NULL
       AND a.codigo = v_cuenta
       AND a.permite_movimiento AND a.activo;

    -- La subcuenta todavía no existe (base limpia, seeds sin correr) o no es
    -- imputable: no se toca nada. Nunca se cambia una cuenta buena por una peor.
    CONTINUE WHEN v_destino IS NULL;

    FOR v_regla IN
      SELECT r.*
        FROM public.tax_rule r
        JOIN public.tax_concept c ON c.id = r.tax_concept_id
        JOIN public.account vieja ON vieja.id = r.account_id
       WHERE r.tenant_id IS NULL AND r.company_id IS NULL
         AND r.tipo = 'retefuente'
         AND c.tenant_id IS NULL AND c.company_id IS NULL
         AND c.tipo = 'retefuente' AND c.codigo = v_concepto
         -- Solo lo que sigue en la agrupadora. Una vigencia que ya esté en su
         -- subcuenta —o que un humano haya reapuntado a otra a propósito— se
         -- queda como está: esto repara, no impone.
         AND vieja.codigo = '2365'
         -- Solo vigencias ABIERTAS. Una ya cerrada es historia y no se toca.
         AND r.vigente_hasta IS NULL
         -- Y solo las que ya empezaron: cerrar una vigencia futura el día de
         -- ayer daría `vigente_hasta < vigente_desde` (PR001).
         AND r.vigente_desde < CURRENT_DATE
    LOOP
      -- 1. Se cierra la vigencia vieja. Es lo ÚNICO que el guardia append-only
      --    permite tocar de una fila existente.
      UPDATE public.tax_rule
         SET vigente_hasta = CURRENT_DATE - 1
       WHERE id = v_regla.id;

      -- 2. Y se abre la gemela contra la subcuenta. Se copian TODAS las
      --    columnas de valor: aquí no se escribe ni una tarifa, ni una base,
      --    ni un umbral. Lo único distinto es `account_id`.
      INSERT INTO public.tax_rule (
        tenant_id, company_id, tax_concept_id, tipo, tarifa,
        base_minima_uvt, base_minima_valor, comparador_base_minima,
        aplica_sobre, aplica_a, tipo_persona, municipality_id, ciiu_activity_id,
        rango_desde_uvt, rango_hasta_uvt, uvt_adicionales, gravada,
        account_id, vigente_desde, vigente_hasta, norma_respaldo, notas,
        requiere_verificacion_humana)
      VALUES (
        v_regla.tenant_id, v_regla.company_id, v_regla.tax_concept_id, v_regla.tipo, v_regla.tarifa,
        v_regla.base_minima_uvt, v_regla.base_minima_valor, v_regla.comparador_base_minima,
        v_regla.aplica_sobre, v_regla.aplica_a, v_regla.tipo_persona,
        v_regla.municipality_id, v_regla.ciiu_activity_id,
        v_regla.rango_desde_uvt, v_regla.rango_hasta_uvt, v_regla.uvt_adicionales, v_regla.gravada,
        v_destino, CURRENT_DATE, NULL, v_regla.norma_respaldo,
        concat_ws(' ', v_regla.notas,
          'D-089: vigencia abierta ÚNICAMENTE para corregir la cuenta de destino, que apuntaba a '
          || 'la agrupadora 2365 y ahora apunta a la subcuenta ' || v_cuenta || ' del Decreto 2650. '
          || 'Ni la tarifa, ni la base mínima, ni el comparador, ni los discriminadores, ni la norma '
          || 'de respaldo cambian: son los mismos de la vigencia que esta cierra.'),
        v_regla.requiere_verificacion_humana);
    END LOOP;
  END LOOP;
END $$;


-- =============================================================================
-- B. `2365` DEJA DE SER IMPUTABLE — SI Y SOLO SI SE PUEDE
-- =============================================================================
--
-- Una vez ninguna regla la referencia, `2365` no tiene por qué seguir
-- admitiendo partidas: en el Decreto 2650 es una cuenta de agrupación. Pero
-- desimputarla a ciegas es peligroso y la propia 179 lo impide:
--
--   · PU003 — con partidas en el ledger no se puede volver agrupadora, porque
--     el histórico quedaría imputado sobre algo que no admite imputación y los
--     reportes por niveles la sumarían dos veces. En una base que ya causó
--     facturas contra `2365` el camino correcto NO es este: es crear el
--     auxiliar y trasladar el saldo con un asiento. Aquí simplemente se deja
--     como está y se documenta.
--   · PU005 — con un `concepto_causacion` o una `memoria_clasificacion` activa
--     apuntándola, desimputarla rompería la causación en la siguiente factura.
--
-- Y se añade una condición propia: NINGUNA vigencia de `tax_rule` puede
-- referenciarla, ni siquiera una ya cerrada. Si una vigencia cerrada la cita,
-- el reproceso de una factura de esa época volvería a imputar ahí, y hacerlo
-- imposible sería reinterpretar el pasado (ver la nota larga de la cabecera).
--
-- Las condiciones se comprueban ANTES para que la migración no aborte por una
-- excepción del trigger: si alguna falla, esto no hace nada y la base queda
-- como estaba. No se fuerza nada.
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM public.account a
   WHERE a.tenant_id IS NULL AND a.company_id IS NULL AND a.codigo = '2365'
     AND a.permite_movimiento;

  IF v_id IS NULL THEN
    RETURN;  -- no existe todavía, o ya es agrupadora.
  END IF;

  -- 1. Tiene subcuentas imputables: si no las tuviera, sería una hoja legítima
  --    y dejarla sin destino posible sería peor que el defecto.
  IF NOT EXISTS (SELECT 1 FROM public.account h
                  WHERE h.parent_id = v_id AND h.permite_movimiento AND h.activo) THEN
    RETURN;
  END IF;

  -- 2. Ninguna vigencia de ninguna regla —de ningún alcance, abierta o cerrada—
  --    la referencia.
  IF EXISTS (SELECT 1 FROM public.tax_rule r WHERE r.account_id = v_id) THEN
    RETURN;
  END IF;

  -- 3. Sin partidas en el ledger (PU003).
  IF app.cuenta_tiene_movimientos(v_id) THEN
    RETURN;
  END IF;

  -- 4. Sin conceptos de causación ni memorias activas (PU005).
  IF app.cuenta_conceptos_activos(v_id) > 0 THEN
    RETURN;
  END IF;

  UPDATE public.account SET permite_movimiento = false WHERE id = v_id;
END $$;

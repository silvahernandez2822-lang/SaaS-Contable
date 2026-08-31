-- =============================================================================
-- 150_a15_autovacuum_ledger_caliente.sql — Agente A15 (costo y DevOps)
--
-- CONTEXTO (D-057, ver ESTADO_PROYECTO.md): A14 midió que un JOIN
-- journal_line <-> journal_entry bajo RLS crece CUADRÁTICAMENTE sin
-- estadísticas del planificador: 10 s / 39 s / 159 s con 2.000 / 4.000 / 8.000
-- partidas, contra milisegundos con ANALYZE corrido. No es la RLS ni la vista:
-- es el planificador cayendo en bucle anidado por falta de estadísticas.
--
-- El harness de pruebas y el arranque local no tienen autovacuum (PGlite no
-- lo corre; por eso migrate-cli.ts/seed-cli.ts/arranque-cli.ts/
-- datos-ejemplo-cli.ts ahora terminan en `ANALYZE` explícito). El objetivo de
-- producción (Postgres gestionado: Supabase/Neon) SÍ corre autovacuum, pero
-- con el umbral por defecto (10% de filas cambiadas + 50 filas) una tabla
-- grande necesita que cambien MUCHAS filas antes de que se dispare un
-- ANALYZE — justo la ventana en la que una ráfaga de facturas nuevas puede
-- dejar al planificador con estadísticas obsoletas.
--
-- QUÉ: en vez de una fracción del tamaño de la tabla (`autovacuum_analyze_
-- scale_factor`, que en una tabla de cientos de miles de filas sigue siendo
-- un número grande de filas cambiadas), se apaga ese factor (0, un entero,
-- no una tarifa) y se deja SOLO un umbral fijo de filas (`autovacuum_analyze_
-- threshold`) en las dos tablas del JOIN medido: ANALYZE se dispara cada vez
-- que cambian ~500 filas, sin importar cuánto haya crecido la tabla. 500
-- líneas son del orden de 100-150 facturas causadas de una sola vez — muy por
-- debajo de las 8.000 con las que se midió el problema.
--
-- No se toca ninguna columna, restricción, índice ni política de RLS: son
-- parámetros de almacenamiento (`reloptions`), reversibles con
-- `ALTER TABLE ... RESET (...)`, sin impacto en Regla de Oro 1 (append-only).
-- =============================================================================

ALTER TABLE journal_entry SET (
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 500
);

ALTER TABLE journal_line SET (
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 500
);

COMMENT ON TABLE journal_entry IS
  'Encabezado del asiento contable, append-only tras posted (Regla de Oro 1). '
  'autovacuum afinado (D-057): el JOIN con journal_line bajo RLS degenera en '
  'bucle anidado sin estadisticas frescas tras una carga masiva.';

COMMENT ON TABLE journal_line IS
  'Partidas del asiento, append-only (Regla de Oro 1). '
  'autovacuum afinado (D-057): mismo motivo que journal_entry.';

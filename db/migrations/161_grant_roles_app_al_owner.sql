-- Sin esto, cualquier base nueva (staging, otra Neon, producción) queda con
-- el mismo bloqueo que tocó depurar a mano el 31/08/2026: el rol dueño de
-- DATABASE_URL no puede hacer SET LOCAL ROLE app_auth / app_user porque
-- PostgreSQL exige membresía explícita para eso. Idempotente: repetir el
-- GRANT no falla ni cambia nada si ya estaba otorgado.
DO $$
BEGIN
  EXECUTE format('GRANT app_auth TO %I', current_user);
  EXECUTE format('GRANT app_user TO %I', current_user);
END $$;
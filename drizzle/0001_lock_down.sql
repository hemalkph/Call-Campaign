-- The app talks to Postgres directly (as the `postgres` role, which bypasses RLS).
-- Supabase's public Data API must not reach these tables: RLS on with no policies denies
-- anon/authenticated everything, and the grants are revoked as a second lock.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','campaigns','campaign_callers','import_batches','import_chunks','contacts',
                           'calls','callbacks','templates','whatsapp_logs','audit_events','login_attempts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- Row-Level Security tenant isolation (layer 2 behind the Prisma tenant extension).
--
-- Contract with the backend:
--   * connect as app_user (no BYPASSRLS) for normal tenant traffic;
--   * inside EVERY request transaction run first:
--       SELECT set_config('app.tenant_id', '<tenant id>', true);
--   * app_admin (BYPASSRLS) is reserved for super-admin / cross-tenant jobs.
-- Passwords are NOT set here; run ALTER ROLE ... PASSWORD out of band.
--
-- NULLIF(...,'') matters: after set_config(..., true) commits, the GUC stays as an
-- empty string for the rest of the session, and ''::int would raise an error.

-- 1. Roles -------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin LOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Bound runaway queries from a single tenant (noisy neighbour protection).
ALTER ROLE app_user SET statement_timeout = '15s';
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '30s';

-- Supabase's pooler authenticates custom roles through the postgres role.
DO $$
BEGIN
  EXECUTE format('GRANT app_user, app_admin TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skipping role membership grant: %', SQLERRM;
END
$$;

-- 2. Privileges --------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_user, app_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, app_admin;
REVOKE ALL ON TABLE "_prisma_migrations" FROM app_admin;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenant_subscriptions')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO app_user', t);
  END LOOP;
END
$$;

-- Read-only for tenants: their own tenant row, plan catalogue, own subscription history.
GRANT SELECT ON "tenants", "subscription_plans", "tenant_subscriptions" TO app_user;
-- platform_admins and _prisma_migrations: no grant to app_user at all.

-- New tables must not be silently exposed: nothing is granted by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_user;

-- 3. tenant_id default from the session variable ------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenant_subscriptions')
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting(''app.tenant_id'', true), '''')::integer',
      t);
  END LOOP;
END
$$;

-- 4. Policies ----------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenant_subscriptions')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I
        AS PERMISSIVE FOR ALL TO app_user
        USING (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer))
        WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer))
    $p$, t);
  END LOOP;
END
$$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_read ON "tenants";
CREATE POLICY tenant_self_read ON "tenants" AS PERMISSIVE FOR SELECT TO app_user
  USING (id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer));

ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_read ON "tenant_subscriptions";
CREATE POLICY tenant_self_read ON "tenant_subscriptions" AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer));

ALTER TABLE "subscription_plans" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_read ON "subscription_plans";
CREATE POLICY plans_read ON "subscription_plans" AS PERMISSIVE FOR SELECT TO app_user USING (true);

ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;

-- 5. Guard: every future table in public gets RLS enabled automatically ---------
-- (a table with RLS enabled and no policy returns no rows to app_user).
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION public.ensure_rls_on_new_tables() RETURNS event_trigger
  LANGUAGE plpgsql AS $f$
  DECLARE
    obj record;
  BEGIN
    FOR obj IN
      SELECT * FROM pg_event_trigger_ddl_commands()
      WHERE command_tag = 'CREATE TABLE' AND object_type = 'table' AND schema_name = 'public'
    LOOP
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
    END LOOP;
  END
  $f$;
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls_on_new_tables') THEN
    CREATE EVENT TRIGGER ensure_rls_on_new_tables ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.ensure_rls_on_new_tables();
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'event trigger not created (insufficient privilege); enable RLS manually on new tables';
END
$$;

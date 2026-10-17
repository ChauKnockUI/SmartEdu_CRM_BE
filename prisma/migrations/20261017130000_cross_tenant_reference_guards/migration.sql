-- Block cross-tenant references on single-column foreign keys.
--
-- Why: a plain FK only checks that the referenced id exists, and RLS only checks the
-- tenant_id of the row being written, so tenant A could store course_id = <course of
-- tenant B> and the write succeeds. Required relations already use composite
-- (tenant_id, id) FKs; this covers the remaining single-column ones (21 optional
-- relations + notifications.user_id / class_materials.uploaded_by).
--
-- Why triggers instead of composite FKs: for optional relations a composite FK cannot
-- keep ON DELETE SET NULL (it would also try to null the NOT NULL tenant_id), which
-- would change application behaviour (e.g. deleting a lead that has a student). Triggers
-- keep every existing referential action untouched and are invisible to Prisma, so
-- schema.prisma and the generated client do not change.
--
-- Each reference gets its own small static-SQL function (about 4x cheaper on bulk inserts
-- than a generic dynamic one). The error code is 23503 (foreign_key_violation), which Prisma reports as P2003.

DO $$
DECLARE
  r record;
  bad bigint;
  fn text;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS child,
           c.confrelid::regclass::text AS parent,
           a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND array_length(c.conkey, 1) = 1
      AND c.confrelid::regclass::text <> 'tenants'
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid  AND x.attname = 'tenant_id' AND NOT x.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
    ORDER BY 1, 3
  LOOP
    -- Refuse to continue if existing data already contains a cross-tenant reference.
    EXECUTE format(
      'SELECT count(*) FROM public.%I ch WHERE ch.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = ch.%I AND p.tenant_id = ch.tenant_id)',
      r.child, r.col, r.parent, r.col) INTO bad;
    IF bad > 0 THEN
      RAISE EXCEPTION 'existing cross-tenant references in %.% (% rows); fix data first', r.child, r.col, bad;
    END IF;

    fn := 'chk_same_tenant_' || r.child || '_' || r.col;
    -- One static-SQL function per reference: the plan is cached, unlike a generic EXECUTE-based one.
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        IF EXISTS (SELECT 1 FROM public.%I p WHERE p.id = NEW.%I AND p.tenant_id = NEW.tenant_id) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'cross-tenant reference rejected: %s.%s -> %s.id = %%', NEW.%I
          USING ERRCODE = '23503';
      END
      $body$
    $f$, fn, r.parent, r.col, r.child, r.col, r.parent, r.col);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_same_tenant_' || r.child || '_' || r.col, r.child);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I, tenant_id ON public.%I FOR EACH ROW WHEN (NEW.%I IS NOT NULL) EXECUTE FUNCTION public.%I()',
      'trg_same_tenant_' || r.child || '_' || r.col, r.col, r.child, r.col, fn);
  END LOOP;
END
$$;

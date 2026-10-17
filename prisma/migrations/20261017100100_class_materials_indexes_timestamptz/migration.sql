-- class_materials was created outside the migration history (db push), so every
-- statement here is guarded to be safe whether or not the table already exists.

DO $$
BEGIN
  IF to_regclass('public.class_materials') IS NULL THEN
    RAISE NOTICE 'public.class_materials not found, skipping';
    RETURN;
  END IF;

  -- Foreign keys had no index: lookups by class and cascade deletes from classes were sequential scans.
  CREATE INDEX IF NOT EXISTS "class_materials_class_id_idx" ON public.class_materials ("class_id");
  CREATE INDEX IF NOT EXISTS "class_materials_uploaded_by_idx" ON public.class_materials ("uploaded_by");

  -- timestamp -> timestamptz. Existing values were written by Prisma in UTC.
  ALTER TABLE public.class_materials
    ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
END
$$;

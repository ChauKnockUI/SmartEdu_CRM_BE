-- Catch-up migration for objects that exist in the live database but were never captured in
-- the migration history (they were created with `prisma db push`, plus the migration file
-- `20260522141143_add_schedule_content` that is applied on the live DB but missing from the repo).
--
-- Every statement is idempotent and the whole script is skipped once multi-tenant is applied, so it is a
-- no-op on existing databases (Supabase, the local test DB) and builds the missing objects on a fresh one. It is ordered before
-- `20261017110000_multitenant_core`, which alters these tables and cannot run without them.
--
-- Objects covered:
--   * courses.is_active
--   * schedules.notes / memo / attendance_unlocked_at / is_attendance_unlocked
--   * enum "NotificationType" and table "notifications"
--   * table "class_materials" (final shape: timestamptz columns + FK indexes)

-- Guard: when `tenants` already exists, `20261017110000_multitenant_core` has run and replaced some of the
-- objects below (e.g. old class_materials / notifications indexes by tenant-first ones). Prisma treats this
-- earlier-dated migration as "pending" on such databases, so it must do nothing there.
DO $catchup$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    RAISE NOTICE 'multitenant_core already applied; catch-up skipped';
    RETURN;
  END IF;

  -- courses ----------------------------------------------------------------------
  ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

  -- schedules ------------------------------------------------------------------
  ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "notes" TEXT;
  ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "memo" TEXT;
  ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "attendance_unlocked_at" TIMESTAMP(3);
  ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "is_attendance_unlocked" BOOLEAN NOT NULL DEFAULT false;

  -- notifications ----------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
      CREATE TYPE "NotificationType" AS ENUM ('general', 'attendance_reminder', 'overdue_attendance', 'system_alert');
    END IF;

  CREATE TABLE IF NOT EXISTS "notifications" (
      "id" SERIAL NOT NULL,
      "user_id" INTEGER NOT NULL,
      "type" "NotificationType" NOT NULL DEFAULT 'general',
      "title" VARCHAR(255) NOT NULL,
      "message" TEXT NOT NULL,
      "link" VARCHAR(500),
      "is_read" BOOLEAN NOT NULL DEFAULT false,
      "metadata" JSONB,
      "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
  );

  CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");
  CREATE INDEX IF NOT EXISTS "notifications_createdAt_idx" ON "notifications"("createdAt" DESC);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey') THEN
      ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

  -- class_materials --------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS "class_materials" (
      "id" SERIAL NOT NULL,
      "class_id" INTEGER NOT NULL,
      "title" TEXT NOT NULL,
      "file_name" TEXT NOT NULL,
      "file_url" TEXT NOT NULL,
      "file_type" TEXT,
      "file_size" INTEGER,
      "uploaded_by" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "class_materials_pkey" PRIMARY KEY ("id")
  );

  CREATE INDEX IF NOT EXISTS "class_materials_class_id_idx" ON "class_materials"("class_id");
  CREATE INDEX IF NOT EXISTS "class_materials_uploaded_by_idx" ON "class_materials"("uploaded_by");

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_materials_class_id_fkey') THEN
      ALTER TABLE "class_materials" ADD CONSTRAINT "class_materials_class_id_fkey"
        FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_materials_uploaded_by_fkey') THEN
      ALTER TABLE "class_materials" ADD CONSTRAINT "class_materials_uploaded_by_fkey"
        FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$catchup$;

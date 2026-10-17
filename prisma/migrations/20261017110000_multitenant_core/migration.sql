-- Multi-tenant core: tenants/plans tables, tenant_id on every business table,
-- tenant-scoped uniques, composite (tenant_id, id) foreign keys and tenant-first indexes.
-- The whole script runs as one implicit transaction (simple-protocol multi-statement).

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('trial', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'cancelled', 'expired');

-- DropForeignKey
ALTER TABLE "lead_activities" DROP CONSTRAINT "lead_activities_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "fee_plan_items" DROP CONSTRAINT "fee_plan_items_fee_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "class_enrollments" DROP CONSTRAINT "class_enrollments_class_id_fkey";

-- DropForeignKey
ALTER TABLE "class_enrollments" DROP CONSTRAINT "class_enrollments_student_id_fkey";

-- DropForeignKey
ALTER TABLE "attendances" DROP CONSTRAINT "attendances_schedule_id_fkey";

-- DropForeignKey
ALTER TABLE "attendances" DROP CONSTRAINT "attendances_student_id_fkey";

-- DropForeignKey
ALTER TABLE "tests" DROP CONSTRAINT "tests_class_id_fkey";

-- DropForeignKey
ALTER TABLE "test_results" DROP CONSTRAINT "test_results_student_id_fkey";

-- DropForeignKey
ALTER TABLE "test_results" DROP CONSTRAINT "test_results_test_id_fkey";

-- DropForeignKey
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_class_id_fkey";

-- DropForeignKey
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_student_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_student_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_student_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_items" DROP CONSTRAINT "invoice_items_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_transactions" DROP CONSTRAINT "payment_transactions_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_ai_scores" DROP CONSTRAINT "lead_ai_scores_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "class_materials" DROP CONSTRAINT "class_materials_class_id_fkey";

-- DropIndex
DROP INDEX "users_email_key";

-- DropIndex
DROP INDEX "users_role_idx";

-- DropIndex
DROP INDEX "users_is_active_idx";

-- DropIndex
DROP INDEX "leads_status_idx";

-- DropIndex
DROP INDEX "leads_lead_source_idx";

-- DropIndex
DROP INDEX "leads_course_id_idx";

-- DropIndex
DROP INDEX "leads_assigned_to_idx";

-- DropIndex
DROP INDEX "leads_createdAt_idx";

-- DropIndex
DROP INDEX "lead_activities_lead_id_type_idx";

-- DropIndex
DROP INDEX "lead_activities_lead_id_createdAt_idx";

-- DropIndex
DROP INDEX "lead_activities_user_id_idx";

-- DropIndex
DROP INDEX "students_email_key";

-- DropIndex
DROP INDEX "students_status_idx";

-- DropIndex
DROP INDEX "students_enrollment_date_idx";

-- DropIndex
DROP INDEX "teachers_email_key";

-- DropIndex
DROP INDEX "teachers_is_active_idx";

-- DropIndex
DROP INDEX "classes_status_idx";

-- DropIndex
DROP INDEX "classes_course_id_idx";

-- DropIndex
DROP INDEX "classes_fee_plan_id_idx";

-- DropIndex
DROP INDEX "classes_teacher_id_idx";

-- DropIndex
DROP INDEX "classes_room_id_idx";

-- DropIndex
DROP INDEX "fee_plans_course_id_idx";

-- DropIndex
DROP INDEX "fee_plans_is_active_idx";

-- DropIndex
DROP INDEX "fee_plan_items_fee_plan_id_idx";

-- DropIndex
DROP INDEX "class_enrollments_student_id_idx";

-- DropIndex
DROP INDEX "rooms_name_key";

-- DropIndex
DROP INDEX "schedules_date_idx";

-- DropIndex
DROP INDEX "schedules_class_id_idx";

-- DropIndex
DROP INDEX "schedules_teacher_id_idx";

-- DropIndex
DROP INDEX "schedules_room_id_idx";

-- DropIndex
DROP INDEX "attendances_student_id_idx";

-- DropIndex
DROP INDEX "tests_class_id_idx";

-- DropIndex
DROP INDEX "tests_test_date_idx";

-- DropIndex
DROP INDEX "test_results_student_id_idx";

-- DropIndex
DROP INDEX "assignments_class_id_idx";

-- DropIndex
DROP INDEX "assignments_due_date_idx";

-- DropIndex
DROP INDEX "assignments_created_by_idx";

-- DropIndex
DROP INDEX "assignment_submissions_student_id_idx";

-- DropIndex
DROP INDEX "assignment_submissions_status_idx";

-- DropIndex
DROP INDEX "payments_student_id_idx";

-- DropIndex
DROP INDEX "payments_class_id_idx";

-- DropIndex
DROP INDEX "payments_status_idx";

-- DropIndex
DROP INDEX "payments_payment_date_idx";

-- DropIndex
DROP INDEX "invoices_invoice_no_key";

-- DropIndex
DROP INDEX "invoices_student_id_idx";

-- DropIndex
DROP INDEX "invoices_class_id_idx";

-- DropIndex
DROP INDEX "invoices_status_idx";

-- DropIndex
DROP INDEX "invoices_due_date_idx";

-- DropIndex
DROP INDEX "invoice_items_invoice_id_idx";

-- DropIndex
DROP INDEX "payment_transactions_invoice_id_idx";

-- DropIndex
DROP INDEX "payment_transactions_paid_at_idx";

-- DropIndex
DROP INDEX "payment_transactions_received_by_idx";

-- DropIndex
DROP INDEX "receipts_receipt_no_key";

-- DropIndex
DROP INDEX "receipts_invoice_id_idx";

-- DropIndex
DROP INDEX "receipts_transaction_id_idx";

-- DropIndex
DROP INDEX "receipts_issued_at_idx";

-- DropIndex
DROP INDEX "ai_predictions_prediction_type_idx";

-- DropIndex
DROP INDEX "ai_predictions_reference_id_idx";

-- DropIndex
DROP INDEX "lead_ai_scores_probability_score_idx";

-- DropIndex
DROP INDEX "class_materials_class_id_idx";

-- DropIndex
DROP INDEX "class_materials_uploaded_by_idx";

-- DropIndex
DROP INDEX "notifications_user_id_is_read_idx";

-- DropIndex
DROP INDEX "notifications_createdAt_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "lead_activities" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "fee_plans" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "fee_plan_items" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "class_enrollments" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "tests" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "test_results" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "assignment_submissions" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "ai_predictions" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "lead_ai_scores" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "class_materials" ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "tenant_id" INTEGER;

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price_monthly" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "max_students" INTEGER,
    "max_users" INTEGER,
    "features" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "subdomain" VARCHAR(63) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'trial',
    "plan_id" INTEGER,
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(20),
    "trial_ends_at" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "amount" DECIMAL(15,2) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- Multi-tenant bootstrap -----------------------------------------------------
-- All pre-existing data belongs to a single legacy center: tenant id = 1.
INSERT INTO "subscription_plans" ("id", "code", "name", "price_monthly", "updatedAt")
VALUES (1, 'default', 'Default', 0, CURRENT_TIMESTAMP);

INSERT INTO "tenants" ("id", "name", "subdomain", "status", "plan_id", "updatedAt")
VALUES (1, 'Default Center', 'demo', 'active', 1, CURRENT_TIMESTAMP);

SELECT setval(pg_get_serial_sequence('"subscription_plans"', 'id'), 1);
SELECT setval(pg_get_serial_sequence('"tenants"', 'id'), 1);

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_subdomain_format_chk" CHECK (
  "subdomain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  AND "subdomain" NOT IN ('www', 'admin', 'api', 'app', 'auth', 'login', 'mail', 'static', 'assets', 'status', 'support', 'platform', 'super-admin')
);

-- Backfill tenant_id, then make it mandatory.
UPDATE "users" SET "tenant_id" = 1;
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "leads" SET "tenant_id" = 1;
ALTER TABLE "leads" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "lead_activities" SET "tenant_id" = 1;
ALTER TABLE "lead_activities" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "students" SET "tenant_id" = 1;
ALTER TABLE "students" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "teachers" SET "tenant_id" = 1;
ALTER TABLE "teachers" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "courses" SET "tenant_id" = 1;
ALTER TABLE "courses" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "classes" SET "tenant_id" = 1;
ALTER TABLE "classes" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "fee_plans" SET "tenant_id" = 1;
ALTER TABLE "fee_plans" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "fee_plan_items" SET "tenant_id" = 1;
ALTER TABLE "fee_plan_items" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "class_enrollments" SET "tenant_id" = 1;
ALTER TABLE "class_enrollments" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "rooms" SET "tenant_id" = 1;
ALTER TABLE "rooms" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "schedules" SET "tenant_id" = 1;
ALTER TABLE "schedules" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "attendances" SET "tenant_id" = 1;
ALTER TABLE "attendances" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "tests" SET "tenant_id" = 1;
ALTER TABLE "tests" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "test_results" SET "tenant_id" = 1;
ALTER TABLE "test_results" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "assignments" SET "tenant_id" = 1;
ALTER TABLE "assignments" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "assignment_submissions" SET "tenant_id" = 1;
ALTER TABLE "assignment_submissions" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "payments" SET "tenant_id" = 1;
ALTER TABLE "payments" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "invoices" SET "tenant_id" = 1;
ALTER TABLE "invoices" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "invoice_items" SET "tenant_id" = 1;
ALTER TABLE "invoice_items" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "payment_transactions" SET "tenant_id" = 1;
ALTER TABLE "payment_transactions" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "receipts" SET "tenant_id" = 1;
ALTER TABLE "receipts" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "ai_predictions" SET "tenant_id" = 1;
ALTER TABLE "ai_predictions" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "lead_ai_scores" SET "tenant_id" = 1;
ALTER TABLE "lead_ai_scores" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "class_materials" SET "tenant_id" = 1;
ALTER TABLE "class_materials" ALTER COLUMN "tenant_id" SET NOT NULL;

UPDATE "notifications" SET "tenant_id" = 1;
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE INDEX "tenants_plan_id_idx" ON "tenants"("plan_id");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_tenant_id_period_end_idx" ON "tenant_subscriptions"("tenant_id", "period_end");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_plan_id_idx" ON "tenant_subscriptions"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_createdAt_idx" ON "leads"("tenant_id", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_to_status_idx" ON "leads"("tenant_id", "assigned_to", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_course_id_idx" ON "leads"("tenant_id", "course_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_lead_source_idx" ON "leads"("tenant_id", "lead_source");

-- CreateIndex
CREATE INDEX "leads_tenant_id_createdAt_idx" ON "leads"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_id_key" ON "leads"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "lead_activities_tenant_id_lead_id_type_idx" ON "lead_activities"("tenant_id", "lead_id", "type");

-- CreateIndex
CREATE INDEX "lead_activities_tenant_id_lead_id_createdAt_idx" ON "lead_activities"("tenant_id", "lead_id", "createdAt");

-- CreateIndex
CREATE INDEX "lead_activities_tenant_id_user_id_idx" ON "lead_activities"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "students_tenant_id_status_idx" ON "students"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "students_tenant_id_enrollment_date_idx" ON "students"("tenant_id", "enrollment_date");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_email_key" ON "students"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_id_key" ON "students"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "teachers_tenant_id_is_active_idx" ON "teachers"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_tenant_id_email_key" ON "teachers"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "courses_tenant_id_is_active_idx" ON "courses"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "classes_tenant_id_status_idx" ON "classes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "classes_tenant_id_course_id_idx" ON "classes"("tenant_id", "course_id");

-- CreateIndex
CREATE INDEX "classes_tenant_id_fee_plan_id_idx" ON "classes"("tenant_id", "fee_plan_id");

-- CreateIndex
CREATE INDEX "classes_tenant_id_teacher_id_idx" ON "classes"("tenant_id", "teacher_id");

-- CreateIndex
CREATE INDEX "classes_tenant_id_room_id_idx" ON "classes"("tenant_id", "room_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_tenant_id_id_key" ON "classes"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fee_plans_tenant_id_course_id_idx" ON "fee_plans"("tenant_id", "course_id");

-- CreateIndex
CREATE INDEX "fee_plans_tenant_id_is_active_idx" ON "fee_plans"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "fee_plans_tenant_id_id_key" ON "fee_plans"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fee_plan_items_tenant_id_fee_plan_id_idx" ON "fee_plan_items"("tenant_id", "fee_plan_id");

-- CreateIndex
CREATE INDEX "class_enrollments_tenant_id_class_id_status_idx" ON "class_enrollments"("tenant_id", "class_id", "status");

-- CreateIndex
CREATE INDEX "class_enrollments_tenant_id_student_id_idx" ON "class_enrollments"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_name_key" ON "rooms"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_date_idx" ON "schedules"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_class_id_date_idx" ON "schedules"("tenant_id", "class_id", "date");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_teacher_id_date_idx" ON "schedules"("tenant_id", "teacher_id", "date");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_room_id_date_idx" ON "schedules"("tenant_id", "room_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_id_key" ON "schedules"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "attendances_tenant_id_student_id_idx" ON "attendances"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "tests_tenant_id_class_id_idx" ON "tests"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "tests_tenant_id_test_date_idx" ON "tests"("tenant_id", "test_date");

-- CreateIndex
CREATE UNIQUE INDEX "tests_tenant_id_id_key" ON "tests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "test_results_tenant_id_student_id_idx" ON "test_results"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "assignments_tenant_id_class_id_idx" ON "assignments"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "assignments_tenant_id_due_date_idx" ON "assignments"("tenant_id", "due_date");

-- CreateIndex
CREATE INDEX "assignments_tenant_id_created_by_idx" ON "assignments"("tenant_id", "created_by");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_tenant_id_id_key" ON "assignments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "assignment_submissions_tenant_id_student_id_idx" ON "assignment_submissions"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_tenant_id_status_idx" ON "assignment_submissions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "payments_tenant_id_student_id_idx" ON "payments"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_class_id_idx" ON "payments"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_status_idx" ON "payments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "payments_tenant_id_payment_date_idx" ON "payments"("tenant_id", "payment_date");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_student_id_status_idx" ON "invoices"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_class_id_idx" ON "invoices"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_due_date_idx" ON "invoices"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_no_key" ON "invoices"("tenant_id", "invoice_no");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_id_key" ON "invoices"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "invoice_items_tenant_id_invoice_id_idx" ON "invoice_items"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_transactions_tenant_id_invoice_id_idx" ON "payment_transactions"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_transactions_tenant_id_paid_at_idx" ON "payment_transactions"("tenant_id", "paid_at");

-- CreateIndex
CREATE INDEX "payment_transactions_tenant_id_received_by_idx" ON "payment_transactions"("tenant_id", "received_by");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_invoice_id_idx" ON "receipts"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_transaction_id_idx" ON "receipts"("tenant_id", "transaction_id");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_issued_at_idx" ON "receipts"("tenant_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_receipt_no_key" ON "receipts"("tenant_id", "receipt_no");

-- CreateIndex
CREATE INDEX "ai_predictions_tenant_id_prediction_type_createdAt_idx" ON "ai_predictions"("tenant_id", "prediction_type", "createdAt");

-- CreateIndex
CREATE INDEX "ai_predictions_tenant_id_reference_id_idx" ON "ai_predictions"("tenant_id", "reference_id");

-- CreateIndex
CREATE INDEX "lead_ai_scores_tenant_id_probability_score_idx" ON "lead_ai_scores"("tenant_id", "probability_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "lead_ai_scores_tenant_id_lead_id_key" ON "lead_ai_scores"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "class_materials_tenant_id_class_id_idx" ON "class_materials"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "class_materials_tenant_id_uploaded_by_idx" ON "class_materials"("tenant_id", "uploaded_by");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_is_read_idx" ON "notifications"("tenant_id", "user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_createdAt_idx" ON "notifications"("tenant_id", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_lead_id_fkey" FOREIGN KEY ("tenant_id", "lead_id") REFERENCES "leads"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plan_items" ADD CONSTRAINT "fee_plan_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plan_items" ADD CONSTRAINT "fee_plan_items_tenant_id_fee_plan_id_fkey" FOREIGN KEY ("tenant_id", "fee_plan_id") REFERENCES "fee_plans"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "schedules"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_tenant_id_test_id_fkey" FOREIGN KEY ("tenant_id", "test_id") REFERENCES "tests"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_tenant_id_assignment_id_fkey" FOREIGN KEY ("tenant_id", "assignment_id") REFERENCES "assignments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_predictions" ADD CONSTRAINT "ai_predictions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_ai_scores" ADD CONSTRAINT "lead_ai_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_ai_scores" ADD CONSTRAINT "lead_ai_scores_tenant_id_lead_id_fkey" FOREIGN KEY ("tenant_id", "lead_id") REFERENCES "leads"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_materials" ADD CONSTRAINT "class_materials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_materials" ADD CONSTRAINT "class_materials_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


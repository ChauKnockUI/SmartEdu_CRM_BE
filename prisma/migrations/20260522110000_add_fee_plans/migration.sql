CREATE TABLE "fee_plans" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fee_plan_items" (
    "id" SERIAL NOT NULL,
    "fee_plan_id" INTEGER NOT NULL,
    "type" "InvoiceItemType" NOT NULL DEFAULT 'tuition',
    "description" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_plan_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "classes" ADD COLUMN "fee_plan_id" INTEGER;

CREATE INDEX "fee_plans_course_id_idx" ON "fee_plans"("course_id");
CREATE INDEX "fee_plans_is_active_idx" ON "fee_plans"("is_active");
CREATE INDEX "fee_plan_items_fee_plan_id_idx" ON "fee_plan_items"("fee_plan_id");
CREATE INDEX "classes_fee_plan_id_idx" ON "classes"("fee_plan_id");

ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_plan_items" ADD CONSTRAINT "fee_plan_items_fee_plan_id_fkey" FOREIGN KEY ("fee_plan_id") REFERENCES "fee_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classes" ADD CONSTRAINT "classes_fee_plan_id_fkey" FOREIGN KEY ("fee_plan_id") REFERENCES "fee_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

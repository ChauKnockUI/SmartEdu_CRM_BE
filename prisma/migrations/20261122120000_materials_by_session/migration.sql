-- Existing materials remain class-wide; no files or existing rows are moved.
ALTER TABLE "class_materials" ADD COLUMN "schedule_id" INTEGER;

CREATE UNIQUE INDEX "schedules_tenant_id_class_id_id_key"
ON "schedules"("tenant_id", "class_id", "id");

CREATE INDEX "class_materials_tenant_id_class_id_schedule_id_idx"
ON "class_materials"("tenant_id", "class_id", "schedule_id");

ALTER TABLE "class_materials"
ADD CONSTRAINT "class_materials_tenant_id_class_id_schedule_id_fkey"
FOREIGN KEY ("tenant_id", "class_id", "schedule_id")
REFERENCES "schedules"("tenant_id", "class_id", "id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

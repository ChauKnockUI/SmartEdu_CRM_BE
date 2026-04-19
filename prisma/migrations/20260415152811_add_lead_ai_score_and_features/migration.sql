/*
  Warnings:

  - You are about to drop the column `ai_recommendation` on the `leads` table. All the data in the column will be lost.
  - You are about to drop the column `ai_score` on the `leads` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `leads` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "LeadAiRecommendation" AS ENUM ('HOT_LEAD', 'WARM_LEAD', 'COLD_LEAD');

-- DropIndex
DROP INDEX "lead_activities_lead_id_idx";

-- DropIndex
DROP INDEX "lead_activities_type_idx";

-- DropIndex
DROP INDEX "leads_source_idx";

-- AlterTable
ALTER TABLE "lead_activities" ADD COLUMN     "engagement_status" VARCHAR(255);

-- AlterTable
ALTER TABLE "leads" DROP COLUMN "ai_recommendation",
DROP COLUMN "ai_score",
DROP COLUMN "source",
ADD COLUMN     "course_id" INTEGER,
ADD COLUMN     "lead_source" VARCHAR(255) DEFAULT 'other',
ADD COLUMN     "occupation" VARCHAR(255),
ADD COLUMN     "study_purpose" VARCHAR(255);

-- DropEnum
DROP TYPE "LeadSource";

-- CreateTable
CREATE TABLE "lead_ai_scores" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "probability_score" DOUBLE PRECISION NOT NULL,
    "recommendation" "LeadAiRecommendation" NOT NULL,
    "positive_factors" JSONB,
    "negative_factors" JSONB,
    "scored_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lead_ai_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_ai_scores_lead_id_key" ON "lead_ai_scores"("lead_id");

-- CreateIndex
CREATE INDEX "lead_ai_scores_probability_score_idx" ON "lead_ai_scores"("probability_score" DESC);

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_type_idx" ON "lead_activities"("lead_id", "type");

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_createdAt_idx" ON "lead_activities"("lead_id", "createdAt");

-- CreateIndex
CREATE INDEX "leads_lead_source_idx" ON "leads"("lead_source");

-- CreateIndex
CREATE INDEX "leads_course_id_idx" ON "leads"("course_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_ai_scores" ADD CONSTRAINT "lead_ai_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

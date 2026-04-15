import { PrismaClient, LeadAiRecommendation, LeadActivityType, PredictionType } from '../../generated/prisma';

const prisma = new PrismaClient();

export class LeadScoringRepository {
    async getLeadWithCourse(leadId: number) {
        return await prisma.lead.findUnique({
            where: { id: leadId },
            include: {
                course: {
                    select: { name: true }
                }
            }
        });
    }

    async getCallAttemptCount(leadId: number): Promise<number> {
        return await prisma.leadActivity.count({
            where: {
                lead_id: leadId,
                type: LeadActivityType.call
            }
        });
    }

    async getLatestEngagementStatus(leadId: number): Promise<string | null> {
        const latestActivity = await prisma.leadActivity.findFirst({
            where: { lead_id: leadId },
            orderBy: { createdAt: 'desc' },
            select: { engagement_status: true }
        });
        return latestActivity?.engagement_status || null;
    }

    async upsertLeadAiScore(leadId: number, aiResponse: any) {
        return await prisma.leadAiScore.upsert({
            where: { lead_id: leadId },
            update: {
                probability_score: aiResponse.probability_score,
                recommendation: aiResponse.recommendation,
                positive_factors: aiResponse.explanation.positive_factors ?? [],
                negative_factors: aiResponse.explanation.negative_factors ?? [],
                scored_at: new Date()
            },
            create: {
                lead_id: leadId,
                probability_score: aiResponse.probability_score,
                recommendation: aiResponse.recommendation,
                positive_factors: aiResponse.explanation.positive_factors ?? [],
                negative_factors: aiResponse.explanation.negative_factors ?? [],
                scored_at: new Date()
            }
        });
    }

    async logAiPrediction(leadId: number, features: any, aiResponse: any) {
        return await prisma.aIPrediction.create({
            data: {
                prediction_type: PredictionType.lead_score,
                reference_id: leadId,
                input_data: features,
                result_data: aiResponse
            }
        });
    }
}

export const leadScoringRepository = new LeadScoringRepository();

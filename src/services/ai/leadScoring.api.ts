import axios from 'axios';
import { LeadAiRecommendation } from '../../generated/prisma';

export interface AIModelInput {
    Lead_Source: string;
    Occupation: string;
    Study_Purpose: string;
    Course_Interested: string;
    Call_Attempt_Count: number;
    Last_Engagement_Status: string;
    Days_Since_Created: number;
}

export interface AIModelResponse {
    prediction: string;
    probability_score: number;
    recommendation: LeadAiRecommendation;
    explanation: {
        positive_factors: string[];
        negative_factors: string[];
    };
}

export class LeadScoringApi {
    private readonly AI_URL = process.env.AI_LEAD_SCORING_URL || 'http://127.0.0.1:8000/explain-lead-v2';

    async fetchAiPrediction(payload: AIModelInput): Promise<AIModelResponse> {
        try {
            const response = await axios.post<AIModelResponse>(this.AI_URL, payload, {
                timeout: 10000 // Timeout sau 10 giây (Tránh treo service BE)
            });
            
            return response.data;
        } catch (error: any) {
            console.error("[LeadScoringApi] Lỗi khi kết nối đến AI Service:", error.message);
            
            // Fallback response tránh sập Flow chính
            return {
                prediction: "Unknown",
                probability_score: 0,
                recommendation: LeadAiRecommendation.COLD_LEAD,
                explanation: {
                    positive_factors: ["Lỗi server AI, chưa thể tính toán"],
                    negative_factors: []
                }
            };
        }
    }
}

export const leadScoringApi = new LeadScoringApi();

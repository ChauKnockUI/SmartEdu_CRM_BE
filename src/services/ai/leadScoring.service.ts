import { leadScoringRepository } from './leadScoring.repository';
import { leadScoringApi, AIModelInput } from './leadScoring.api';

export class LeadScoringService {
    private normalizeLeadSource(value?: string | null) {
        const normalized = (value || 'other').trim().toLowerCase();
        const map: Record<string, string> = {
            google: 'google_ads',
            'google form': 'google_ads',
            website: 'website_organic',
            organic: 'website_organic',
        };
        return map[normalized] || normalized;
    }

    private normalizeStudyPurpose(value?: string | null) {
        const normalized = (value || 'other').trim().toLowerCase();
        const map: Record<string, string> = {
            career: 'career_advancement',
            improve: 'hobby',
            exam: 'pass_exam',
        };
        return map[normalized] || normalized;
    }

    private normalizeCourse(value?: string | null) {
        const normalized = (value || 'other').trim().toLowerCase();
        if (normalized.includes('ielts')) return 'ielts';
        if (normalized.includes('toeic')) return 'toeic';
        if (normalized.includes('kid')) return 'kids_english';
        if (normalized.includes('giao tiếp') || normalized.includes('communication')) return 'communication_english';
        if (normalized.includes('data')) return 'data_analysis';
        if (normalized.includes('frontend')) return 'frontend';
        if (normalized.includes('backend') || normalized.includes('node')) return 'backend_nodejs';
        return normalized.replace(/\s+/g, '_');
    }

    private normalizeEngagementStatus(value?: string | null) {
        const normalized = (value || 'not_answering').trim().toLowerCase();
        const map: Record<string, string> = {
            high: 'positive_interaction',
            medium: 'interested_need_time',
            low: 'busy_call_back',
        };
        return map[normalized] || normalized;
    }

    /**
     * Lấy dữ liệu Lead và tính toán các Features chuẩn bị gửi cho AI Model.
     */
    async prepareLeadScoringFeatures(leadId: number): Promise<AIModelInput> {
        // 1. Lấy thông tin cơ bản
        const lead = await leadScoringRepository.getLeadWithCourse(leadId);
        if (!lead) {
            throw new Error(`Lead with ID ${leadId} not found.`);
        }

        // 2. Query thống kê (tối ưu qua Redis hoặc composite index)
        const callAttemptCount = await leadScoringRepository.getCallAttemptCount(leadId);
        
        // 3. Trạng thái tương tác cuối cùng
        const rawStatus = await leadScoringRepository.getLatestEngagementStatus(leadId);
        const lastEngagementStatus = this.normalizeEngagementStatus(rawStatus);

        // 4. Tính toán business logic: Số ngày từ lúc được tạo
        const nowMs = Date.now();
        const createdMs = lead.createdAt.getTime();
        const daysSinceCreated = (nowMs - createdMs) / (1000 * 60 * 60 * 24);

        // 5. Chuẩn hóa Payload
        return {
            Lead_Source: this.normalizeLeadSource(lead.lead_source),
            Occupation: lead.occupation || "other",
            Study_Purpose: this.normalizeStudyPurpose(lead.study_purpose),
            Course_Interested: this.normalizeCourse(lead.course?.name),
            Call_Attempt_Count: callAttemptCount,
            Last_Engagement_Status: lastEngagementStatus,
            Days_Since_Created: Math.max(0, Math.floor(daysSinceCreated))
        };
    }

    /**
     * Hàm Orchestrator chịu trách nhiệm quản lý toàn bộ Flow chấm điểm Lead
     */
    async scoreLead(leadId: number) {
        try {
            console.log(`[LeadScoringService] Bắt đầu chấm điểm AI cho Lead ID: ${leadId}`);

            // 1. Prepare Data
            const features = await this.prepareLeadScoringFeatures(leadId);

            // 2. Call External AI Service
            const aiResponse = await leadScoringApi.fetchAiPrediction(features);

            // 3. Persist Score to DB
            const savedScore = await leadScoringRepository.upsertLeadAiScore(leadId, aiResponse);
            
            // 4. Audit Logging
            await leadScoringRepository.logAiPrediction(leadId, features, aiResponse);

            console.log(`[LeadScoringService] Thành công xử lý Lead ID: ${leadId} | Score: ${savedScore.probability_score}`);

            return {
                success: true,
                data: savedScore,
                featuresExtracted: features
            };
        } catch (error: any) {
            console.error(`[LeadScoringService] Thất bại xử lý Lead ID ${leadId}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export const leadScoringService = new LeadScoringService();

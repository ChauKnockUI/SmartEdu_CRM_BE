import { leadScoringRepository } from './leadScoring.repository';
import { leadScoringApi } from './leadScoring.api';

export class LeadScoringService {
  async scoreLead(leadId: number) {
    try {
      const snapshot = await leadScoringRepository.readSnapshot(leadId);
      if (!snapshot) throw Object.assign(new Error('Không tìm thấy lead.'), { statusCode: 404 });
      const closed = ['enrolled', 'lost'].includes(snapshot.lead_status);
      const prediction = closed ? null : await leadScoringApi.fetchAiPrediction(snapshot.features);
      const result = await leadScoringRepository.persistAssessment(leadId, snapshot, prediction);
      return {
        success: true, data: result.aiScore, care: result.care, model_status: result.model_status,
        message: result.model_status === 'unavailable'
          ? 'AI tạm chưa sẵn sàng. Đã cập nhật ưu tiên chăm sóc và giữ nguyên điểm trước đó.'
          : result.model_status === 'superseded' ? 'Dữ liệu vừa thay đổi; vui lòng đánh giá lại lead.'
          : result.model_status === 'not_eligible' ? 'Lead đã kết thúc; không cần dự báo chuyển đổi.'
          : 'Đã cập nhật đánh giá và hướng chăm sóc lead.',
      };
    } catch (error: any) {
      console.error('[LeadScoringService]', error.message);
      return { success: false, error: error.message, statusCode: error.statusCode || 500 };
    }
  }
}
export const leadScoringService = new LeadScoringService();

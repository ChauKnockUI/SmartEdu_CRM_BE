import axios from 'axios';

export interface DropoutRiskFeatures {
  Average_Score: number | null;
  Pass_Rate: number;
  Not_Evaluated_Rate: number;
}

export interface DropoutRiskResponse {
  model_version: string;
  model_flagged: boolean;
  risk_score: number;
  threshold: number;
  score_type: 'source_model_score';
  top_reasons: string[];
  action: string;
}

export class DropoutRiskApi {
  private readonly AI_URL = process.env.AI_DROPOUT_RISK_URL || 'http://127.0.0.1:8000/predict-dropout';

  async fetchPrediction(payload: DropoutRiskFeatures): Promise<DropoutRiskResponse | null> {
    try {
      const { data } = await axios.post<DropoutRiskResponse>(this.AI_URL, payload, { timeout: 8000 });
      if (data.model_version !== 'uci_academic_public_1' || data.score_type !== 'source_model_score'
          || !Number.isFinite(data.risk_score) || data.risk_score < 0 || data.risk_score > 100
          || typeof data.model_flagged !== 'boolean' || !Array.isArray(data.top_reasons)
          || !Number.isFinite(data.threshold) || data.threshold <= 0 || data.threshold >= 1) {
        throw new Error('Incompatible dropout API response');
      }
      return data;
    } catch (error: any) {
      console.error('[DropoutRiskApi] AI service error:', error.message);
      return null;
    }
  }
}

export const dropoutRiskApi = new DropoutRiskApi();

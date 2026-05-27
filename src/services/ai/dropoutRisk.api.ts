import axios from 'axios';

export interface DropoutRiskFeatures {
  Attendance_Rate: number;
  Unexcused_Absence_Count: number;
  Unexcused_Absence_Rate: number;
  Late_Count: number;
  Consecutive_Unexcused_Absences: number;
  Days_Since_Last_Attended: number;
  Assignment_Missing_Rate: number;
  Assignment_Late_Count: number;
  Average_Score: number;
  Score_Trend: number;
  Has_Overdue_Invoice: number;
  Days_Overdue: number;
  Class_Progress_Ratio: number;
}

export interface DropoutRiskResponse {
  model_version?: string;
  risk_level: 'HIGH_RISK' | 'MEDIUM_RISK' | 'LOW_RISK';
  dropout_probability: number;
  top_reasons: string[];
  action: string;
}

export class DropoutRiskApi {
  private readonly AI_URL = process.env.AI_DROPOUT_RISK_URL || 'http://127.0.0.1:8000/predict-dropout';

  async fetchPrediction(payload: DropoutRiskFeatures): Promise<DropoutRiskResponse | null> {
    try {
      const response = await axios.post<DropoutRiskResponse>(this.AI_URL, payload, {
        timeout: 8000,
      });

      return response.data;
    } catch (error: any) {
      console.error('[DropoutRiskApi] AI service error:', error.message);
      return null;
    }
  }
}

export const dropoutRiskApi = new DropoutRiskApi();

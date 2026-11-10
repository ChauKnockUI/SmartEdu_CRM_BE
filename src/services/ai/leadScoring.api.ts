import axios from 'axios';
import type { LeadAiRecommendation } from '../../generated/prisma';

export interface AIModelInput {
  Lead_Source: string;
  Occupation: string;
  Study_Purpose: string;
  Course_Interested: string;
  Call_Attempt_Count: number;
  Last_Engagement_Status: string;
  Days_Since_Created: number;
  Answered_Call_Count: number;
  Activity_Count_7d: number;
  Days_Since_Last_Activity: number | null;
  Has_Contact_Activity?: boolean;
}
export interface AIModelResponse {
  model_version: string;
  api_contract_version: 'lead_scoring_3';
  score_type: 'public_dataset_model_score' | 'crm_conversion_probability';
  prediction_horizon_days: number | null;
  scoring_stage: 'initial' | 'post_contact';
  assessment_basis: 'profile_only' | 'response_pending' | 'profile_and_response' | 'crm_history';
  active_features: string[];
  probability: number;
  conversion_probability: number;
  probability_score: number;
  prediction: 'Converted' | 'Not Converted';
  recommendation: LeadAiRecommendation;
  explanation: { positive_factors: string[]; negative_factors: string[] };
  explanation_status?: string;
}

export function validLeadResponse(value: any): value is AIModelResponse {
  if (!value || value.api_contract_version !== 'lead_scoring_3') return false;
  const source = value.model_version === 'lead_staged_rf_3' && value.score_type === 'public_dataset_model_score' && value.prediction_horizon_days === null;
  const crm = value.model_version === 'lead_crm_snapshot_rf_1' && value.score_type === 'crm_conversion_probability' && value.prediction_horizon_days === 30;
  if (!source && !crm) return false;
  if (!['initial', 'post_contact'].includes(value.scoring_stage) || !Array.isArray(value.active_features)) return false;
  const profile = ['Source_Group', 'Occupation_Group', 'Goal_Group'];
  if (source) {
    const response = value.assessment_basis === 'profile_and_response';
    const expected = response ? [...profile, 'Engagement_Group'] : profile;
    if (!['profile_only', 'response_pending', 'profile_and_response'].includes(value.assessment_basis) ||
        expected.length !== value.active_features.length || expected.some(feature => !value.active_features.includes(feature))) return false;
    if (value.scoring_stage === 'initial' && value.assessment_basis !== 'profile_only') return false;
  } else if (value.scoring_stage !== 'post_contact' || value.assessment_basis !== 'crm_history') return false;
  const p = value.conversion_probability;
  if (!Number.isFinite(p) || p < 0 || p > 1 || value.probability !== p) return false;
  if (!Number.isFinite(value.probability_score) || Math.abs(value.probability_score - p * 100) > .005001) return false;
  if (value.prediction !== (p >= .5 ? 'Converted' : 'Not Converted')) return false;
  const recommendation = p >= .8 ? 'HOT_LEAD' : p >= .5 ? 'WARM_LEAD' : 'COLD_LEAD';
  if (value.recommendation !== recommendation) return false;
  return ['positive_factors', 'negative_factors'].every(key =>
    Array.isArray(value.explanation?.[key]) && value.explanation[key].every((item: unknown) => typeof item === 'string'));
}

export class LeadScoringApi {
  private readonly AI_URL = process.env.AI_LEAD_SCORING_URL || 'http://127.0.0.1:8000/explain-lead-v2';
  async fetchAiPrediction(payload: AIModelInput): Promise<AIModelResponse | null> {
    try {
      const response = await axios.post<unknown>(this.AI_URL, payload, { timeout: 10000 });
      if (!validLeadResponse(response.data)) throw new Error('Invalid or outdated lead AI response');
      if (payload.Has_Contact_Activity !== undefined && response.data.scoring_stage !== (payload.Has_Contact_Activity ? 'post_contact' : 'initial')) {
        throw new Error('AI scoring stage does not match observed contact history');
      }
      return response.data;
    } catch (error: any) {
      console.error('[LeadScoringApi]', error.message);
      // No synthetic zero: rule-based care remains available without a model.
      return null;
    }
  }
}
export const leadScoringApi = new LeadScoringApi();

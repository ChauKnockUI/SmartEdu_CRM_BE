import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ post: vi.fn(), readLead: vi.fn(), readHistory: vi.fn(), readLeads: vi.fn(),
  currentLead: vi.fn(), newest: vi.fn(), log: vi.fn(), upsert: vi.fn(), oldScore: vi.fn(), lock: vi.fn() }));
vi.mock('axios', () => ({ default: { post: mocks.post } }));
vi.mock('../src/database/tenant-context', () => ({ currentTenantId: () => 42 }));
vi.mock('../src/database/db', () => ({
  prisma: { lead: { findUnique: mocks.readLead, findMany: mocks.readLeads }, aIPrediction: { findMany: mocks.readHistory } },
  withTenantTx: async (fn: any) => fn({ $executeRaw: mocks.lock,
    lead: { findFirst: mocks.currentLead }, aIPrediction: { findFirst: mocks.newest, create: mocks.log },
    leadAiScore: { upsert: mocks.upsert, findUnique: mocks.oldScore } }),
}));
import { carePlan, snapshotOutcome, leadFingerprint, type LeadSnapshot } from '../src/services/ai/leadScoring.policy';
import { validLeadResponse } from '../src/services/ai/leadScoring.api';
import { leadScoringService } from '../src/services/ai/leadScoring.service';
import { leadScoringRepository } from '../src/services/ai/leadScoring.repository';

const now = new Date('2026-11-09T10:00:00Z');
const snapshot: LeadSnapshot = {
  snapshot_version: 'lead_snapshot_1', snapshot_at: now.toISOString(), lead_created_at: '2026-11-08T10:00:00Z',
  source_updated_at: '2026-11-08T10:00:00Z', lead_status: 'contacted', last_contact_at: '2026-11-09T08:00:00Z', outcome_window_days: 30,
  features: { Lead_Source: 'google_ads', Occupation: 'student_y3_y4', Study_Purpose: 'pass_exam', Course_Interested: 'ielts',
    Last_Engagement_Status: 'unknown', Call_Attempt_Count: 1, Days_Since_Created: 1,
    Answered_Call_Count: 0, Activity_Count_7d: 1, Days_Since_Last_Activity: 0 },
};
const response = { model_version: 'lead_staged_rf_3', api_contract_version: 'lead_scoring_3',
  scoring_stage: 'post_contact', assessment_basis: 'response_pending',
  active_features: ['Source_Group', 'Occupation_Group', 'Goal_Group'],
  score_type: 'public_dataset_model_score', prediction_horizon_days: null, conversion_probability: .7, probability: .7,
  probability_score: 70, prediction: 'Converted', recommendation: 'WARM_LEAD',
  explanation: { positive_factors: [], negative_factors: [] }, explanation_status: 'unavailable' };

describe('Lead conversion and early care are separate decisions', () => {
  it('prioritizes a low-probability lead for further consultation', () => {
    expect(carePlan(snapshot, .1, now)).toMatchObject({ priority: 'high', source: 'crm_rules' });
  });
  it('prioritizes an untouched lead even when AI is unavailable', () => {
    expect(carePlan({ ...snapshot, last_contact_at: null }, null, now)).toMatchObject({ priority: 'high' });
  });
  it('does not treat an internal update as contact and keeps overdue deadlines stable', () => {
    const old = { ...snapshot, last_contact_at: '2026-11-01T08:00:00Z' };
    expect(carePlan(old, .6, now).due_at).toBe(carePlan(old, .6, new Date('2026-11-10T10:00:00Z')).due_at);
    expect(carePlan(old, .6, now).priority).toBe('high');
  });
  it.each(['enrolled', 'lost'])('stops acquisition reminders for %s', status => {
    expect(carePlan({ ...snapshot, lead_status: status }, .05, now)).toMatchObject({ priority: 'none', due_at: null });
  });
  it('respects refusal and changes contact strategy after repeated unanswered calls', () => {
    expect(carePlan({ ...snapshot, features: { ...snapshot.features, Last_Engagement_Status: 'rejected' } }, .1, now).priority).toBe('low');
    expect(carePlan({ ...snapshot, features: { ...snapshot.features, Last_Engagement_Status: 'not_answering', Call_Attempt_Count: 4 } }, .1, now).priority).toBe('normal');
  });
});

describe('Snapshot outcomes wait for the full 30-day window', () => {
  it('does not call a recent non-converted lead negative', () => {
    expect(snapshotOutcome(snapshot, null, new Date('2026-11-20'))).toMatchObject({ converted_30d: null, outcome_status: 'pending' });
  });
  it('also waits for maturity for known early conversions', () => {
    expect(snapshotOutcome(snapshot, new Date('2026-11-15'), new Date('2026-11-20')).eligible_for_training).toBe(false);
  });
  it('labels conversion inside the horizon positive and a later conversion negative', () => {
    expect(snapshotOutcome(snapshot, new Date('2026-11-15'), new Date('2026-12-20')).converted_30d).toBe(1);
    expect(snapshotOutcome(snapshot, new Date('2026-12-15'), new Date('2026-12-20')).converted_30d).toBe(0);
  });
  it('excludes pre-existing students and enrollment without a conversion timestamp', () => {
    expect(snapshotOutcome(snapshot, new Date('2026-11-01'), new Date('2026-12-20')).outcome_status).toBe('excluded');
    expect(snapshotOutcome(snapshot, null, new Date('2026-12-20'), true).outcome_status).toBe('excluded');
  });
});

describe('Prediction contract, immutable snapshots and preservation on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const created = new Date(Date.now() - 2 * 86_400_000);
    const activityAt = new Date(Date.now() - 3_600_000);
    mocks.readLead.mockResolvedValue({ id: 1, full_name: 'Private name', status: 'contacted', student: null,
      createdAt: created, updatedAt: created, lead_source: 'google', occupation: null, study_purpose: 'improve',
      course: { name: 'IELTS 6.0' }, last_contacted: activityAt,
      activities: [{ type: 'note', engagement_status: null, createdAt: new Date() },
        { type: 'call', engagement_status: null, createdAt: activityAt }] });
    mocks.currentLead.mockImplementation(async () => {
      const lead = await mocks.readLead();
      return { ...lead, student: null };
    });
    mocks.newest.mockResolvedValue(null);
    mocks.log.mockResolvedValue({ id: 10 });
    mocks.post.mockResolvedValue({ data: response });
    mocks.upsert.mockResolvedValue({ probability_score: 70 });
    mocks.oldScore.mockResolvedValue({ probability_score: 55 });
  });
  it('accepts an explain-disabled model and rejects contradictory scores/horizons', () => {
    expect(validLeadResponse(response)).toBe(true);
    for (const override of [{ probability_score: 0 }, { prediction_horizon_days: 30 },
      { recommendation: 'HOT_LEAD' }, { probability: NaN }, { model_version: 'v2' }]) {
      expect(validLeadResponse({ ...response, ...override })).toBe(false);
    }
  });
  it('counts observed interactions, ignores notes, and retains unknown inputs', async () => {
    const record = await leadScoringRepository.readSnapshot(1);
    expect(record?.features).toMatchObject({ Occupation: 'unknown', Study_Purpose: 'improve',
      Last_Engagement_Status: 'unknown', Call_Attempt_Count: 1, Activity_Count_7d: 1, Has_Contact_Activity: true });
    expect(JSON.stringify(record)).not.toContain('Private name');
  });
  it('keeps an untouched lead in the initial stage despite internal notes', async () => {
    const lead = await mocks.readLead();
    mocks.readLead.mockResolvedValue({ ...lead, activities: [{ type: 'note', engagement_status: 'positive_interaction', createdAt: new Date() }] });
    const record = await leadScoringRepository.readSnapshot(1);
    expect(record?.features).toMatchObject({ Has_Contact_Activity: false, Call_Attempt_Count: 0, Last_Engagement_Status: 'unknown' });
  });
  it('recognizes an old email contact with no calls or recent activity', async () => {
    const lead = await mocks.readLead();
    mocks.readLead.mockResolvedValue({ ...lead, activities: [{ type: 'email', engagement_status: null, createdAt: new Date(Date.now() - 60 * 86_400_000) }] });
    const record = await leadScoringRepository.readSnapshot(1);
    expect(record?.features).toMatchObject({ Has_Contact_Activity: true, Call_Attempt_Count: 0, Activity_Count_7d: 0 });
  });
  it('rejects an AI response that uses an initial score for an already contacted lead', async () => {
    mocks.post.mockResolvedValue({ data: { ...response, scoring_stage: 'initial', assessment_basis: 'profile_only' } });
    const result = await leadScoringService.scoreLead(1);
    expect(result.model_status).toBe('unavailable');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('persists a scoring-time snapshot and score within the same transaction', async () => {
    const result = await leadScoringService.scoreLead(1);
    expect(result).toMatchObject({ success: true, model_status: 'scored' });
    expect(mocks.log.mock.calls[0][0].data.input_data).toMatchObject({ snapshot_version: 'lead_snapshot_1', outcome_window_days: 30 });
    expect(mocks.lock.mock.calls[0]).toContain('lead-score:42:1');
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });
  it('preserves the old score and records the snapshot when AI times out', async () => {
    mocks.post.mockRejectedValue(new Error('timeout'));
    const result = await leadScoringService.scoreLead(1);
    expect(result).toMatchObject({ success: true, model_status: 'unavailable', data: { probability_score: 55 } });
    expect(mocks.log).toHaveBeenCalledOnce();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('does not let an older response overwrite a newer assessment', async () => {
    mocks.newest.mockResolvedValue({ createdAt: new Date(Date.now() + 60_000) });
    expect(await leadScoringService.scoreLead(1)).toMatchObject({ model_status: 'superseded' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('does not overwrite a score after conversion during inference', async () => {
    mocks.currentLead.mockResolvedValue({ status: 'enrolled', updatedAt: new Date(), student: { id: 1 }, last_contacted: null });
    const result = await leadScoringService.scoreLead(1);
    expect(result.care?.priority).toBe('none');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('does not invalidate scoring solely because the lead was reassigned or notes changed', () => {
    const lead = { status: 'contacted', last_contacted: now, lead_source: 'google', occupation: 'student',
      study_purpose: 'pass_exam', course: { name: 'IELTS' }, assigned_to: 1, notes: 'old' };
    expect(leadFingerprint(lead)).toBe(leadFingerprint({ ...lead, assigned_to: 2, notes: 'new' } as typeof lead));
    expect(leadFingerprint(lead)).not.toBe(leadFingerprint({ ...lead, study_purpose: 'study_abroad' }));
  });
  it('does not fabricate a zero score when reading a lead without history', async () => {
    mocks.readHistory.mockResolvedValue([]);
    const lead = { id: 1, status: 'new', createdAt: new Date(), updatedAt: new Date(), last_contacted: null, aiScore: null };
    const [decorated] = await leadScoringRepository.decorateLeads([lead]);
    expect(decorated.aiScore).toBeNull();
    expect(decorated.aiAssessment.care.priority).toBe('high');
  });
  it('exports pending rows without inventing a negative training label', async () => {
    mocks.readHistory.mockResolvedValue([{ id: 10, reference_id: 1, input_data: { ...snapshot, snapshot_at: new Date().toISOString() } }]);
    mocks.readLeads.mockResolvedValue([{ id: 1, status: 'contacted', student: null }]);
    const data = await leadScoringRepository.exportDataset();
    expect(data.rows[0]).toMatchObject({ lead_key: '42:1', converted_30d: null, eligible_for_training: false });
  });
});

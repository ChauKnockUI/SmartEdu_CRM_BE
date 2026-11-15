import { Prisma, PredictionType } from '../../generated/prisma';
import { prisma, withTenantTx } from '../../database/db';
import { currentTenantId } from '../../database/tenant-context';
import { validLeadResponse, type AIModelResponse } from './leadScoring.api';
import { SNAPSHOT_VERSION, OUTCOME_DAYS, carePlan, leadFingerprint, snapshotOutcome, type LeadSnapshot } from './leadScoring.policy';

const DAY = 86_400_000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const normalized = (value: string | null | undefined) => value?.trim().toLowerCase() || 'unknown';

export class LeadScoringRepository {
  async readSnapshot(leadId: number): Promise<LeadSnapshot | null> {
    const cutoff = new Date();
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        course: { select: { name: true } }, student: { select: { id: true } },
        activities: { where: { createdAt: { lte: cutoff } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { type: true, engagement_status: true, createdAt: true } },
      },
    });
    if (!lead) return null;
    const now = new Date();
    const real = lead.activities.filter(a => ['call', 'email', 'sms', 'meeting'].includes(a.type));
    const calls = real.filter(a => a.type === 'call');
    const lastEngagement = real.find(a => a.engagement_status?.trim());
    const lastContact = real[0]?.createdAt || null;
    const statusAliases: Record<string, string> = { high: 'positive_interaction', medium: 'interested_need_time', low: 'busy_call_back' };
    const engagement = normalized(lastEngagement?.engagement_status);
    return {
      snapshot_version: SNAPSHOT_VERSION, snapshot_at: now.toISOString(),
      lead_created_at: lead.createdAt.toISOString(), source_updated_at: lead.updatedAt.toISOString(),
      source_fingerprint: leadFingerprint(lead),
      lead_status: lead.student ? 'enrolled' : lead.status,
      last_contact_at: lastContact?.toISOString() || null, outcome_window_days: OUTCOME_DAYS,
      features: {
        Lead_Source: normalized(lead.lead_source), Occupation: normalized(lead.occupation),
        Study_Purpose: normalized(lead.study_purpose), Course_Interested: normalized(lead.course?.name),
        Call_Attempt_Count: calls.length, Last_Engagement_Status: statusAliases[engagement] || engagement,
        Days_Since_Created: Math.max(0, Math.floor((now.getTime() - lead.createdAt.getTime()) / DAY)),
        Answered_Call_Count: calls.filter(a => ['positive_interaction', 'interested_need_time', 'busy_call_back', 'rejected', 'high', 'medium', 'low'].includes(a.engagement_status || '')).length,
        Activity_Count_7d: real.filter(a => now.getTime() - a.createdAt.getTime() <= 7 * DAY).length,
        Days_Since_Last_Activity: lastContact ? Math.max(0, Math.floor((now.getTime() - lastContact.getTime()) / DAY)) : null,
        Has_Contact_Activity: real.length > 0,
      },
    };
  }

  async persistAssessment(leadId: number, snapshot: LeadSnapshot, prediction: AIModelResponse | null) {
    return withTenantTx(async tx => {
      const tenantId = currentTenantId();
      // Serialize score updates for this lead, including simultaneous automatic/manual scoring.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead-score:${tenantId}:${leadId}`}))`;
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenant_id: tenantId }, select: {
        status: true, updatedAt: true, last_contacted: true, lead_source: true, occupation: true, study_purpose: true,
        course: { select: { name: true } }, student: { select: { id: true } },
      } });
      if (!lead) throw Object.assign(new Error('Lead không còn tồn tại.'), { statusCode: 404 });
      const newest = await tx.aIPrediction.findFirst({
        where: { tenant_id: tenantId, prediction_type: PredictionType.lead_score, reference_id: leadId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true },
      });
      const changed = snapshot.source_fingerprint ? leadFingerprint(lead) !== snapshot.source_fingerprint : lead.updatedAt > new Date(snapshot.source_updated_at);
      const superseded = (newest && newest.createdAt > new Date(snapshot.snapshot_at)) || changed;
      const status = lead.student ? 'enrolled' : lead.status;
      const closed = ['enrolled', 'lost'].includes(status);
      const modelStatus = closed ? 'not_eligible' : superseded ? 'superseded' : prediction ? 'scored' : 'unavailable';
      const probability = modelStatus === 'scored' ? prediction!.conversion_probability : null;
      const care = carePlan({ ...snapshot, lead_status: status }, probability);
      const result = { assessment_version: 'lead_assessment_1', model_status: modelStatus, model: prediction, care };
      await tx.aIPrediction.create({ data: {
        prediction_type: PredictionType.lead_score, reference_id: leadId,
        input_data: json(snapshot), result_data: json(result), createdAt: new Date(snapshot.snapshot_at),
      } });
      let score = null;
      if (modelStatus === 'scored') {
        const values = { probability_score: prediction!.probability_score, recommendation: prediction!.recommendation,
          positive_factors: prediction!.explanation.positive_factors, negative_factors: prediction!.explanation.negative_factors,
          scored_at: new Date(snapshot.snapshot_at) };
        score = await tx.leadAiScore.upsert({ where: { lead_id: leadId }, update: values, create: { lead_id: leadId, ...values } });
      } else {
        score = await tx.leadAiScore.findUnique({ where: { lead_id: leadId } });
      }
      return { ...result, aiScore: score };
    });
  }

  async decorateLeads<T extends { id: number; status: string; createdAt: Date; updatedAt: Date; last_contacted: Date | null;
    lead_source?: string | null; occupation?: string | null; study_purpose?: string | null; course?: { name: string } | null;
    aiScore: { probability_score: number; scored_at: Date } | null }>(leads: T[]) {
    if (!leads.length) return [];
    const history = await prisma.aIPrediction.findMany({
      where: { prediction_type: PredictionType.lead_score, reference_id: { in: leads.map(l => l.id) } },
      distinct: ['reference_id'], orderBy: [{ reference_id: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { reference_id: true, input_data: true, result_data: true },
    });
    const byLead = new Map(history.map(h => [h.reference_id, h]));
    return leads.map(lead => {
      const latest = byLead.get(lead.id);
      const input = latest?.input_data as unknown as LeadSnapshot | null;
      const result = latest?.result_data as any;
      const current = input?.snapshot_version === SNAPSHOT_VERSION && result?.assessment_version === 'lead_assessment_1';
      const stale = current && (input.source_fingerprint ? leadFingerprint(lead) !== input.source_fingerprint
        : lead.updatedAt > new Date(input.source_updated_at));
      const supported = current && validLeadResponse(result.model);
      const model = current && !stale && supported && result.model_status === 'scored' ? result.model : null;
      const probability = model?.conversion_probability ?? null;
      const fallback: LeadSnapshot = {
        snapshot_version: SNAPSHOT_VERSION, snapshot_at: lead.updatedAt.toISOString(),
        source_updated_at: lead.updatedAt.toISOString(), lead_created_at: lead.createdAt.toISOString(),
        lead_status: lead.status, last_contact_at: lead.last_contacted?.toISOString() || null, outcome_window_days: OUTCOME_DAYS,
        features: { Lead_Source: 'unknown', Occupation: 'unknown', Study_Purpose: 'unknown', Course_Interested: 'unknown',
          Last_Engagement_Status: 'unknown', Call_Attempt_Count: 0, Days_Since_Created: 0,
          Answered_Call_Count: 0, Activity_Count_7d: 0, Days_Since_Last_Activity: null },
      };
      const context = current ? { ...input, lead_status: lead.status,
        last_contact_at: lead.last_contacted && lead.last_contacted > new Date(input.snapshot_at)
          ? lead.last_contacted.toISOString() : input.last_contact_at } : fallback;
      return { ...lead, aiAssessment: {
        model_status: current ? stale ? 'stale' : result.model_status === 'scored' && !supported ? 'legacy' : result.model_status : lead.aiScore ? 'legacy' : 'pending',
        snapshot_at: current ? input.snapshot_at : null,
        features: context.features,
        scoring_stage: model?.scoring_stage || null,
        assessment_basis: model?.assessment_basis || null,
        active_features: model?.active_features || [],
        conversion_probability: probability,
        score_type: model?.score_type || null,
        prediction_horizon_days: model?.prediction_horizon_days ?? null,
        care: carePlan(context, probability),
      } };
    });
  }

  async exportDataset() {
    const asOf = new Date();
    const snapshots = await prisma.aIPrediction.findMany({
      where: { prediction_type: PredictionType.lead_score, input_data: { path: ['snapshot_version'], equals: SNAPSHOT_VERSION }, createdAt: { lte: asOf } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50_001,
    });
    if (snapshots.length > 50_000) throw Object.assign(new Error('Dữ liệu vượt 50.000 snapshot; cần xuất theo lô.'), { statusCode: 413 });
    const leads = await prisma.lead.findMany({
      where: { id: { in: [...new Set(snapshots.flatMap(s => s.reference_id === null ? [] : [s.reference_id]))] } },
      select: { id: true, status: true, student: { select: { createdAt: true } } },
    });
    const byId = new Map(leads.map(l => [l.id, l]));
    const rows = snapshots.flatMap(record => {
      const lead = byId.get(record.reference_id!);
      const snapshot = record.input_data as unknown as LeadSnapshot;
      if (!lead || ['enrolled', 'lost'].includes(snapshot.lead_status)) return [];
      const outcome = snapshotOutcome(snapshot, lead.student?.createdAt || null, asOf, lead.status === 'enrolled' && !lead.student);
      return [{ snapshot_id: record.id, lead_key: `${currentTenantId()}:${lead.id}`, snapshot_at: snapshot.snapshot_at,
        lead_created_at: snapshot.lead_created_at, outcome_window_days: snapshot.outcome_window_days,
        observed_until: asOf.toISOString(), ...snapshot.features, ...outcome }];
    });
    return { dataset_version: SNAPSHOT_VERSION, exported_at: asOf.toISOString(), outcome_definition: 'Student record created within 30 days after snapshot',
      total_snapshots: rows.length, eligible_snapshots: rows.filter(r => r.eligible_for_training).length, rows };
  }
}
export const leadScoringRepository = new LeadScoringRepository();

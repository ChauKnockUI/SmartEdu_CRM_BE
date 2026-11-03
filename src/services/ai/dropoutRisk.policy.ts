import type { DropoutRiskFeatures } from './dropoutRisk.api';

export const MAPPING_VERSION = 'crm_assessments_to_uci_2_early';
export const HYBRID_VERSION = 'hybrid_risk_1';
export const vietnamDay = (now: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
export const storedDay = (date: Date) => date.toISOString().slice(0, 10);

export function normalizeScore(score: number | null | undefined, maxScore: number | null) {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (maxScore !== null && (!Number.isFinite(maxScore) || maxScore <= 0)) return null;
  const value = maxScore === null ? score : score / maxScore * 10;
  return value >= 0 && value <= 10 ? value : null;
}

export function academicSnapshot(scores: Array<number | null>, completed: number, planned: number, passScore: number) {
  const observed = scores.filter((score): score is number => score !== null);
  const passed = observed.filter(score => score >= passScore);
  const features: DropoutRiskFeatures = {
    // UCI grade is an aggregate of approved units; use passed assessments as the CRM proxy.
    Average_Score: passed.length ? passed.reduce((sum, score) => sum + score, 0) / passed.length : null,
    Pass_Rate: scores.length ? passed.length / scores.length : 0,
    Not_Evaluated_Rate: scores.length ? (scores.length - observed.length) / scores.length : 0,
  };
  const progress = planned > 0 ? Math.min(completed / planned, 1) : 0;
  const eligible = observed.length > 0;
  const reason = eligible ? null : 'Chưa có điểm đánh giá hợp lệ; vẫn kiểm tra chuyên cần và học phí.';
  return { features, eligible, reason, progress, limited_data: observed.length < 2,
    assessed_items: scores.length, scored_assessments: observed.length };
}

export function attendanceRule(statuses: Array<string | null>) {
  let consecutive = 0;
  for (const status of [...statuses].reverse()) {
    if (status !== 'absent') break;
    consecutive++;
  }
  const recorded = statuses.filter(status => status !== null).length;
  const absent = statuses.filter(status => status === 'absent').length;
  const attended = statuses.filter(status => status === 'present' || status === 'late').length;
  const flagged = consecutive >= 2 || (absent >= 3 && recorded > 0 && absent / recorded >= 0.2);
  return { flagged, consecutive, absent, recorded, attended };
}

export type RiskLevel = 'low' | 'medium' | 'high';
export const hybridLevel = (score: number | null): RiskLevel | null => score === null ? null : score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

/** Initial business policy, not a calibrated dropout probability. */
export function combinedRisk(input: {
  academic: number | null;
  modelFlagged: boolean;
  attendance: ReturnType<typeof attendanceRule>;
  tuitionKnown: boolean;
  overdueDays: number;
}) {
  const { academic, modelFlagged, attendance, tuitionKnown, overdueDays } = input;
  if (academic !== null && (!Number.isFinite(academic) || academic < 0 || academic > 100)) throw new Error('Invalid academic score');
  if (!Number.isFinite(overdueDays) || overdueDays < 0) throw new Error('Invalid overdue days');
  const rate = attendance.recorded ? attendance.absent / attendance.recorded : 0;
  const attendanceScore = !attendance.recorded ? null
    : attendance.consecutive >= 3 || (attendance.absent >= 4 && rate >= 0.4) ? 100
    : attendance.flagged ? 75 : Math.min(35, rate * 100);
  const tuitionScore = !tuitionKnown ? null : overdueDays > 14 ? 90 : overdueDays > 7 ? 70 : overdueDays > 0 ? 50 : 0;
  const parts = [
    { key: 'academic', label: 'Học tập (AI)', score: academic, weight: 0.5 },
    { key: 'attendance', label: 'Chuyên cần', score: attendanceScore, weight: 0.3 },
    { key: 'tuition', label: 'Học phí', score: tuitionScore, weight: 0.2 },
  ];
  const availableWeight = parts.reduce((sum, part) => sum + (part.score !== null ? part.weight : 0), 0);
  const components = parts.map(part => ({ ...part,
    effective_weight: part.score === null ? 0 : part.weight / availableWeight,
    contribution: part.score === null ? null : part.score * part.weight / availableWeight,
  }));
  const base = availableWeight ? components.reduce((sum, part) => sum + (part.contribution || 0), 0) : null;
  const minimums = [
    { active: academic !== null && modelFlagged, score: 70, reason: 'AI học tập vượt ngưỡng theo dõi' },
    { active: attendance.flagged, score: 70, reason: 'Chuyên cần đạt mức cần liên hệ' },
    { active: tuitionScore !== null && tuitionScore > 0, score: overdueDays > 14 ? 70 : 40,
      reason: overdueDays > 14 ? 'Học phí quá hạn trên 14 ngày' : 'Học phí còn dư nợ đã quá hạn' },
  ].filter(item => item.active);
  const minimum = Math.max(0, ...minimums.map(item => item.score));
  const score = base === null ? null : Math.round(Math.max(base, minimum) * 10) / 10;
  return {
    version: HYBRID_VERSION, score_type: 'hybrid_risk_index' as const,
    score, level: hybridLevel(score), base_score: base === null ? null : Math.round(base * 10) / 10,
    minimum_score: minimum, minimum_reasons: minimums.map(item => item.reason), components,
    available_components: parts.filter(part => part.score !== null).length,
    missing_components: parts.filter(part => part.score === null).map(part => part.label),
  };
}

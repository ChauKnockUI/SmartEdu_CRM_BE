import type { DropoutRiskFeatures } from './dropoutRisk.api';

export const MAPPING_VERSION = 'crm_assessments_finance_to_uci_3';
export const HYBRID_VERSION = 'hybrid_risk_2';
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
  const features: Pick<DropoutRiskFeatures, 'Average_Score' | 'Pass_Rate' | 'Not_Evaluated_Rate'> = {
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

type TuitionInvoice = {
  id: number; status: string; due_date: Date | null; createdAt?: Date;
  total_amount: unknown; discount_amount: unknown;
  payments: Array<{ amount: unknown; paid_at?: Date | null }>;
};

/** CRM proxies: outstanding balance and whether all due payments are current. */
export function tuitionSnapshot(invoices: TuitionInvoice[], now: Date) {
  const today = vietnamDay(now);
  const observed = invoices.filter(invoice => !['cancelled', 'refunded'].includes(invoice.status)
    && (!invoice.createdAt || invoice.createdAt <= now));
  let valid = true;
  let debt = false;
  let undatedDebt = false;
  let overdueDays = 0;
  let paidLateDays = 0;
  const overdueIds: number[] = [];
  for (const invoice of observed) {
    const payments = invoice.payments.filter(payment => !payment.paid_at || payment.paid_at <= now);
    const amounts = [Number(invoice.total_amount), Number(invoice.discount_amount), ...payments.map(payment => Number(payment.amount))];
    if (amounts.some(amount => !Number.isFinite(amount) || amount < 0)) { valid = false; continue; }
    const remaining = amounts[0] - amounts[1] - amounts.slice(2).reduce((sum, amount) => sum + amount, 0);
    if (remaining > 0) {
      debt = true;
      if (!invoice.due_date) undatedDebt = true;
      else if (storedDay(invoice.due_date) < today) {
        overdueIds.push(invoice.id);
        overdueDays = Math.max(overdueDays, Math.round((Date.parse(today) - Date.parse(storedDay(invoice.due_date))) / 86_400_000));
      }
    }
    if (invoice.due_date) for (const payment of payments) {
      if (payment.paid_at) paidLateDays = Math.max(paidLateDays,
        Math.round((Date.parse(vietnamDay(payment.paid_at)) - Date.parse(storedDay(invoice.due_date))) / 86_400_000));
    }
  }
  const hasDebt: 0 | 1 | null = observed.length && valid ? (debt ? 1 : 0) : null;
  const upToDate: 0 | 1 | null = hasDebt === null ? null : overdueIds.length ? 0 : undatedDebt ? null : 1;
  return { features: { Has_Debt: hasDebt, Tuition_Up_To_Date: upToDate },
    known: hasDebt !== null && upToDate !== null, overdueDays, overdueIds, paidLateDays };
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
  modelScore: number | null;
  includesFinance?: boolean;
  modelFlagged: boolean;
  attendance: ReturnType<typeof attendanceRule>;
  tuitionKnown: boolean;
  overdueDays: number;
}) {
  const { modelScore, modelFlagged, attendance, tuitionKnown, overdueDays } = input;
  const includesFinance = modelScore !== null && input.includesFinance === true;
  if (modelScore !== null && (!Number.isFinite(modelScore) || modelScore < 0 || modelScore > 100)) throw new Error('Invalid model score');
  if (!Number.isFinite(overdueDays) || overdueDays < 0) throw new Error('Invalid overdue days');
  const rate = attendance.recorded ? attendance.absent / attendance.recorded : 0;
  const attendanceScore = !attendance.recorded ? null
    : attendance.consecutive >= 3 || (attendance.absent >= 4 && rate >= 0.4) ? 100
    : attendance.flagged ? 75 : Math.min(35, rate * 100);
  const tuitionScore = !tuitionKnown ? null : overdueDays > 14 ? 90 : overdueDays > 7 ? 70 : overdueDays > 0 ? 50 : 0;
  const parts = [
    { key: includesFinance ? 'model' : 'academic', label: includesFinance ? 'Học tập và học phí (AI)' : 'Học tập (AI)',
      score: modelScore, weight: includesFinance ? 0.7 : 0.5 },
    { key: 'attendance', label: 'Chuyên cần', score: attendanceScore, weight: 0.3 },
    ...(!includesFinance ? [{ key: 'tuition', label: 'Học phí', score: tuitionScore, weight: 0.2 }] : []),
  ];
  const availableWeight = parts.reduce((sum, part) => sum + (part.score !== null ? part.weight : 0), 0);
  const components = parts.map(part => ({ ...part,
    effective_weight: part.score === null ? 0 : part.weight / availableWeight,
    contribution: part.score === null ? null : part.score * part.weight / availableWeight,
  }));
  const base = availableWeight ? components.reduce((sum, part) => sum + (part.contribution || 0), 0) : null;
  const minimums = [
    { active: modelScore !== null && modelFlagged, score: 70,
      reason: includesFinance ? 'AI học tập và học phí vượt ngưỡng theo dõi' : 'AI học tập vượt ngưỡng theo dõi' },
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
    total_components: parts.length,
    missing_components: parts.filter(part => part.score === null).map(part => part.label),
  };
}

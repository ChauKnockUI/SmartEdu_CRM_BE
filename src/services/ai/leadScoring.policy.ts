import type { AIModelInput } from './leadScoring.api';
import { createHash } from 'crypto';

export const SNAPSHOT_VERSION = 'lead_snapshot_1';
export const CARE_POLICY_VERSION = 'lead_care_1';
export const OUTCOME_DAYS = 30;
const DAY = 86_400_000;
export interface LeadSnapshot {
  snapshot_version: typeof SNAPSHOT_VERSION;
  snapshot_at: string;
  lead_created_at: string;
  source_updated_at: string;
  source_fingerprint?: string;
  lead_status: string;
  last_contact_at: string | null;
  outcome_window_days: number;
  features: AIModelInput;
}

// Assignment, name and internal note edits must not invalidate an in-flight score.
export function leadFingerprint(lead: { status: string; last_contacted: Date | null;
  lead_source?: string | null; occupation?: string | null; study_purpose?: string | null; course?: { name: string } | null }) {
  const text = (value?: string | null) => value?.trim().toLowerCase() || 'unknown';
  return createHash('sha256').update(JSON.stringify({ source: text(lead.lead_source), occupation: text(lead.occupation),
    purpose: text(lead.study_purpose), course: text(lead.course?.name), status: lead.status,
    last_contact: lead.last_contacted?.toISOString() || null })).digest('hex');
}
export interface CarePlan {
  policy_version: string;
  source: 'crm_rules';
  priority: 'high' | 'normal' | 'low' | 'none';
  label: string;
  action: string;
  reasons: string[];
  due_at: string | null;
  evaluated_at: string;
}

/** Priority is a workflow rule, not an estimate of treatment benefit. */
export function carePlan(snapshot: LeadSnapshot, probability: number | null, now = new Date()): CarePlan {
  const status = snapshot.lead_status;
  const engagement = snapshot.features.Last_Engagement_Status;
  const contact = snapshot.last_contact_at ? new Date(snapshot.last_contact_at) : null;
  const staleDays = contact ? Math.max(0, (now.getTime() - contact.getTime()) / DAY) : null;
  const plan = (priority: CarePlan['priority'], action: string, reason: string, hours: number | null = 24): CarePlan => ({
    policy_version: CARE_POLICY_VERSION, source: 'crm_rules', priority,
    label: { high: 'Cần chăm sóc sớm', normal: 'Theo dõi', low: 'Chăm sóc định kỳ', none: 'Đã kết thúc' }[priority],
    action, reasons: [reason], due_at: hours === null ? null : new Date((contact?.getTime() || new Date(snapshot.lead_created_at).getTime()) + hours * 3_600_000).toISOString(),
    evaluated_at: now.toISOString(),
  });
  if (status === 'enrolled') return plan('none', 'Tiếp tục quy trình chăm sóc học viên.', 'Lead đã chuyển thành học viên.', null);
  if (status === 'lost') return plan('none', 'Chỉ liên hệ lại khi khách có nhu cầu hoặc đồng ý.', 'Lead đã kết thúc chăm sóc.', null);
  if (engagement === 'wrong_number') return plan('normal', 'Kiểm tra số điện thoại hoặc kênh liên hệ khác.', 'Thông tin liên hệ có thể chưa đúng.');
  if (engagement === 'rejected') return plan('low', 'Ghi nhận lý do và chỉ hẹn liên hệ lại khi khách đồng ý.', 'Khách đã từ chối; tránh gọi lặp lại.', null);
  if (engagement === 'busy_call_back') return plan('high', 'Gọi lại theo thời gian đã thống nhất với khách.', 'Khách đã hẹn gọi lại.');
  if (snapshot.features.Call_Attempt_Count >= 3 && engagement === 'not_answering') {
    return plan('normal', 'Đổi khung giờ hoặc gửi tin nhắn trước khi gọi lại.', 'Đã gọi nhiều lần nhưng chưa kết nối.');
  }
  if (!contact) return plan('high', 'Gọi điện để tìm hiểu nhu cầu và tư vấn bước đầu.', 'Chưa có lần liên hệ với khách được ghi nhận.', 4);
  if (staleDays !== null && staleDays >= 3) return plan('high', 'Liên hệ lại để cập nhật nhu cầu và khó khăn của khách.', 'Đã ít nhất 3 ngày chưa liên hệ.', 72);
  if (status === 'interested' || status === 'trial' || engagement === 'positive_interaction') {
    return plan('high', 'Xác nhận khóa phù hợp, học phí và lịch tư vấn hoặc học thử.', 'Khách đang có tương tác hoặc nhu cầu rõ ràng.');
  }
  if (probability !== null && probability >= .8) return plan('high', 'Chủ động tư vấn lịch học và hướng dẫn đăng ký.', 'Điểm chuyển đổi đang cao.', 4);
  if (probability !== null && probability < .3) return plan('high', 'Tìm hiểu trở ngại và tư vấn lại khóa học phù hợp.', 'Điểm chuyển đổi thấp; cần bổ sung tư vấn thay vì bỏ qua lead.');
  return plan('normal', 'Gửi thông tin phù hợp và thống nhất lần liên hệ tiếp theo.',
    probability === null ? 'Chưa có điểm AI mới; tiếp tục chăm sóc theo dữ liệu CRM.' : 'Tiếp tục theo dõi phản hồi của khách.');
}

export function snapshotOutcome(snapshot: LeadSnapshot, convertedAt: Date | null, asOf: Date, enrolledWithoutDate = false) {
  const start = new Date(snapshot.snapshot_at);
  const end = new Date(start.getTime() + snapshot.outcome_window_days * DAY);
  if (enrolledWithoutDate || (convertedAt && convertedAt <= start)) {
    return { outcome_status: 'excluded', converted_30d: null, eligible_for_training: false };
  }
  // Wait for the full horizon for positives as well as negatives to avoid
  // over-representing early conversions in the training cohort.
  if (asOf < end) return { outcome_status: 'pending', converted_30d: null, eligible_for_training: false };
  return { outcome_status: 'observed', converted_30d: convertedAt && convertedAt <= end ? 1 : 0, eligible_for_training: true };
}

import type { LeadStatus, LeadActivityType, Prisma } from '../generated/prisma';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
    new: 'Mới tiếp nhận', contacted: 'Đã liên hệ', interested: 'Quan tâm', trial: 'Học thử', enrolled: 'Đã đăng ký', lost: 'Thất bại',
};
export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
    new: '#1677ff', contacted: '#13c2c2', interested: '#faad14', trial: '#722ed1', enrolled: '#52c41a', lost: '#f5222d',
};
export const LEAD_ACTIVITY_LABELS: Record<LeadActivityType, string> = {
    call: 'Gọi điện', email: 'Email', sms: 'SMS', meeting: 'Tư vấn trực tiếp', note: 'Ghi chú', status_change: 'Cập nhật giai đoạn',
};

export const LEAD_CARE_STATUSES: LeadStatus[] = ['contacted', 'interested', 'trial'];
export const LEAD_ACTIVE_STATUSES: LeadStatus[] = ['new', ...LEAD_CARE_STATUSES];
export const leadCareCutoff = (now = new Date()) => new Date(now.getTime() - 3 * 86_400_000);
export const leadNeedsCareWhere = (now = new Date()): Prisma.LeadWhereInput => ({
    status: { in: LEAD_ACTIVE_STATUSES },
    OR: [{ last_contacted: null }, { last_contacted: { lt: leadCareCutoff(now) } }],
});
export const LEAD_ASSIGNMENT_REQUIRED = 'Vui lòng phân công Sale phụ trách trước khi tiếp tục chăm sóc Lead.';
export const LEAD_CHANGED = 'Trạng thái hoặc người phụ trách Lead vừa thay đổi. Vui lòng tải lại và thử lại.';

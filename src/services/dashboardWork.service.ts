import { Prisma } from '../generated/prisma';
import { prisma } from '../database/db';
import { invoiceService } from './invoice.service';
import { LEAD_ACTIVE_STATUSES, leadNeedsCareWhere } from '../constants/leadWorkflow';
import { studentReadScope, scheduleReadScope, type AcademicActor } from '../utils/academicAccess';
import { sessionChangeInfo } from '../utils/sessionChanges';
import { scheduleMoment } from '../utils/classScheduling';
import { overdueAttendanceWhere } from '../utils/scheduleNotifications';

type WorkItem = { id: string; title: string; reason: string; since: Date | null; since_label: string;
    action: string; action_label: string; waiting_days?: number; amount?: number };
type Group = { key: string; label: string; description: string; count: () => Promise<number>;
    items: (skip: number, limit: number) => Promise<WorkItem[]> };
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const daysWaiting = (since: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86400000));

export class DashboardWorkService {
    async getWork(actor: AcademicActor, query: { category?: string; page?: number; limit?: number; view?: 'summary' | 'list' } = {}) {
        if (!['admin', 'sale', 'teacher', 'student'].includes(actor.role)) throw fail('Không có quyền xem công việc.', 403);
        const { category, page = 1, limit = 5, view } = query;
        if (view && !['summary', 'list'].includes(view)) throw fail('Chế độ xem công việc không hợp lệ.');
        if (!Number.isInteger(page) || page < 1 || page > 2147483647 || !Number.isInteger(limit) || limit < 1 || limit > 20)
            throw fail('Phân trang công việc không hợp lệ.');
        const now = new Date();
        const groups: Group[] = [];
        const leadScope: Prisma.LeadWhereInput = actor.role === 'sale' ? { assigned_to: actor.userId } : {};

        const leadGroup = (key: string, label: string, where: Prisma.LeadWhereInput, care = false): Group => ({
            key, label, description: care ? 'Lead đang mở, chưa liên hệ hoặc đã quá 3 ngày chưa liên hệ.'
                : key === 'new_leads' ? 'Lead có trạng thái Mới đang được phân công cho bạn, cần mở hồ sơ để tiếp nhận.'
                : 'Lead đang mở chưa được phân công Sale phụ trách.',
            count: () => prisma.lead.count({ where }),
            items: async (skip, take) => (await prisma.lead.findMany({ where, skip, take,
                orderBy: care ? [{ last_contacted: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { id: true, full_name: true, createdAt: true, last_contacted: true },
            })).map(item => ({ id: `lead:${item.id}`, title: item.full_name,
                reason: care ? item.last_contacted ? 'Đã quá 3 ngày chưa liên hệ' : 'Chưa ghi nhận liên hệ'
                    : key === 'new_leads' ? 'Trạng thái hiện tại: Mới' : 'Chưa có Sale phụ trách',
                since: care ? item.last_contacted ?? item.createdAt : item.createdAt,
                since_label: care && item.last_contacted ? 'Liên hệ gần nhất' : 'Tiếp nhận',
                waiting_days: daysWaiting(care ? item.last_contacted ?? item.createdAt : item.createdAt, now),
                action: `/crm/leads/${item.id}${care ? '?contact=1' : ''}`,
                action_label: care ? 'Chăm sóc Lead' : key === 'new_leads' ? 'Tiếp nhận Lead' : 'Phân công Sale',
            })),
        });

        let debts: ReturnType<typeof invoiceService.getDebts> | undefined;
        const getDebts = () => debts ??= invoiceService.getDebts(actor);
        const debtGroup = (overdue: boolean): Group => {
            const rows = async () => (await getDebts()).filter(item => (item.collection_status === 'overdue') === overdue);
            return { key: overdue ? 'overdue_payments' : 'unpaid', label: overdue ? 'Học phí quá hạn' : 'Khoản chưa thanh toán',
                description: overdue ? 'Khoản còn phải thu đã quá hạn theo ngày Việt Nam.' : 'Khoản còn phải thu chưa quá hạn, gồm cả thanh toán một phần.',
                count: async () => (await rows()).length,
                items: async (skip, take) => (await rows()).slice(skip, skip + take).map(item => ({
                    id: `invoice:${item.invoice_id}`, title: actor.role === 'student' ? item.invoice_no : `${item.student.full_name} · ${item.invoice_no}`,
                    reason: overdue ? `Quá hạn ${item.days_overdue} ngày${item.class ? ` · ${item.class.name}` : ''}` : `Còn số dư cần thanh toán${item.class ? ` · ${item.class.name}` : ''}`,
                    since: item.due_date, since_label: 'Hạn thu', amount: item.debt_amount,
                    action: actor.role === 'student' ? '/lms/my-profile?tab=finance' : `/finance/payments?invoice_id=${item.invoice_id}`,
                    action_label: actor.role === 'student' ? 'Xem học phí' : 'Xem khoản thu',
                })),
            };
        };

        if (actor.role !== 'teacher') groups.push(debtGroup(true));
        if (actor.role === 'admin' || actor.role === 'teacher') {
            const where = overdueAttendanceWhere(now, actor.role === 'teacher' ? actor.userId : undefined);
            groups.push({ key: 'attendance', label: 'Buổi thiếu điểm danh', description: 'Buổi đã kết thúc, có học viên và giáo viên phụ trách, chưa ghi nhận điểm danh.',
                count: () => prisma.schedule.count({ where }),
                items: async (skip, take) => (await prisma.schedule.findMany({ where, skip, take,
                    orderBy: [{ date: 'asc' }, { end_time: 'asc' }, { id: 'asc' }], select: { id: true, date: true, start_time: true, end_time: true,
                        class: { select: { name: true } }, teacher: { select: { full_name: true } } },
                })).map(item => ({ id: `schedule:${item.id}`, title: item.class?.name || 'Buổi học',
                    reason: `Chưa có điểm danh${item.teacher ? ` · ${item.teacher.full_name}` : ''}`,
                    since: scheduleMoment(item.date, item.end_time), since_label: 'Buổi kết thúc',
                    waiting_days: daysWaiting(scheduleMoment(item.date, item.end_time), now),
                    action: `/lms/sessions/${item.id}`, action_label: actor.role === 'teacher' ? 'Mở điểm danh' : 'Kiểm tra buổi học',
                })),
            });
        }
        if (actor.role !== 'sale') {
            const pending = async () => (await prisma.schedule.findMany({ where: {
                status: 'cancelled', memo: { not: null }, attendances: { none: {} },
                AND: [{ class: { status: { not: 'cancelled' } } }, actor.role === 'teacher' ? { teacher: { user_id: actor.userId } } : scheduleReadScope(actor)],
            }, select: { id: true, date: true, memo: true, class: { select: { name: true, status: true } } },
            })).filter(item => sessionChangeInfo(item.memo, 'cancelled', item.class?.status).pendingMakeup)
                .map(item => {
                    const history = sessionChangeInfo(item.memo, 'cancelled').history;
                    const entry = history[history.length - 1];
                    const stamp = new Date(entry.at);
                    const since = Number.isFinite(stamp.getTime()) ? stamp : null;
                    return { id: `schedule:${item.id}`, title: item.class?.name || 'Buổi học', reason: `Đã báo nghỉ, chưa xếp học bù · ${entry.reason}`,
                        since, since_label: 'Báo nghỉ', ...(since ? { waiting_days: daysWaiting(since, now) } : {}),
                        action: `/lms/sessions/${item.id}`, action_label: actor.role === 'student' ? 'Xem buổi nghỉ' : 'Xếp lịch học bù' };
                }).sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0) || a.id.localeCompare(b.id));
            let pendingRows: ReturnType<typeof pending> | undefined;
            const rows = () => pendingRows ??= pending();
            groups.push({ key: 'makeup', label: 'Chờ xếp học bù', description: 'Buổi đã báo nghỉ và chưa có lịch học bù; không tính lớp đã hủy.',
                count: async () => (await rows()).length, items: async (skip, take) => (await rows()).slice(skip, skip + take) });
        }
        if (actor.role === 'admin' || actor.role === 'sale') {
            if (actor.role === 'admin') groups.push(leadGroup('unassigned_leads', 'Lead chưa phân công', { assigned_to: null, status: { in: LEAD_ACTIVE_STATUSES } }));
            if (actor.role === 'sale') groups.push(leadGroup('new_leads', 'Lead mới cần tiếp nhận', { assigned_to: actor.userId, status: 'new' }));
            groups.push(leadGroup('lead_care', 'Lead cần chăm sóc', { AND: [leadScope, leadNeedsCareWhere(now)] }, true));
            const where: Prisma.StudentWhereInput = { AND: [studentReadScope(actor)], status: 'active', classEnrollments: {
                none: { status: 'active', class: { status: { in: ['upcoming', 'ongoing'] } } },
            } };
            groups.push({ key: 'waiting_students', label: 'Học viên chưa có lớp', description: 'Hồ sơ đang học nhưng chưa có ghi danh ở lớp sắp mở/đang học; cần xếp lớp hoặc kiểm tra lại tình trạng.',
                count: () => prisma.student.count({ where }),
                items: async (skip, take) => (await prisma.student.findMany({ where, skip, take, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    select: { id: true, full_name: true, createdAt: true },
                })).map(item => ({ id: `student:${item.id}`, title: item.full_name,
                    reason: actor.role === 'sale' ? 'Chờ Admin xếp lớp hoặc cập nhật tình trạng học viên' : 'Chưa có lớp sắp mở/đang học',
                    since: item.createdAt, since_label: 'Hồ sơ tạo', action: `/lms/students/${item.id}?tab=classes`,
                    action_label: actor.role === 'sale' ? 'Xem hồ sơ' : 'Xem / Xếp lớp',
                })),
            });
        }
        if (actor.role === 'admin') for (const field of ['teacher_id', 'room_id'] as const) {
            const teacher = field === 'teacher_id';
            const where: Prisma.ClassWhereInput = { status: { in: ['upcoming', 'ongoing'] }, [field]: null };
            groups.push({ key: teacher ? 'missing_teacher' : 'missing_room', label: teacher ? 'Lớp thiếu giáo viên' : 'Lớp thiếu phòng',
                description: 'Lớp sắp mở/đang học chưa được phân công đầy đủ.', count: () => prisma.class.count({ where }),
                items: async (skip, take) => (await prisma.class.findMany({ where, skip, take, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    select: { id: true, name: true, createdAt: true },
                })).map(item => ({ id: `class:${item.id}`, title: item.name, reason: teacher ? 'Chưa phân công giáo viên' : 'Chưa phân công phòng học',
                    since: item.createdAt, since_label: 'Lớp tạo', action: `/lms/scheduling?class_id=${item.id}`,
                    action_label: 'Phân công',
                })),
            });
        }
        if (actor.role !== 'teacher') groups.push(debtGroup(false));
        if (category && !groups.some(group => group.key === category)) throw fail('Nhóm công việc không thuộc phạm vi được xem.', 403);
        const counts = await Promise.all(groups.map(group => group.count()));
        const selected = category ? groups.findIndex(group => group.key === category) : Math.max(0, counts.findIndex(count => count > 0));
        const group = groups[selected];
        let total = counts[selected];
        const currentPage = view ? 1 : Math.min(page, Math.max(1, Math.ceil(total / limit)));
        const items = total && view !== 'summary' ? await group.items(view === 'list' ? 0 : (currentPage - 1) * limit,
            view === 'list' ? total : limit) : [];
        if (view === 'list') { total = items.length; counts[selected] = total; }
        const resultLimit = view === 'list' ? Math.max(1, total) : limit;
        return { as_of: now, role: actor.role, category: group.key, groups: groups.map((item, index) => ({
            key: item.key, label: item.label, description: item.description, total: counts[index],
        })), items, pagination: { page: currentPage, limit: resultLimit, total, totalPages: Math.ceil(total / resultLimit) } };
    }
}

export const dashboardWorkService = new DashboardWorkService();

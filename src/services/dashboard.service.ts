import { Prisma } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { currentTenantId } from '../database/tenant-context';
import { invoiceService } from './invoice.service';

type Role = 'admin' | 'sale' | 'teacher' | 'student';
type AlertType = 'info' | 'warning' | 'error';

const toNumber = (value: Prisma.Decimal | number | null | undefined) => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const monthLabel = (date: Date) => `T${date.getMonth() + 1}/${date.getFullYear()}`;

/** `count` tháng gần nhất, tháng hiện tại ở cuối; mốc theo giờ địa phương của server như trước. */
const lastMonths = (now: Date, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1), month: monthLabel(start) };
  });

interface ActivityView {
  id: number;
  type: string;
  content: string | null;
  createdAt: Date;
  user: { full_name: string } | null;
  lead: { full_name: string };
}

interface AdminOverviewRow {
  new_leads: number;
  total_leads: number;
  converted_leads: number;
  stale_leads: number;
  active_students: number;
  high_risk_students: number;
  full_classes: number;
  debts: number;
  /** Doanh thu từng tháng, cùng thứ tự với `lastMonths`. */
  revenue: number[];
  sources: { lead_source: string | null; value: number }[];
  activities: (Omit<ActivityView, 'createdAt'> & { createdAt: string })[];
}

const activityInclude = {
  user: { select: { full_name: true } },
  lead: { select: { full_name: true } },
} satisfies Prisma.LeadActivityInclude;

const mapActivity = (activity: ActivityView) => ({
  id: String(activity.id),
  actor: activity.user?.full_name || 'System',
  text: `${activity.type} lead ${activity.lead.full_name}${activity.content ? ` - ${activity.content}` : ''}`,
  time: activity.createdAt,
});

const emptyOverview = (role: Role) => ({
  role,
  kpis: {},
  charts: {},
  alerts: [],
  activities: [],
  lists: {},
});

class DashboardService {
  async getOverview(userId: number, role: Role) {
    switch (role) {
      case 'admin':
        return this.getAdminOverview();
      case 'sale':
        return this.getSaleOverview(userId);
      case 'teacher':
        return this.getTeacherOverview(userId);
      case 'student':
        return this.getStudentOverview(userId);
      default:
        return emptyOverview(role);
    }
  }

  /**
   * Cả trang trong MỘT câu SQL, chạy trong transaction gắn tenant. Mỗi truy vấn đi qua `prisma` tự bọc
   * BEGIN + set_config + COMMIT (mỗi câu là một lượt đi về DB), nên ~17 truy vấn riêng lẻ (74 câu SQL)
   * được gộp lại. Điều kiện `tenant_id` viết rõ để planner dùng index; RLS vẫn là lớp bảo vệ chính.
   */
  private async getAdminOverview() {
    const now = new Date();
    const months = lastMonths(now, 6);
    const thisMonth = months[months.length - 1];
    const staleBefore = addDays(now, -3);
    const tenantId = currentTenantId();

    const monthSums = months.map(
      (m, i) => Prisma.sql`COALESCE(sum(amount) FILTER (WHERE paid_at >= ${m.start} AND paid_at < ${m.end}), 0) AS ${Prisma.raw(`m${i}`)}`
    );
    const monthColumns = Prisma.join(months.map((_, i) => Prisma.raw(`m${i}`)));

    const row = await withTenantTx(
      async (tx) => {
        const [row] = await tx.$queryRaw<AdminOverviewRow[]>`
          WITH rev AS (
            SELECT ${Prisma.join(monthSums)} FROM payment_transactions
            WHERE tenant_id = ${tenantId} AND paid_at >= ${months[0].start} AND paid_at < ${thisMonth.end}
          )
          SELECT
            (SELECT count(*) FROM leads WHERE tenant_id = ${tenantId} AND status = 'new'
               AND "createdAt" >= ${thisMonth.start} AND "createdAt" < ${thisMonth.end})::int AS new_leads,
            (SELECT count(*) FROM leads WHERE tenant_id = ${tenantId})::int AS total_leads,
            (SELECT count(*) FROM leads WHERE tenant_id = ${tenantId} AND status = 'enrolled')::int AS converted_leads,
            (SELECT count(*) FROM leads WHERE tenant_id = ${tenantId}
               AND status IN ('new', 'contacted', 'interested', 'trial')
               AND (last_contacted IS NULL OR last_contacted < ${staleBefore}))::int AS stale_leads,
            (SELECT count(*) FROM students WHERE tenant_id = ${tenantId} AND status = 'active')::int AS active_students,
            (SELECT count(*) FROM students WHERE tenant_id = ${tenantId} AND dropout_risk_level = 'high')::int AS high_risk_students,
            (SELECT count(*) FROM classes c
               WHERE c.tenant_id = ${tenantId} AND c.max_students > 0 AND c.status IN ('ongoing', 'upcoming')
                 AND (SELECT count(*) FROM class_enrollments e WHERE e.class_id = c.id AND e.status = 'active')
                     >= 0.8 * c.max_students)::int AS full_classes,
            (SELECT count(*) FROM invoices i
               WHERE i.tenant_id = ${tenantId} AND i.status IN ('pending', 'partial', 'overdue')
                 AND GREATEST(COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0), 0)
                     - COALESCE((SELECT sum(p.amount) FROM payment_transactions p WHERE p.invoice_id = i.id), 0) > 0
            )::int AS debts,
            (SELECT json_build_array(${monthColumns}) FROM rev) AS revenue,
            (SELECT COALESCE(json_agg(json_build_object('lead_source', g.lead_source, 'value', g.value) ORDER BY g.named DESC), '[]'::json)
               FROM (SELECT lead_source, count(*)::int AS value, count(lead_source) AS named
                     FROM leads WHERE tenant_id = ${tenantId} GROUP BY lead_source) g) AS sources,
            (SELECT COALESCE(json_agg(json_build_object(
                      'id', a.id, 'type', a.type, 'content', a.content, 'createdAt', a."createdAt",
                      'user', CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('full_name', u.full_name) END,
                      'lead', json_build_object('full_name', l.full_name)
                    ) ORDER BY a."createdAt" DESC), '[]'::json)
               FROM (SELECT id, type, content, "createdAt", user_id, lead_id FROM lead_activities
                     WHERE tenant_id = ${tenantId} ORDER BY "createdAt" DESC LIMIT 5) a
               JOIN leads l ON l.id = a.lead_id
               LEFT JOIN users u ON u.id = a.user_id) AS activities`;
        return row;
      },
      // Chờ được kết nối lâu hơn mặc định 2s khi FE bắn nhiều request cùng lúc lúc tải trang.
      { maxWait: 10_000, timeout: 15_000 }
    );

    const revenueLast6Months = months.map((m, i) => ({ month: m.month, revenue: toNumber(row.revenue[i]) }));

    return {
      role: 'admin' as const,
      kpis: {
        newLeads: row.new_leads,
        conversionRate: row.total_leads ? Number(((row.converted_leads / row.total_leads) * 100).toFixed(1)) : 0,
        activeStudents: row.active_students,
        monthRevenue: revenueLast6Months[revenueLast6Months.length - 1].revenue,
      },
      charts: {
        revenueLast6Months,
        leadSources: row.sources.map((s) => ({ name: s.lead_source || 'Khác', value: s.value })),
      },
      alerts: [
        { id: 'risk-students', type: 'warning' as AlertType, title: `${row.high_risk_students} học viên có nguy cơ nghỉ học cao`, action: '/ai/predictions' },
        { id: 'debts', type: 'error' as AlertType, title: `${row.debts} học phí quá hạn/chưa thu`, action: '/finance/debts' },
        { id: 'full-classes', type: 'info' as AlertType, title: `${row.full_classes} lớp sắp đầy (>80% sĩ số)`, action: '/lms/classes' },
        { id: 'stale-leads', type: 'warning' as AlertType, title: `${row.stale_leads} leads chưa follow-up >3 ngày`, action: '/crm/leads' },
      ],
      activities: row.activities.map((a) => mapActivity({ ...a, createdAt: new Date(a.createdAt) })),
      lists: {},
    };
  }

  private async getSaleOverview(userId: number) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [myLeads, converted, followUpToday, debts, activities] = await Promise.all([
      prisma.lead.findMany({
        where: { assigned_to: userId },
        include: { aiScore: true },
        orderBy: [{ aiScore: { probability_score: 'desc' } }, { createdAt: 'desc' }],
        take: 20,
      }),
      prisma.lead.count({
        where: { assigned_to: userId, status: 'enrolled', updatedAt: { gte: monthStart, lt: nextMonthStart } },
      }),
      prisma.lead.count({
        where: {
          assigned_to: userId,
          status: { in: ['new', 'contacted', 'interested', 'trial'] },
          OR: [
            { last_contacted: { gte: todayStart, lte: todayEnd } },
            { last_contacted: null },
            { last_contacted: { lt: addDays(now, -3) } },
          ],
        },
      }),
      invoiceService.getDebts(),
      this.getRecentActivities(userId),
    ]);

    const totalDebt = debts.reduce((sum, item: any) => sum + (item.debt_amount || 0), 0);
    const priorityLeads = myLeads.slice(0, 5).map((lead) => ({
      id: lead.id,
      name: lead.full_name,
      phone: lead.phone,
      source: lead.lead_source,
      score: Math.round((lead.aiScore?.probability_score || 0) * 100),
    }));

    return {
      role: 'sale' as const,
      kpis: {
        myLeads: myLeads.length,
        followUpToday,
        conversionRate: myLeads.length ? Number(((converted / myLeads.length) * 100).toFixed(1)) : 0,
        debtToCollect: totalDebt,
      },
      charts: {},
      alerts: [],
      activities,
      lists: {
        priorityLeads,
        followUps: priorityLeads.map((lead) => ({
          id: lead.id,
          time: lead.score >= 80 ? '09:30' : '14:00',
          title: `Follow-up ${lead.name}${lead.score ? ` (Score ${lead.score})` : ''}`,
        })),
        paymentIssues: debts.slice(0, 5).map((item: any) => ({
          id: item.invoice_id,
          name: item.student?.full_name,
          amount: item.debt_amount,
          overdue: item.status === 'overdue' && item.due_date ? Math.max(0, Math.ceil((now.getTime() - new Date(item.due_date).getTime()) / 86400000)) : 0,
        })),
        upsell: [],
      },
    };
  }

  private async getTeacherOverview(userId: number) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekEnd = addDays(todayStart, 7);

    const teacher = await prisma.teacher.findUnique({ where: { user_id: userId } });
    if (!teacher) return emptyOverview('teacher');

    const [classes, todaySchedules, weekSchedules, attendances, attentionStudents, materials] = await Promise.all([
      prisma.class.findMany({
        where: { teacher_id: teacher.id, status: { in: ['ongoing', 'upcoming'] } },
        include: { classEnrollments: { where: { status: 'active' } } },
      }),
      prisma.schedule.findMany({
        where: { teacher_id: teacher.id, date: { gte: todayStart, lte: todayEnd } },
        include: { class: true, room: true, attendances: true },
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      }),
      prisma.schedule.findMany({
        where: { teacher_id: teacher.id, date: { gte: todayStart, lt: weekEnd } },
        include: { class: true, room: true },
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      }),
      prisma.attendance.findMany({
        where: { schedule: { teacher_id: teacher.id } },
        select: { status: true },
      }),
      prisma.student.findMany({
        where: {
          classEnrollments: { some: { class: { teacher_id: teacher.id }, status: 'active' } },
          OR: [{ dropout_risk_level: 'high' }, { dropout_risk_level: 'medium' }],
        },
        orderBy: [{ dropout_risk: 'desc' }, { updatedAt: 'desc' }],
        take: 6,
      }),
      prisma.class_materials.findMany({
        where: { classes: { teacher_id: teacher.id } },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
    ]);

    const studentIds = new Set(classes.flatMap((item) => item.classEnrollments.map((enrollment) => enrollment.student_id)));
    const presentCount = attendances.filter((item) => item.status === 'present' || item.status === 'late').length;
    const attendanceRate = attendances.length ? Number(((presentCount / attendances.length) * 100).toFixed(1)) : 0;

    return {
      role: 'teacher' as const,
      kpis: {
        activeClasses: classes.length,
        students: studentIds.size,
        sessionsThisWeek: weekSchedules.length,
        attendanceRate,
      },
      charts: {},
      alerts: [],
      activities: [],
      lists: {
        todayClasses: todaySchedules.map((schedule) => this.mapSchedule(schedule)),
        upcomingSessions: weekSchedules.map((schedule) => this.mapSchedule(schedule)),
        attentionStudents: attentionStudents.map((student) => ({
          id: student.id,
          name: student.full_name,
          issue: student.dropout_risk_level ? `Churn risk: ${Math.round((student.dropout_risk || 0) * 100)}%` : 'Cần theo dõi tiến độ',
          severity: student.dropout_risk_level || 'low',
        })),
        materials: materials.map((item) => ({
          id: item.id,
          title: item.title,
          date: item.created_at,
        })),
      },
    };
  }

  private async getStudentOverview(userId: number) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekEnd = addDays(todayStart, 7);

    const student = await prisma.student.findUnique({ where: { user_id: userId } });
    if (!student) return emptyOverview('student');

    const [schedules, attendances, missingAssignments, invoices, materials] = await Promise.all([
      prisma.schedule.findMany({
        where: {
          date: { gte: todayStart, lt: weekEnd },
          class: { classEnrollments: { some: { student_id: student.id, status: 'active' } } },
        },
        include: { class: true, room: true },
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      }),
      prisma.attendance.findMany({
        where: { student_id: student.id },
        select: { status: true },
      }),
      prisma.assignmentSubmission.count({ where: { student_id: student.id, status: { in: ['missing', 'late'] } } }),
      prisma.invoice.findMany({
        where: { student_id: student.id },
        include: { payments: true, class: true },
        orderBy: [{ due_date: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      prisma.class_materials.findMany({
        where: { classes: { classEnrollments: { some: { student_id: student.id, status: 'active' } } } },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
    ]);

    const attended = attendances.filter((item) => item.status === 'present' || item.status === 'late').length;
    const absent = attendances.filter((item) => item.status === 'absent').length;
    const attendanceRate = attendances.length ? Number(((attended / attendances.length) * 100).toFixed(1)) : 0;

    return {
      role: 'student' as const,
      kpis: {
        attendanceRate,
        attendedSessions: attended,
        absentSessions: absent,
        missingAssignments,
      },
      charts: {},
      alerts: [],
      activities: [],
      lists: {
        nextClass: schedules[0] ? this.mapSchedule(schedules[0]) : null,
        weekSchedule: schedules.map((schedule) => this.mapSchedule(schedule)),
        progress: {
          courseCompletion: attendances.length ? Math.min(100, Math.round((attendances.length / 50) * 100)) : 0,
          attended,
          totalTarget: 50,
        },
        invoices: invoices.map((invoice) => {
          const paid = invoice.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
          const total = toNumber(invoice.total_amount) - toNumber(invoice.discount_amount);
          return {
            id: invoice.id,
            title: invoice.invoice_no,
            className: invoice.class?.name,
            dueDate: invoice.due_date,
            amount: total,
            paidAmount: paid,
            status: invoice.status,
          };
        }),
        materials: materials.map((item) => ({
          id: item.id,
          title: item.title,
          date: item.created_at,
          type: 'material',
        })),
      },
    };
  }

  private async getRecentActivities(userId: number) {
    const activities = await prisma.leadActivity.findMany({
      where: { user_id: userId },
      include: activityInclude,
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return activities.map(mapActivity);
  }

  private mapSchedule(schedule: any) {
    return {
      id: schedule.id,
      classId: schedule.class_id,
      name: schedule.class?.name || 'Buổi học',
      date: schedule.date,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      room: schedule.room?.name,
      students: schedule.attendances?.length,
    };
  }
}

export const dashboardService = new DashboardService();

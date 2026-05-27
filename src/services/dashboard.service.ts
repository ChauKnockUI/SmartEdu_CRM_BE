import { Prisma } from '../generated/prisma';
import { prisma } from '../database/db';
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

  private async getAdminOverview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      newLeads,
      totalLeads,
      convertedLeads,
      activeStudents,
      revenue,
      leadSources,
      highRiskStudents,
      debts,
      fullClasses,
      staleLeads,
      activities,
    ] = await Promise.all([
      prisma.lead.count({ where: { status: 'new', createdAt: { gte: monthStart, lt: nextMonthStart } } }),
      prisma.lead.count(),
      prisma.lead.count({ where: { status: 'enrolled' } }),
      prisma.student.count({ where: { status: 'active' } }),
      this.getRevenueBetween(monthStart, nextMonthStart),
      this.getLeadSources(),
      prisma.student.count({ where: { dropout_risk_level: 'high' } }),
      invoiceService.getDebts(),
      this.getNearlyFullClasses(),
      prisma.lead.count({
        where: {
          status: { in: ['new', 'contacted', 'interested', 'trial'] },
          OR: [{ last_contacted: null }, { last_contacted: { lt: addDays(now, -3) } }],
        },
      }),
      this.getRecentActivities(),
    ]);

    return {
      role: 'admin' as const,
      kpis: {
        newLeads,
        conversionRate: totalLeads ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0,
        activeStudents,
        monthRevenue: revenue,
      },
      charts: {
        revenueLast6Months: await this.getRevenueLast6Months(),
        leadSources,
      },
      alerts: [
        { id: 'risk-students', type: 'warning' as AlertType, title: `${highRiskStudents} học viên có nguy cơ nghỉ học cao`, action: '/ai/predictions' },
        { id: 'debts', type: 'error' as AlertType, title: `${debts.length} học phí quá hạn/chưa thu`, action: '/finance/debts' },
        { id: 'full-classes', type: 'info' as AlertType, title: `${fullClasses} lớp sắp đầy (>80% sĩ số)`, action: '/lms/classes' },
        { id: 'stale-leads', type: 'warning' as AlertType, title: `${staleLeads} leads chưa follow-up >3 ngày`, action: '/crm/leads' },
      ],
      activities,
      lists: {},
    };
  }

  private async getSaleOverview(userId: number) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [myLeads, converted, followUpToday, debts] = await Promise.all([
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
      activities: await this.getRecentActivities(userId),
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

  private async getRevenueBetween(from: Date, to: Date) {
    const transactions = await prisma.paymentTransaction.findMany({
      where: { paid_at: { gte: from, lt: to } },
      select: { amount: true },
    });
    return transactions.reduce((sum, item) => sum + toNumber(item.amount), 0);
  }

  private async getRevenueLast6Months() {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        start: date,
        end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
        month: monthLabel(date),
      };
    });

    return Promise.all(
      months.map(async (month) => ({
        month: month.month,
        revenue: await this.getRevenueBetween(month.start, month.end),
      }))
    );
  }

  private async getLeadSources() {
    const rows = await prisma.lead.groupBy({
      by: ['lead_source'],
      _count: { _all: true },
      orderBy: { _count: { lead_source: 'desc' } },
    });
    return rows.map((row) => ({ name: row.lead_source || 'Khác', value: row._count._all }));
  }

  private async getNearlyFullClasses() {
    const classes = await prisma.class.findMany({
      where: { max_students: { gt: 0 }, status: { in: ['ongoing', 'upcoming'] } },
      include: { classEnrollments: { where: { status: 'active' } } },
    });
    return classes.filter((item) => item.max_students && item.classEnrollments.length / item.max_students >= 0.8).length;
  }

  private async getRecentActivities(userId?: number) {
    const activities = await prisma.leadActivity.findMany({
      where: userId ? { user_id: userId } : undefined,
      include: { user: { select: { full_name: true } }, lead: { select: { full_name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return activities.map((activity) => ({
      id: String(activity.id),
      actor: activity.user?.full_name || 'System',
      text: `${activity.type} lead ${activity.lead.full_name}${activity.content ? ` - ${activity.content}` : ''}`,
      time: activity.createdAt,
    }));
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

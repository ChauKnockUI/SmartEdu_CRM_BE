import { Prisma } from '../generated/prisma';
import { adminPrisma } from '../database/admin-db';
import { ApiError } from '../utils/apiError';
import { invalidateTenantCache } from '../middlewares/tenant.middleware';

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 7;

export const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const monthsBetween = (start: Date, end: Date): number =>
  Math.max(1, Math.round((end.getTime() - start.getTime()) / (30 * DAY_MS)));

const requireTenant = async (id: number) => {
  const tenant = await adminPrisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new ApiError(404, 'Không tìm thấy trung tâm');
  return tenant;
};

export const platformService = {
  /** Số liệu tổng quan cho dashboard Super Admin. */
  async stats() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const soon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [byStatus, newThisWeek, paidSubs, monthRevenue, expiringSubs, expiringTrials, trialExpired, byPlan, plans, totalUsers] =
      await Promise.all([
        adminPrisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
        adminPrisma.tenant.count({ where: { createdAt: { gte: weekAgo } } }),
        adminPrisma.tenantSubscription.findMany({
          where: { status: 'active', amount: { gt: 0 }, period_start: { lte: now }, period_end: { gt: now } },
          select: { amount: true, period_start: true, period_end: true },
        }),
        adminPrisma.tenantSubscription.aggregate({
          _sum: { amount: true },
          where: { amount: { gt: 0 }, period_start: { gte: monthStart } },
        }),
        adminPrisma.tenantSubscription.findMany({
          where: { status: 'active', amount: { gt: 0 }, period_end: { gt: now, lte: soon } },
          orderBy: { period_end: 'asc' },
          take: 10,
          include: { tenant: { select: { id: true, name: true, subdomain: true } } },
        }),
        adminPrisma.tenant.findMany({
          where: { status: 'trial', trial_ends_at: { gt: now, lte: soon } },
          orderBy: { trial_ends_at: 'asc' },
          take: 10,
          select: { id: true, name: true, subdomain: true, trial_ends_at: true },
        }),
        adminPrisma.tenant.count({ where: { status: 'trial', trial_ends_at: { lte: now } } }),
        adminPrisma.tenant.groupBy({ by: ['plan_id'], _count: { _all: true } }),
        adminPrisma.subscriptionPlan.findMany({ select: { id: true, code: true, name: true } }),
        adminPrisma.user.count(),
      ]);

    // MRR: quy đổi mỗi kỳ trả phí về theo tháng
    const mrr = paidSubs.reduce(
      (sum, s) => sum + Number(s.amount) / monthsBetween(s.period_start, s.period_end),
      0
    );
    const planName = new Map(plans.map((p) => [p.id, p]));

    return {
      tenants: {
        total: byStatus.reduce((n, r) => n + r._count._all, 0),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        newThisWeek,
        trialExpired,
      },
      revenue: {
        mrr: Math.round(mrr),
        thisMonth: Number(monthRevenue._sum.amount ?? 0),
      },
      expiringSoon: {
        windowDays: EXPIRING_WINDOW_DAYS,
        subscriptions: expiringSubs.map((s) => ({
          tenant: s.tenant,
          plan_id: s.plan_id,
          period_end: s.period_end,
        })),
        trials: expiringTrials,
      },
      planDistribution: byPlan.map((r) => ({
        plan_id: r.plan_id,
        code: r.plan_id ? planName.get(r.plan_id)?.code ?? null : null,
        name: r.plan_id ? planName.get(r.plan_id)?.name ?? null : 'Chưa có gói',
        count: r._count._all,
      })),
      totalUsers,
    };
  },

  /** Chi tiết một trung tâm kèm mức sử dụng so với giới hạn của gói. */
  async tenantDetail(id: number) {
    const tenant = await adminPrisma.tenant.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!tenant) throw new ApiError(404, 'Không tìm thấy trung tâm');

    const now = new Date();
    const [users, students, teachers, leads, classes, currentSubscription] = await Promise.all([
      adminPrisma.user.count({ where: { tenant_id: id } }),
      adminPrisma.student.count({ where: { tenant_id: id } }),
      adminPrisma.teacher.count({ where: { tenant_id: id } }),
      adminPrisma.lead.count({ where: { tenant_id: id } }),
      adminPrisma.class.count({ where: { tenant_id: id } }),
      adminPrisma.tenantSubscription.findFirst({
        where: { tenant_id: id, status: 'active', period_end: { gt: now } },
        orderBy: { period_end: 'desc' },
      }),
    ]);

    return {
      tenant,
      usage: {
        users,
        students,
        teachers,
        leads,
        classes,
        limits: { max_users: tenant.plan?.max_users ?? null, max_students: tenant.plan?.max_students ?? null },
      },
      currentSubscription,
    };
  },

  async updateTenant(id: number, data: { name?: string; contact_email?: string | null; contact_phone?: string | null }) {
    await requireTenant(id);
    return adminPrisma.tenant.update({ where: { id }, data });
  },

  async setStatus(id: number, status: 'trial' | 'active' | 'suspended' | 'closed') {
    const tenant = await requireTenant(id);
    if (tenant.status === 'closed' && status !== 'closed') {
      throw new ApiError(409, 'Trung tâm đã đóng, không thể mở lại');
    }
    const updated = await adminPrisma.tenant.update({ where: { id }, data: { status } });
    invalidateTenantCache(updated.subdomain);
    return { before: tenant.status, tenant: updated };
  },

  async listSubscriptions(id: number) {
    await requireTenant(id);
    return adminPrisma.tenantSubscription.findMany({
      where: { tenant_id: id },
      orderBy: { period_start: 'desc' },
      include: { plan: { select: { id: true, code: true, name: true } } },
    });
  },

  /** Đổi/nâng gói: hủy kỳ đang chạy, mở kỳ mới theo số tháng, cập nhật gói của trung tâm. */
  async changePlan(id: number, planId: number, months: number) {
    const tenant = await requireTenant(id);
    if (tenant.status === 'closed') throw new ApiError(409, 'Trung tâm đã đóng');

    const plan = await adminPrisma.subscriptionPlan.findFirst({ where: { id: planId, is_active: true } });
    if (!plan) throw new ApiError(400, 'Gói dịch vụ không tồn tại hoặc đã ngừng bán');

    const now = new Date();
    const amount = new Prisma.Decimal(plan.price_monthly).mul(months);

    const result = await adminPrisma.$transaction(async (tx) => {
      await tx.tenantSubscription.updateMany({
        where: { tenant_id: id, status: 'active' },
        data: { status: 'cancelled' },
      });
      const subscription = await tx.tenantSubscription.create({
        data: {
          tenant_id: id,
          plan_id: plan.id,
          status: 'active',
          amount,
          period_start: now,
          period_end: addMonths(now, months),
        },
      });
      const updated = await tx.tenant.update({
        where: { id },
        data: {
          plan_id: plan.id,
          // Trung tâm dùng thử chuyển sang chính thức khi có kỳ đăng ký
          ...(tenant.status === 'trial' ? { status: 'active', trial_ends_at: null } : {}),
        },
      });
      return { tenant: updated, subscription };
    });

    invalidateTenantCache(tenant.subdomain);
    return { ...result, previous_plan_id: tenant.plan_id };
  },

  /** Gia hạn thêm số ngày cho kỳ đang chạy (và thời hạn dùng thử nếu đang trial). */
  async extend(id: number, days: number) {
    const tenant = await requireTenant(id);
    if (tenant.status === 'closed') throw new ApiError(409, 'Trung tâm đã đóng');

    const now = new Date();
    const result = await adminPrisma.$transaction(async (tx) => {
      const current = await tx.tenantSubscription.findFirst({
        where: { tenant_id: id, status: 'active' },
        orderBy: { period_end: 'desc' },
      });
      if (!current && tenant.status !== 'trial') {
        throw new ApiError(409, 'Trung tâm chưa có kỳ đăng ký để gia hạn');
      }

      const extendFrom = (d: Date) => new Date(Math.max(d.getTime(), now.getTime()) + days * DAY_MS);
      const subscription = current
        ? await tx.tenantSubscription.update({
            where: { id: current.id },
            data: { period_end: extendFrom(current.period_end) },
          })
        : null;
      const updated =
        tenant.status === 'trial'
          ? await tx.tenant.update({
              where: { id },
              data: { trial_ends_at: extendFrom(tenant.trial_ends_at ?? now) },
            })
          : tenant;
      return { tenant: updated, subscription };
    });

    invalidateTenantCache(tenant.subdomain);
    return result;
  },
};

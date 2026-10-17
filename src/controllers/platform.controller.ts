import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '../generated/prisma';
import { adminPrisma } from '../database/admin-db';
import { generateToken } from '../utils/jwt.util';
import { ApiError } from '../utils/apiError';
import { invalidateTenantCache, RESERVED_SUBDOMAINS, SUBDOMAIN_REGEX } from '../middlewares/tenant.middleware';

const TRIAL_DAYS = 14;

const subdomainSchema = z
  .string()
  .toLowerCase()
  .regex(SUBDOMAIN_REGEX, 'Subdomain chỉ gồm a-z, 0-9, dấu gạch ngang (tối đa 63 ký tự)')
  .refine((v) => !RESERVED_SUBDOMAINS.has(v), 'Subdomain này được hệ thống giữ chỗ');

const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });

const createTenantSchema = z.object({
  name: z.string().min(2).max(255),
  subdomain: subdomainSchema,
  plan_id: z.number().int().positive().optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(20).optional(),
  admin: z.object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8),
    full_name: z.string().min(2).max(255),
  }),
});

const statusSchema = z.object({ status: z.enum(['trial', 'active', 'suspended', 'closed']) });

const planSchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
  price_monthly: z.number().nonnegative(),
  max_students: z.number().int().positive().nullable().optional(),
  max_users: z.number().int().positive().nullable().optional(),
  features: z.any().optional(),
  is_active: z.boolean().optional(),
});

const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
};

const idParam = (req: Request): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'ID không hợp lệ');
  return id;
};

export const platformController = {
  async login(req: Request, res: Response) {
    const { email, password } = parse(loginSchema, req.body);
    const admin = await adminPrisma.platformAdmin.findUnique({ where: { email } });
    // So sánh mật khẩu kể cả khi không có tài khoản để tránh lộ email tồn tại qua thời gian phản hồi
    const ok = await bcrypt.compare(password, admin?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
    if (!admin || !admin.is_active || !ok) throw new ApiError(401, 'Email hoặc mật khẩu không đúng');

    const token = generateToken({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
      tenantId: 0,
      scope: 'platform',
    });
    res.json({
      status: 'success',
      data: { token, admin: { id: admin.id, email: admin.email, full_name: admin.full_name } },
    });
  },

  async checkSubdomain(req: Request, res: Response) {
    const parsed = subdomainSchema.safeParse(String(req.query.subdomain ?? ''));
    if (!parsed.success) {
      res.json({ status: 'success', data: { available: false, reason: parsed.error.issues[0].message } });
      return;
    }
    const exists = await adminPrisma.tenant.findUnique({ where: { subdomain: parsed.data }, select: { id: true } });
    res.json({ status: 'success', data: { available: !exists } });
  },

  async listTenants(req: Request, res: Response) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const where: Prisma.TenantWhereInput = {
      ...(status ? { status: status as Prisma.TenantWhereInput['status'] } : {}),
      ...(search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { subdomain: { contains: search, mode: 'insensitive' } }] }
        : {}),
    };
    const [total, items] = await Promise.all([
      adminPrisma.tenant.count({ where }),
      adminPrisma.tenant.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { plan: { select: { id: true, code: true, name: true } } },
      }),
    ]);
    res.json({ status: 'success', data: { items, total, page, limit } });
  },

  async createTenant(req: Request, res: Response) {
    const input = parse(createTenantSchema, req.body);
    const password_hash = await bcrypt.hash(input.admin.password, 12);

    const plan = input.plan_id
      ? await adminPrisma.subscriptionPlan.findFirst({ where: { id: input.plan_id, is_active: true } })
      : await adminPrisma.subscriptionPlan.findFirst({ where: { is_active: true }, orderBy: { price_monthly: 'asc' } });
    if (input.plan_id && !plan) throw new ApiError(400, 'Gói dịch vụ không tồn tại');

    const now = new Date();
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

    const result = await adminPrisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.name,
          subdomain: input.subdomain,
          status: 'trial',
          plan_id: plan?.id,
          contact_email: input.contact_email,
          contact_phone: input.contact_phone,
          trial_ends_at: trialEnds,
        },
      });
      const admin = await tx.user.create({
        data: {
          tenant_id: tenant.id,
          email: input.admin.email,
          password_hash,
          full_name: input.admin.full_name,
          role: 'admin',
          is_active: true,
        },
        select: { id: true, email: true, full_name: true },
      });
      if (plan) {
        await tx.tenantSubscription.create({
          data: {
            tenant_id: tenant.id,
            plan_id: plan.id,
            status: 'active',
            amount: 0,
            period_start: now,
            period_end: trialEnds,
          },
        });
      }
      return { tenant, admin };
    });

    res.status(201).json({ status: 'success', data: result });
  },

  async updateTenantStatus(req: Request, res: Response) {
    const id = idParam(req);
    const { status } = parse(statusSchema, req.body);
    const tenant = await adminPrisma.tenant.update({ where: { id }, data: { status } });
    invalidateTenantCache(tenant.subdomain);
    res.json({ status: 'success', data: tenant });
  },

  async stats(_req: Request, res: Response) {
    const now = new Date();
    const [byStatus, mrr, users] = await Promise.all([
      adminPrisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      adminPrisma.tenantSubscription.aggregate({
        _sum: { amount: true },
        where: { status: 'active', period_end: { gt: now }, amount: { gt: 0 } },
      }),
      adminPrisma.user.count(),
    ]);
    res.json({
      status: 'success',
      data: {
        tenants: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        mrr: mrr._sum.amount ?? 0,
        total_users: users,
      },
    });
  },

  async listPlans(_req: Request, res: Response) {
    const items = await adminPrisma.subscriptionPlan.findMany({ orderBy: { price_monthly: 'asc' } });
    res.json({ status: 'success', data: items });
  },

  async createPlan(req: Request, res: Response) {
    const data = parse(planSchema, req.body);
    const plan = await adminPrisma.subscriptionPlan.create({ data });
    res.status(201).json({ status: 'success', data: plan });
  },

  async updatePlan(req: Request, res: Response) {
    const id = idParam(req);
    const data = parse(planSchema.partial(), req.body);
    const plan = await adminPrisma.subscriptionPlan.update({ where: { id }, data });
    res.json({ status: 'success', data: plan });
  },
};

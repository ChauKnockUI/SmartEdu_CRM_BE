import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { Prisma } from '../generated/prisma';
import { adminPrisma } from '../database/admin-db';
import { generateToken } from '../utils/jwt.util';
import { ApiError } from '../utils/apiError';
import { platformService } from '../services/platform.service';
import { auditPlatform } from '../utils/platformAudit';
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

const PLATFORM_TOKEN_TTL = '8h';
const strongPassword = z.string().min(12, 'Mật khẩu phải có ít nhất 12 ký tự').max(128);

const updateTenantSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  contact_email: z.string().email().nullable().optional(),
  contact_phone: z.string().max(20).nullable().optional(),
});
const changePlanSchema = z.object({ plan_id: z.number().int().positive(), months: z.number().int().min(1).max(36).default(1) });
const extendSchema = z.object({ days: z.number().int().min(1).max(365) });
const changePasswordSchema = z.object({ current_password: z.string().min(1), new_password: strongPassword });
const createAdminSchema = z.object({ email: z.string().email().toLowerCase(), password: strongPassword, full_name: z.string().min(2).max(255) });
const updateAdminSchema = z.object({ full_name: z.string().min(2).max(255).optional(), is_active: z.boolean().optional() });
const tenantUserUpdateSchema = z.object({ is_active: z.boolean() });
const resetPasswordSchema = z.object({ password: strongPassword.optional() });

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

const idParam = (req: Request, name = 'id'): number => {
  const id = Number(req.params[name]);
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
    }, PLATFORM_TOKEN_TTL);
    auditPlatform(req, 'login', { admin_id: admin.id });
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

    auditPlatform(req, 'tenant.create', { tenant_id: result.tenant.id, subdomain: result.tenant.subdomain });
    res.status(201).json({ status: 'success', data: result });
  },

  async updateTenantStatus(req: Request, res: Response) {
    const id = idParam(req);
    const { status } = parse(statusSchema, req.body);
    const { before, tenant } = await platformService.setStatus(id, status);
    auditPlatform(req, 'tenant.status', { tenant_id: id, from: before, to: status });
    res.json({ status: 'success', data: tenant });
  },

  async stats(_req: Request, res: Response) {
    res.json({ status: 'success', data: await platformService.stats() });
  },

  async me(req: Request, res: Response) {
    const admin = await adminPrisma.platformAdmin.findUnique({
      where: { id: req.platformAdmin!.id },
      select: { id: true, email: true, full_name: true, createdAt: true },
    });
    res.json({ status: 'success', data: admin });
  },

  async changePassword(req: Request, res: Response) {
    const { current_password, new_password } = parse(changePasswordSchema, req.body);
    const admin = await adminPrisma.platformAdmin.findUniqueOrThrow({ where: { id: req.platformAdmin!.id } });
    if (!(await bcrypt.compare(current_password, admin.password_hash))) {
      throw new ApiError(400, 'Mật khẩu hiện tại không đúng');
    }
    await adminPrisma.platformAdmin.update({
      where: { id: admin.id },
      data: { password_hash: await bcrypt.hash(new_password, 12) },
    });
    auditPlatform(req, 'admin.change_password');
    res.json({ status: 'success', message: 'Đã đổi mật khẩu' });
  },

  async getTenant(req: Request, res: Response) {
    res.json({ status: 'success', data: await platformService.tenantDetail(idParam(req)) });
  },

  async updateTenant(req: Request, res: Response) {
    const id = idParam(req);
    const data = parse(updateTenantSchema, req.body);
    const tenant = await platformService.updateTenant(id, data);
    auditPlatform(req, 'tenant.update', { tenant_id: id, fields: Object.keys(data) });
    res.json({ status: 'success', data: tenant });
  },

  async listSubscriptions(req: Request, res: Response) {
    res.json({ status: 'success', data: await platformService.listSubscriptions(idParam(req)) });
  },

  async changePlan(req: Request, res: Response) {
    const id = idParam(req);
    const { plan_id, months } = parse(changePlanSchema, req.body);
    const result = await platformService.changePlan(id, plan_id, months);
    auditPlatform(req, 'tenant.change_plan', { tenant_id: id, from_plan: result.previous_plan_id, to_plan: plan_id, months });
    res.json({ status: 'success', data: result });
  },

  async extend(req: Request, res: Response) {
    const id = idParam(req);
    const { days } = parse(extendSchema, req.body);
    const result = await platformService.extend(id, days);
    auditPlatform(req, 'tenant.extend', { tenant_id: id, days });
    res.json({ status: 'success', data: result });
  },

  // ─── Người dùng của trung tâm ──────────────────────────────────────────────
  async listTenantUsers(req: Request, res: Response) {
    const id = idParam(req);
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const users = await adminPrisma.user.findMany({
      where: { tenant_id: id, ...(role ? { role: role as any } : {}) },
      orderBy: { id: 'asc' },
      take: 200,
      select: { id: true, email: true, full_name: true, role: true, is_active: true, createdAt: true },
    });
    res.json({ status: 'success', data: users });
  },

  async setTenantUserActive(req: Request, res: Response) {
    const tenantId = idParam(req);
    const userId = idParam(req, 'userId');
    const { is_active } = parse(tenantUserUpdateSchema, req.body);
    const result = await adminPrisma.user.updateMany({ where: { id: userId, tenant_id: tenantId }, data: { is_active } });
    if (result.count === 0) throw new ApiError(404, 'Không tìm thấy người dùng trong trung tâm này');
    auditPlatform(req, 'tenant_user.set_active', { tenant_id: tenantId, user_id: userId, is_active });
    res.json({ status: 'success', message: is_active ? 'Đã kích hoạt' : 'Đã vô hiệu hóa' });
  },

  /** Đặt lại mật khẩu người dùng của trung tâm (ví dụ chủ trung tâm quên mật khẩu). Mật khẩu mới chỉ trả về một lần. */
  async resetTenantUserPassword(req: Request, res: Response) {
    const tenantId = idParam(req);
    const userId = idParam(req, 'userId');
    const { password } = parse(resetPasswordSchema, req.body ?? {});
    const newPassword = password ?? randomBytes(9).toString('base64url');
    const result = await adminPrisma.user.updateMany({
      where: { id: userId, tenant_id: tenantId },
      data: { password_hash: await bcrypt.hash(newPassword, 12) },
    });
    if (result.count === 0) throw new ApiError(404, 'Không tìm thấy người dùng trong trung tâm này');
    auditPlatform(req, 'tenant_user.reset_password', { tenant_id: tenantId, user_id: userId });
    res.json({ status: 'success', data: { password: newPassword, generated: !password } });
  },

  // ─── Quản trị viên nền tảng ────────────────────────────────────────────────
  async listAdmins(_req: Request, res: Response) {
    const admins = await adminPrisma.platformAdmin.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, email: true, full_name: true, is_active: true, createdAt: true },
    });
    res.json({ status: 'success', data: admins });
  },

  async createAdmin(req: Request, res: Response) {
    const input = parse(createAdminSchema, req.body);
    const admin = await adminPrisma.platformAdmin.create({
      data: { email: input.email, full_name: input.full_name, password_hash: await bcrypt.hash(input.password, 12) },
      select: { id: true, email: true, full_name: true, is_active: true },
    });
    auditPlatform(req, 'admin.create', { target_id: admin.id });
    res.status(201).json({ status: 'success', data: admin });
  },

  async updateAdmin(req: Request, res: Response) {
    const id = idParam(req);
    const data = parse(updateAdminSchema, req.body);
    if (id === req.platformAdmin!.id && data.is_active === false) {
      throw new ApiError(400, 'Không thể tự vô hiệu hóa tài khoản của chính mình');
    }
    const admin = await adminPrisma.platformAdmin.update({
      where: { id },
      data,
      select: { id: true, email: true, full_name: true, is_active: true },
    });
    auditPlatform(req, 'admin.update', { target_id: id, fields: Object.keys(data) });
    res.json({ status: 'success', data: admin });
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

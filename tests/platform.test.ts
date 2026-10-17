import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app';
import { adminPrisma } from '../src/database/admin-db';
import { generateToken } from '../src/utils/jwt.util';
import { invalidateTenantCache } from '../src/middlewares/tenant.middleware';

const PA_EMAIL = 'platform-test@test.local';
const PA_PASSWORD = 'PlatformPass123!';
const SUB = 'plat-new';
const ADMIN_EMAIL = 'owner@plat-new.test';
let token = '';
let planId = 0;
let tenantId = 0;

const cleanup = async () => {
  const t = await adminPrisma.tenant.findUnique({ where: { subdomain: SUB } });
  if (t) {
    await adminPrisma.tenantSubscription.deleteMany({ where: { tenant_id: t.id } });
    await adminPrisma.user.deleteMany({ where: { tenant_id: t.id } });
    await adminPrisma.tenant.delete({ where: { id: t.id } });
  }
  await adminPrisma.platformAdmin.deleteMany({ where: { email: PA_EMAIL } });
  await adminPrisma.subscriptionPlan.deleteMany({ where: { code: 'test-plan' } });
};

beforeAll(async () => {
  await cleanup();
  await adminPrisma.platformAdmin.create({
    data: { email: PA_EMAIL, password_hash: await bcrypt.hash(PA_PASSWORD, 4), full_name: 'PA' },
  });
  planId = (await adminPrisma.subscriptionPlan.create({ data: { code: 'test-plan', name: 'Test', price_monthly: 100 } })).id;
});

afterAll(async () => {
  await cleanup();
  await adminPrisma.$disconnect();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('API nền tảng', () => {
  it('không token → 401', async () => {
    expect((await request(app).get('/api/platform/tenants')).status).toBe(401);
  });

  it('đăng nhập sai → 401, đúng → token', async () => {
    const bad = await request(app).post('/api/platform/auth/login').send({ email: PA_EMAIL, password: 'sai-sai' });
    expect(bad.status).toBe(401);
    const ok = await request(app).post('/api/platform/auth/login').send({ email: PA_EMAIL, password: PA_PASSWORD });
    expect(ok.status).toBe(200);
    token = ok.body.data.token;
  });

  it('check-subdomain: công khai, trả available/không hợp lệ', async () => {
    const free = await request(app).get('/api/platform/tenants/check-subdomain').query({ subdomain: SUB });
    expect(free.body.data.available).toBe(true);
    const reserved = await request(app).get('/api/platform/tenants/check-subdomain').query({ subdomain: 'admin' });
    expect(reserved.body.data.available).toBe(false);
    const taken = await request(app).get('/api/platform/tenants/check-subdomain').query({ subdomain: 'demo' });
    expect(taken.body.data.available).toBe(false);
  });

  it('tạo tenant: có admin đầu tiên + subscription trial; trùng subdomain → 409', async () => {
    const body = {
      name: 'Trung tâm mới',
      subdomain: SUB,
      plan_id: planId,
      admin: { email: ADMIN_EMAIL, password: 'OwnerPass123', full_name: 'Chủ trung tâm' },
    };
    const res = await request(app).post('/api/platform/tenants').set(auth()).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    tenantId = res.body.data.tenant.id;
    expect(res.body.data.admin).not.toHaveProperty('password_hash');

    const sub = await adminPrisma.tenantSubscription.findFirst({ where: { tenant_id: tenantId } });
    expect(sub?.status).toBe('active');
    const dup = await request(app).post('/api/platform/tenants').set(auth()).send(body);
    expect(dup.status).toBe(409);
  });

  it('subdomain bị cấm → 400', async () => {
    const res = await request(app)
      .post('/api/platform/tenants')
      .set(auth())
      .send({ name: 'X', subdomain: 'www', admin: { email: 'a@b.co', password: 'password123', full_name: 'Ad' } });
    expect(res.status).toBe(400);
  });

  it('admin của tenant mới đăng nhập được qua subdomain; token platform không dùng được ở API tenant', async () => {
    invalidateTenantCache();
    const login = await request(app)
      .post('/api/auth/login')
      .set('Host', `${SUB}.localhost`)
      .send({ email: ADMIN_EMAIL, password: 'OwnerPass123' });
    expect(login.status).toBe(200);
    const bad = await request(app).get('/api/leads').set({ Host: `${SUB}.localhost`, ...auth() });
    expect(bad.status).toBe(401);
  });

  it('khóa tenant → API tenant trả 403 ngay (cache được hủy)', async () => {
    const warm = await request(app).get('/api/auth/me').set('Host', `${SUB}.localhost`);
    expect(warm.status).toBe(401); // đã qua resolveTenant, thiếu token
    const res = await request(app).put(`/api/platform/tenants/${tenantId}/status`).set(auth()).send({ status: 'suspended' });
    expect(res.status).toBe(200);
    const after = await request(app).get('/api/auth/me').set('Host', `${SUB}.localhost`);
    expect(after.status).toBe(403);
  });

  it('stats và danh sách tenant', async () => {
    const stats = await request(app).get('/api/platform/stats').set(auth());
    expect(stats.status).toBe(200);
    expect(stats.body.data.tenants).toBeDefined();
    const list = await request(app).get('/api/platform/tenants').query({ search: SUB }).set(auth());
    expect(list.body.data.items.map((t: any) => t.subdomain)).toContain(SUB);
  });

  it('token tenant không vào được API nền tảng → 401', async () => {
    const tenantToken = generateToken({ userId: 1, email: PA_EMAIL, role: 'admin', tenantId: 1, scope: 'tenant' });
    const forged = await request(app).get('/api/platform/stats').set('Authorization', `Bearer ${tenantToken}`);
    expect(forged.status).toBe(401);
    const res = await request(app).get('/api/platform/stats').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });
});

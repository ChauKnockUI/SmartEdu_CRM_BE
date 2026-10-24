import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app';
import { adminPrisma } from '../src/database/admin-db';
import { generateToken } from '../src/utils/jwt.util';
import { cleanupTenants, host } from './helpers';

const SUBS = ['sa-one', 'sa-two'];
const PA_EMAILS = ['sa-root@test.local', 'sa-second@test.local', 'sa-third@test.local'];
const PA_PASSWORD = 'RootPassword123!';
const OWNER_PASSWORD = 'OwnerPass12345';

let rootId = 0;
let rootToken = '';
let basicId = 0;
let proId = 0;
let inactivePlanId = 0;
let tenantOne = 0;
let tenantTwo = 0;
let ownerOneId = 0;

const tokenFor = (id: number, email: string) =>
  generateToken({ userId: id, email, role: 'admin', tenantId: 0, scope: 'platform' }, '1h');
const api = (token = rootToken) => ({
  get: (url: string) => request(app).get(`/api/platform${url}`).set('Authorization', `Bearer ${token}`),
  post: (url: string, body: object = {}) => request(app).post(`/api/platform${url}`).set('Authorization', `Bearer ${token}`).send(body),
  put: (url: string, body: object = {}) => request(app).put(`/api/platform${url}`).set('Authorization', `Bearer ${token}`).send(body),
});

const cleanup = async () => {
  await cleanupTenants(SUBS);
  await adminPrisma.subscriptionPlan.deleteMany({ where: { code: { in: ['sa-basic', 'sa-pro', 'sa-old'] } } });
  await adminPrisma.platformAdmin.deleteMany({ where: { email: { in: PA_EMAILS } } });
};

const createTenant = async (sub: string, plan_id?: number) => {
  const res = await api().post('/tenants', {
    name: `Trung tâm ${sub}`,
    subdomain: sub,
    plan_id,
    admin: { email: `owner@${sub}.test`, password: OWNER_PASSWORD, full_name: `Chủ ${sub}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { tenant: { id: number }; admin: { id: number } };
};

beforeAll(async () => {
  await cleanup();
  const root = await adminPrisma.platformAdmin.create({
    data: { email: PA_EMAILS[0], password_hash: await bcrypt.hash(PA_PASSWORD, 4), full_name: 'Root' },
  });
  rootId = root.id;
  rootToken = tokenFor(root.id, root.email);
  basicId = (await adminPrisma.subscriptionPlan.create({ data: { code: 'sa-basic', name: 'Basic', price_monthly: 100, max_users: 5 } })).id;
  proId = (await adminPrisma.subscriptionPlan.create({ data: { code: 'sa-pro', name: 'Pro', price_monthly: 300 } })).id;
  inactivePlanId = (await adminPrisma.subscriptionPlan.create({ data: { code: 'sa-old', name: 'Old', price_monthly: 50, is_active: false } })).id;

  const one = await createTenant(SUBS[0], basicId);
  tenantOne = one.tenant.id;
  ownerOneId = one.admin.id;
  tenantTwo = (await createTenant(SUBS[1], basicId)).tenant.id;
});

afterAll(async () => {
  await cleanup();
  await adminPrisma.$disconnect();
});

describe('tài khoản Super Admin', () => {
  it('xem thông tin của chính mình', async () => {
    const res = await api().get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(PA_EMAILS[0]);
    expect(res.body.data).not.toHaveProperty('password_hash');
  });

  it('đổi mật khẩu: sai mật khẩu cũ → 400, mật khẩu mới yếu → 400, hợp lệ → đăng nhập được bằng mật khẩu mới', async () => {
    const wrong = await api().post('/auth/change-password', { current_password: 'sai', new_password: 'NewPassword12345' });
    expect(wrong.status).toBe(400);
    const weak = await api().post('/auth/change-password', { current_password: PA_PASSWORD, new_password: 'ngan' });
    expect(weak.status).toBe(400);
    const ok = await api().post('/auth/change-password', { current_password: PA_PASSWORD, new_password: 'NewPassword12345' });
    expect(ok.status).toBe(200);
    const login = await request(app).post('/api/platform/auth/login').send({ email: PA_EMAILS[0], password: 'NewPassword12345' });
    expect(login.status).toBe(200);
    expect(login.body.data.token).toBeTruthy();
  });

  it('tạo, liệt kê, vô hiệu hóa quản trị viên khác; không tự vô hiệu hóa mình', async () => {
    const created = await api().post('/admins', { email: PA_EMAILS[1], password: 'SecondPassword123', full_name: 'Second' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).not.toHaveProperty('password_hash');
    const secondId = created.body.data.id;

    const dup = await api().post('/admins', { email: PA_EMAILS[1], password: 'SecondPassword123', full_name: 'Second' });
    expect(dup.status).toBe(409);

    const list = await api().get('/admins');
    expect(list.body.data.map((a: any) => a.email)).toContain(PA_EMAILS[1]);

    const self = await api().put(`/admins/${rootId}`, { is_active: false });
    expect(self.status).toBe(400);

    const secondToken = tokenFor(secondId, PA_EMAILS[1]);
    expect((await api(secondToken).get('/auth/me')).status).toBe(200);
    expect((await api().put(`/admins/${secondId}`, { is_active: false })).status).toBe(200);
    expect((await api(secondToken).get('/auth/me')).status).toBe(401);
  });

  it('token của người dùng trung tâm không dùng được ở API nền tảng', async () => {
    const t = generateToken({ userId: ownerOneId, email: 'x@y.co', role: 'admin', tenantId: tenantOne, scope: 'tenant' });
    expect((await api(t).get('/stats')).status).toBe(401);
  });
});

describe('chi tiết và cập nhật trung tâm', () => {
  it('chi tiết gồm gói, mức sử dụng và giới hạn của gói', async () => {
    const res = await api().get(`/tenants/${tenantOne}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tenant.subdomain).toBe(SUBS[0]);
    expect(res.body.data.usage).toMatchObject({ users: 1, students: 0, limits: { max_users: 5, max_students: null } });
    expect(res.body.data.currentSubscription).not.toBeNull();
  });

  it('không tìm thấy → 404; id sai → 400', async () => {
    expect((await api().get('/tenants/99999999')).status).toBe(404);
    expect((await api().get('/tenants/abc')).status).toBe(400);
  });

  it('cập nhật thông tin liên hệ', async () => {
    const res = await api().put(`/tenants/${tenantOne}`, { name: 'Tên mới', contact_email: 'lienhe@sa-one.test' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Tên mới', contact_email: 'lienhe@sa-one.test' });
    expect((await api().put(`/tenants/${tenantOne}`, { contact_email: 'khong-hop-le' })).status).toBe(400);
  });
});

describe('gói và gia hạn', () => {
  it('nâng gói: hủy kỳ cũ, mở kỳ mới theo số tháng, chuyển trial → active, MRR tăng', async () => {
    const before = (await api().get('/stats')).body.data.revenue.mrr;
    const res = await api().post(`/tenants/${tenantOne}/subscription`, { plan_id: proId, months: 3 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.tenant).toMatchObject({ plan_id: proId, status: 'active', trial_ends_at: null });
    expect(Number(res.body.data.subscription.amount)).toBe(900);

    const subs = (await api().get(`/tenants/${tenantOne}/subscriptions`)).body.data;
    expect(subs.filter((s: any) => s.status === 'active')).toHaveLength(1);
    expect(subs.some((s: any) => s.status === 'cancelled')).toBe(true);

    const after = (await api().get('/stats')).body.data.revenue.mrr;
    expect(after - before).toBe(300);
  });

  it('gói đã ngừng bán hoặc không tồn tại → 400', async () => {
    expect((await api().post(`/tenants/${tenantOne}/subscription`, { plan_id: inactivePlanId })).status).toBe(400);
    expect((await api().post(`/tenants/${tenantOne}/subscription`, { plan_id: 99999999 })).status).toBe(400);
    expect((await api().post(`/tenants/${tenantOne}/subscription`, { plan_id: proId, months: 0 })).status).toBe(400);
  });

  it('gia hạn kỳ đang chạy thêm N ngày', async () => {
    const before = (await api().get(`/tenants/${tenantOne}`)).body.data.currentSubscription.period_end;
    const res = await api().post(`/tenants/${tenantOne}/extend`, { days: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const diffDays = (new Date(res.body.data.subscription.period_end).getTime() - new Date(before).getTime()) / 86_400_000;
    expect(Math.round(diffDays)).toBe(10);
  });

  it('gia hạn thời gian dùng thử của trung tâm trial', async () => {
    const detail = (await api().get(`/tenants/${tenantTwo}`)).body.data.tenant;
    expect(detail.status).toBe('trial');
    const res = await api().post(`/tenants/${tenantTwo}/extend`, { days: 7 });
    expect(res.status).toBe(200);
    const diffDays = (new Date(res.body.data.tenant.trial_ends_at).getTime() - new Date(detail.trial_ends_at).getTime()) / 86_400_000;
    expect(Math.round(diffDays)).toBe(7);
    expect((await api().post(`/tenants/${tenantTwo}/extend`, { days: 0 })).status).toBe(400);
  });

  it('trung tâm active không có kỳ đăng ký không gia hạn được → 409', async () => {
    await adminPrisma.tenantSubscription.deleteMany({ where: { tenant_id: tenantTwo } });
    await adminPrisma.tenant.update({ where: { id: tenantTwo }, data: { status: 'active' } });
    expect((await api().post(`/tenants/${tenantTwo}/extend`, { days: 5 })).status).toBe(409);
  });
});

describe('khóa / mở khóa / đóng', () => {
  const loginOwner = (sub: string, password = OWNER_PASSWORD) =>
    request(app).post('/api/auth/login').set('Host', host(sub)).send({ email: `owner@${sub}.test`, password });

  it('khóa → trung tâm không đăng nhập được ngay; mở khóa → đăng nhập lại được', async () => {
    expect((await loginOwner(SUBS[0])).status).toBe(200);
    expect((await api().put(`/tenants/${tenantOne}/status`, { status: 'suspended' })).status).toBe(200);
    expect((await loginOwner(SUBS[0])).status).toBe(403);
    expect((await api().put(`/tenants/${tenantOne}/status`, { status: 'active' })).status).toBe(200);
    expect((await loginOwner(SUBS[0])).status).toBe(200);
  });

  it('đã đóng thì không mở lại được và không đổi gói được → 409', async () => {
    expect((await api().put(`/tenants/${tenantTwo}/status`, { status: 'closed' })).status).toBe(200);
    expect((await api().put(`/tenants/${tenantTwo}/status`, { status: 'active' })).status).toBe(409);
    expect((await api().post(`/tenants/${tenantTwo}/subscription`, { plan_id: basicId })).status).toBe(409);
    expect((await api().post(`/tenants/${tenantTwo}/extend`, { days: 5 })).status).toBe(409);
  });

  describe('hỗ trợ người dùng của trung tâm', () => {
    it('liệt kê admin của trung tâm', async () => {
      const res = await api().get(`/tenants/${tenantOne}/users`).query({ role: 'admin' });
      expect(res.status).toBe(200);
      expect(res.body.data.map((u: any) => u.id)).toContain(ownerOneId);
      expect(res.body.data[0]).not.toHaveProperty('password_hash');
    });

    it('đặt lại mật khẩu: tự sinh mật khẩu, đăng nhập được bằng mật khẩu mới, mật khẩu cũ hết hiệu lực', async () => {
      const res = await api().post(`/tenants/${tenantOne}/users/${ownerOneId}/reset-password`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.generated).toBe(true);
      const fresh = res.body.data.password as string;
      expect(fresh.length).toBeGreaterThanOrEqual(12);
      expect((await loginOwner(SUBS[0], fresh)).status).toBe(200);
      expect((await loginOwner(SUBS[0], OWNER_PASSWORD)).status).toBe(401);
    });

    it('đặt mật khẩu cụ thể quá ngắn → 400', async () => {
      const res = await api().post(`/tenants/${tenantOne}/users/${ownerOneId}/reset-password`, { password: 'ngan' });
      expect(res.status).toBe(400);
    });

    it('vô hiệu hóa người dùng → không đăng nhập được (403)', async () => {
      const fresh = (await api().post(`/tenants/${tenantOne}/users/${ownerOneId}/reset-password`, { password: 'AnotherPass12345' })).body.data.password;
      expect((await api().put(`/tenants/${tenantOne}/users/${ownerOneId}`, { is_active: false })).status).toBe(200);
      expect((await loginOwner(SUBS[0], fresh)).status).toBe(403);
    });

    it('người dùng thuộc trung tâm khác → 404 và không bị thay đổi', async () => {
      const res = await api().post(`/tenants/${tenantTwo}/users/${ownerOneId}/reset-password`);
      expect(res.status).toBe(404);
      const res2 = await api().put(`/tenants/${tenantTwo}/users/${ownerOneId}`, { is_active: true });
      expect(res2.status).toBe(404);
    });
  });
});

describe('dashboard', () => {
  it('stats có đủ số liệu tổng quan', async () => {
    const res = await api().get('/stats');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.tenants.total).toBeGreaterThanOrEqual(2);
    expect(d.tenants.newThisWeek).toBeGreaterThanOrEqual(2);
    expect(d.tenants.byStatus).toBeTypeOf('object');
    expect(d.revenue.mrr).toBeTypeOf('number');
    expect(d.revenue.thisMonth).toBeGreaterThanOrEqual(900);
    expect(Array.isArray(d.expiringSoon.subscriptions)).toBe(true);
    expect(Array.isArray(d.expiringSoon.trials)).toBe(true);
    expect(d.planDistribution.some((p: any) => p.code === 'sa-pro')).toBe(true);
  });

  it('trung tâm trial sắp hết hạn xuất hiện trong expiringSoon', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000);
    await adminPrisma.tenant.update({ where: { id: tenantTwo }, data: { status: 'trial', trial_ends_at: soon } });
    const d = (await api().get('/stats')).body.data;
    expect(d.expiringSoon.trials.map((t: any) => t.id)).toContain(tenantTwo);
  });
});

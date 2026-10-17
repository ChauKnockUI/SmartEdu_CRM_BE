import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma';
import { app } from '../src/app';
import { prisma } from '../src/database/db';
import { adminPrisma } from '../src/database/admin-db';
import { generateToken } from '../src/utils/jwt.util';
import { invalidateTenantCache } from '../src/middlewares/tenant.middleware';

const PASSWORD = 'Passw0rd!';
const EMAIL = 'iso-admin@test.local';
const SUB_A = 'iso-a';
const SUB_B = 'iso-b';
const SUB_X = 'iso-x';

let tA = 0;
let tB = 0;
let tX = 0;
let leadA = 0;
let leadB = 0;
let userA = 0;
let courseA = 0;
let courseB = 0;

const host = (sub: string) => `${sub}.localhost`;
const login = (sub: string) =>
  request(app).post('/api/auth/login').set('Host', host(sub)).send({ email: EMAIL, password: PASSWORD });
const auth = (sub: string, token: string) => ({ Host: host(sub), Authorization: `Bearer ${token}` });

const cleanup = async () => {
  const tenants = await adminPrisma.tenant.findMany({ where: { subdomain: { in: [SUB_A, SUB_B, SUB_X] } } });
  const ids = tenants.map((t) => t.id);
  if (!ids.length) return;
  // Xóa theo thứ tự FK; bảng con của lead (AI, activity) có thể được tạo khi API chấm điểm lead
  await adminPrisma.$executeRaw`DELETE FROM ai_predictions WHERE tenant_id = ANY(${ids}::int[])`;
  await adminPrisma.$executeRaw`DELETE FROM lead_ai_scores WHERE tenant_id = ANY(${ids}::int[])`;
  await adminPrisma.$executeRaw`DELETE FROM lead_activities WHERE tenant_id = ANY(${ids}::int[])`;
  await adminPrisma.lead.deleteMany({ where: { tenant_id: { in: ids } } });
  await adminPrisma.course.deleteMany({ where: { tenant_id: { in: ids } } });
  await adminPrisma.user.deleteMany({ where: { tenant_id: { in: ids } } });
  await adminPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
};

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const mk = (subdomain: string, status: 'active' | 'suspended' = 'active') =>
    adminPrisma.tenant.create({ data: { name: subdomain, subdomain, status } });
  tA = (await mk(SUB_A)).id;
  tB = (await mk(SUB_B)).id;
  tX = (await mk(SUB_X, 'suspended')).id;
  for (const t of [tA, tB, tX]) {
    const u = await adminPrisma.user.create({
      data: { tenant_id: t, email: EMAIL, password_hash: hash, full_name: 'Admin', role: 'admin' },
    });
    if (t === tA) userA = u.id;
  }
  leadA = (await adminPrisma.lead.create({ data: { tenant_id: tA, full_name: 'Lead A' } })).id;
  leadB = (await adminPrisma.lead.create({ data: { tenant_id: tB, full_name: 'Lead B' } })).id;
  courseA = (await adminPrisma.course.create({ data: { tenant_id: tA, name: 'Course A' } })).id;
  courseB = (await adminPrisma.course.create({ data: { tenant_id: tB, name: 'Course B' } })).id;
  invalidateTenantCache();
});

afterAll(async () => {
  await cleanup();
  await adminPrisma.$disconnect();
});

describe('nhận diện tenant', () => {
  it('Host không có subdomain → 404', async () => {
    const res = await request(app).get('/api/leads').set('Host', 'localhost');
    expect(res.status).toBe(404);
  });
  it('subdomain không tồn tại → 404', async () => {
    const res = await request(app).get('/api/leads').set('Host', host('khong-co'));
    expect(res.status).toBe(404);
  });
  it('subdomain bị cấm (admin) → 404', async () => {
    const res = await request(app).get('/api/leads').set('Host', host('admin'));
    expect(res.status).toBe(404);
  });
  it('tenant bị khóa → 403', async () => {
    expect((await login(SUB_X)).status).toBe(403);
    expect(tX).toBeGreaterThan(0);
  });
  it('header X-Tenant-ID bị bỏ qua', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', host(SUB_A))
      .set('X-Tenant-ID', String(tB))
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.tenant_id).toBe(tA);
  });
});

describe('đăng nhập theo tenant', () => {
  it('cùng email ở 2 tenant đều đăng nhập được, user khác nhau', async () => {
    const a = await login(SUB_A);
    const b = await login(SUB_B);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.user.id).not.toBe(b.body.data.user.id);
  });
  it('sai mật khẩu → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', host(SUB_A))
      .send({ email: EMAIL, password: 'sai-sai-sai' });
    expect(res.status).toBe(401);
  });
});

describe('giả mạo tenant', () => {
  it('token tenant A + Host tenant B → 403', async () => {
    const token = (await login(SUB_A)).body.data.token;
    const res = await request(app).get('/api/leads').set(auth(SUB_B, token));
    expect(res.status).toBe(403);
  });
  it('token cũ không có tenantId → 401', async () => {
    const legacy = generateToken({ userId: userA, email: EMAIL, role: 'admin' } as any);
    const res = await request(app).get('/api/leads').set(auth(SUB_A, legacy));
    expect(res.status).toBe(401);
  });
  it('token scope platform không dùng được ở API tenant → 401', async () => {
    const t = generateToken({ userId: 1, email: EMAIL, role: 'admin', tenantId: tA, scope: 'platform' });
    const res = await request(app).get('/api/leads').set(auth(SUB_A, t));
    expect(res.status).toBe(401);
  });
});

describe('IDOR / cách ly dữ liệu', () => {
  it('đọc lead tenant B bằng id từ tenant A → 404', async () => {
    const token = (await login(SUB_A)).body.data.token;
    const own = await request(app).get(`/api/leads/${leadA}`).set(auth(SUB_A, token));
    const other = await request(app).get(`/api/leads/${leadB}`).set(auth(SUB_A, token));
    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });
  it('sửa lead tenant khác không có tác dụng', async () => {
    const token = (await login(SUB_A)).body.data.token;
    const res = await request(app).put(`/api/leads/${leadB}`).set(auth(SUB_A, token)).send({ full_name: 'hacked' });
    expect([403, 404]).toContain(res.status);
    const row = await adminPrisma.lead.findUnique({ where: { id: leadB } });
    expect(row?.full_name).toBe('Lead B');
  });
  it('danh sách chỉ chứa lead của tenant mình', async () => {
    const token = (await login(SUB_A)).body.data.token;
    const res = await request(app).get('/api/leads').set(auth(SUB_A, token));
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain('Lead A');
    expect(body).not.toContain('Lead B');
  });
  it('tạo lead: tenant_id trong body bị bỏ qua', async () => {
    const token = (await login(SUB_A)).body.data.token;
    const res = await request(app)
      .post('/api/leads')
      .set(auth(SUB_A, token))
      .send({
        full_name: 'Forged',
        phone: '0900000000',
        source: 'other',
        occupation: 'working_professional',
        study_purpose: 'career_advancement',
        course_id: courseA,
        tenant_id: tB,
      });
    expect(res.status).toBeLessThan(300);
    const forged = await adminPrisma.lead.findFirst({ where: { full_name: 'Forged' } });
    expect(forged?.tenant_id).toBe(tA);
  });
});

describe('ghi chéo tenant', () => {
  // LỖ HỔNG ĐÃ BIẾT: FK chỉ kiểm tra id tồn tại (FK bỏ qua RLS) và WITH CHECK chỉ xét tenant_id của dòng mới,
  // nên tham chiếu id của tenant khác vẫn được ghi. Cần FK ghép (tenant_id, id) ở DB hoặc kiểm tra ở service.
  // `it.fails` sẽ báo lỗi khi lỗ hổng được vá -> khi đó đổi thành `it`.
  it('tạo lead tham chiếu course của tenant khác → bị từ chối, không ghi dữ liệu', async () => {
    const token = (await login(SUB_A)).body.data.token;
    const res = await request(app)
      .post('/api/leads')
      .set(auth(SUB_A, token))
      .send({
        full_name: 'CrossRef',
        phone: '0900000001',
        source: 'other',
        occupation: 'working_professional',
        study_purpose: 'career_advancement',
        course_id: courseB,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await adminPrisma.lead.findFirst({ where: { full_name: 'CrossRef' } })).toBeNull();
  });
});

describe('ngữ cảnh DB', () => {
  it('gọi prisma ngoài ngữ cảnh tenant → ném lỗi', async () => {
    await expect(prisma.lead.findMany()).rejects.toThrow(/ngữ cảnh tenant/);
  });
  it('app_user không set_config → 0 dòng; set tenant A không thấy tenant B', async () => {
    const raw = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      expect(await raw.lead.findMany()).toHaveLength(0);
      const [, rows] = await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.tenant_id', ${String(tA)}, true)`,
        raw.lead.findMany({ where: { id: { in: [leadA, leadB] } } }),
      ]);
      expect(rows.map((r) => r.id)).toEqual([leadA]);
    } finally {
      await raw.$disconnect();
    }
  });
});

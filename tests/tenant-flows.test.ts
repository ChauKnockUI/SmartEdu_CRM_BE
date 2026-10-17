import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app';
import { adminPrisma } from '../src/database/admin-db';
import { invalidateTenantCache } from '../src/middlewares/tenant.middleware';

const PASSWORD = 'Passw0rd!';
const EMAIL = 'flow-admin@test.local';
const SUBS = ['flow-a', 'flow-b'] as const;
const tenantIds: Record<string, number> = {};
const tokens: Record<string, string> = {};

const host = (sub: string) => `${sub}.localhost`;
const api = (sub: string) => ({
  get: (url: string) => request(app).get(url).set({ Host: host(sub), Authorization: `Bearer ${tokens[sub]}` }),
  post: (url: string, body: object) =>
    request(app).post(url).set({ Host: host(sub), Authorization: `Bearer ${tokens[sub]}` }).send(body),
});

const cleanup = async () => {
  const ts = await adminPrisma.tenant.findMany({ where: { subdomain: { in: [...SUBS] } } });
  const ids = ts.map((t) => t.id);
  if (!ids.length) return;
  // Xóa mọi bảng con có tenant_id theo vòng lặp, bỏ qua lỗi FK cho tới khi hết dòng
  const tables = await adminPrisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenants'`;
  for (let pass = 0; pass < 6; pass++) {
    for (const { table_name } of tables) {
      try {
        await adminPrisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE tenant_id = ANY($1::int[])`, ids);
      } catch {
        /* thử lại ở vòng sau */
      }
    }
  }
  await adminPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
};

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash(PASSWORD, 4);
  for (const sub of SUBS) {
    const t = await adminPrisma.tenant.create({ data: { name: sub, subdomain: sub, status: 'active' } });
    tenantIds[sub] = t.id;
    await adminPrisma.user.create({
      data: { tenant_id: t.id, email: EMAIL, password_hash: hash, full_name: 'Admin', role: 'admin' },
    });
  }
  invalidateTenantCache();
  for (const sub of SUBS) {
    const res = await request(app).post('/api/auth/login').set('Host', host(sub)).send({ email: EMAIL, password: PASSWORD });
    tokens[sub] = res.body.data.token;
  }
});

afterAll(async () => {
  await cleanup();
  await adminPrisma.$disconnect();
});

describe('các endpoint danh sách chạy được trong ngữ cảnh tenant', () => {
  const paths = [
    '/api/leads',
    '/api/leads/funnel',
    '/api/courses',
    '/api/rooms',
    '/api/classes',
    '/api/teachers',
    '/api/students',
    '/api/schedules',
    '/api/invoices',
    '/api/finance/debts',
    '/api/finance/revenue-summary',
    '/api/dashboard/overview',
    '/api/users/sales',
    '/api/notifications',
    '/api/auth/me',
  ];
  for (const p of paths) {
    it(`GET ${p} → 200`, async () => {
      const res = await api('flow-a').get(p);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  }
});

describe('ràng buộc unique theo tenant', () => {
  it('cùng tên phòng ở 2 tenant được phép, trùng trong 1 tenant bị từ chối', async () => {
    const a1 = await api('flow-a').post('/api/rooms', { name: 'P101', capacity: 20 });
    const b1 = await api('flow-b').post('/api/rooms', { name: 'P101', capacity: 20 });
    const a2 = await api('flow-a').post('/api/rooms', { name: 'P101', capacity: 20 });
    expect(a1.status, JSON.stringify(a1.body)).toBeLessThan(300);
    expect(b1.status, JSON.stringify(b1.body)).toBeLessThan(300);
    expect(a2.status).toBe(409);
  });

  it('cùng email giáo viên ở 2 tenant được phép, trùng trong 1 tenant → 409', async () => {
    const body = { full_name: 'GV Một', email: 'gv1@test.local', phone: '0900000002' };
    const a1 = await api('flow-a').post('/api/teachers', body);
    const b1 = await api('flow-b').post('/api/teachers', body);
    const a2 = await api('flow-a').post('/api/teachers', body);
    expect(a1.status, JSON.stringify(a1.body)).toBeLessThan(300);
    expect(b1.status, JSON.stringify(b1.body)).toBeLessThan(300);
    expect(a2.status).toBe(409);
  });

  it('cùng email học viên ở 2 tenant được phép (transaction tạo user + student)', async () => {
    const body = { full_name: 'HV Một', email: 'hv1@test.local', phone: '0900000003' };
    const a1 = await api('flow-a').post('/api/students', body);
    const b1 = await api('flow-b').post('/api/students', body);
    const a2 = await api('flow-a').post('/api/students', body);
    expect(a1.status, JSON.stringify(a1.body)).toBeLessThan(300);
    expect(b1.status, JSON.stringify(b1.body)).toBeLessThan(300);
    expect(a2.status).toBeGreaterThanOrEqual(400);
    const students = await adminPrisma.student.findMany({ where: { email: 'hv1@test.local' } });
    expect(students.map((s) => s.tenant_id).sort()).toEqual(
      [tenantIds['flow-a'], tenantIds['flow-b']].sort()
    );
  });
});

describe('phễu bán hàng gom phía DB', () => {
  it('số liệu khớp tính tay và chỉ tính lead của tenant mình', async () => {
    const tA = tenantIds['flow-a'];
    const tB = tenantIds['flow-b'];
    const course = await adminPrisma.course.create({ data: { tenant_id: tA, name: 'KhoaFunnel', fee: 1000 } });
    const mk = async (data: Record<string, unknown>, score?: number) => {
      const lead = await adminPrisma.lead.create({ data: { tenant_id: tA, full_name: 'F', ...data } as any });
      if (score !== undefined) {
        await adminPrisma.leadAiScore.create({
          data: { tenant_id: tA, lead_id: lead.id, probability_score: score, recommendation: 'WARM_LEAD' } as any,
        });
      }
    };
    await mk({ status: 'new', course_id: course.id, lead_source: 'other', last_contacted: null }, 0.5);
    await mk({ status: 'new', lead_source: 'other', last_contacted: new Date() });
    await mk({ status: 'enrolled', course_id: course.id, lead_source: 'facebook' }, 80);
    // lead của tenant khác không được lọt vào số liệu
    await adminPrisma.lead.create({ data: { tenant_id: tB, full_name: 'B', status: 'enrolled' } });

    const res = await api('flow-a').get('/api/leads/funnel');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body.data;
    const stage = (k: string) => d.stages.find((s: any) => s.stage === k);

    expect(d.summary.totalLeads).toBe(3);
    expect(stage('new')).toMatchObject({ count: 2, totalValue: 1000, weightedValue: 500, avgScore: 25, staleCount: 1 });
    expect(stage('enrolled')).toMatchObject({ count: 1, totalValue: 1000, weightedValue: 800, avgScore: 80 });
    expect(d.summary).toMatchObject({
      activePipelineCount: 2,
      activePipelineValue: 1000,
      weightedPipelineValue: 500,
      enrolledCount: 1,
      enrolledValue: 1000,
      lostCount: 0,
      winRate: 100,
      staleLeadsCount: 1,
    });
    const fb = d.sourcePerformance.find((s: any) => s.source === 'facebook');
    expect(fb).toMatchObject({ total: 1, enrolled: 1, revenue: 1000 });
  });
});

describe('CORS và phân quyền tài liệu', () => {
  it('CORS cho phép subdomain của BASE_DOMAIN, từ chối origin lạ', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://flow-a.localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://flow-a.localhost:5173');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('học viên không được upload tài liệu → 403', async () => {
    const { generateToken } = await import('../src/utils/jwt.util');
    const student = await adminPrisma.user.create({
      data: {
        tenant_id: tenantIds['flow-a'],
        email: 'sv@flow.test',
        password_hash: 'x',
        full_name: 'SV',
        role: 'student',
      },
    });
    const token = generateToken({
      userId: student.id,
      email: student.email,
      role: 'student',
      tenantId: tenantIds['flow-a'],
      scope: 'tenant',
    });
    const res = await request(app)
      .post('/api/classes/1/materials')
      .set({ Host: host('flow-a'), Authorization: `Bearer ${token}` })
      .attach('file', Buffer.from('hello'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
});

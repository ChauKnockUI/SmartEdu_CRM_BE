import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app';
import { adminPrisma } from '../src/database/admin-db';
import { invalidateTenantCache } from '../src/middlewares/tenant.middleware';

export const PASSWORD = 'Passw0rd!';
export const ADMIN_EMAIL = 'biz-admin@test.local';

export const host = (sub: string) => `${sub}.localhost`;

export interface TestTenant {
  id: number;
  sub: string;
  token: string;
  adminUserId: number;
}

/** Xóa mọi dữ liệu của các tenant test (bỏ qua lỗi FK, lặp nhiều vòng cho tới khi hết). */
export const cleanupTenants = async (subs: string[]) => {
  const ts = await adminPrisma.tenant.findMany({ where: { subdomain: { in: subs } } });
  const ids = ts.map((t) => t.id);
  if (!ids.length) return;
  const tables = await adminPrisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenants'`;
  for (let pass = 0; pass < 8; pass++) {
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

export const setupTenants = async (subs: string[]): Promise<Record<string, TestTenant>> => {
  await cleanupTenants(subs);
  const hash = await bcrypt.hash(PASSWORD, 4);
  const out: Record<string, TestTenant> = {};
  for (const sub of subs) {
    const t = await adminPrisma.tenant.create({ data: { name: sub, subdomain: sub, status: 'active' } });
    const u = await adminPrisma.user.create({
      data: { tenant_id: t.id, email: ADMIN_EMAIL, password_hash: hash, full_name: 'Admin', role: 'admin' },
    });
    out[sub] = { id: t.id, sub, token: '', adminUserId: u.id };
  }
  invalidateTenantCache();
  for (const sub of subs) {
    const res = await request(app).post('/api/auth/login').set('Host', host(sub)).send({ email: ADMIN_EMAIL, password: PASSWORD });
    out[sub].token = res.body.data.token;
  }
  return out;
};

export const client = (t: TestTenant) => {
  const h = () => ({ Host: host(t.sub), Authorization: `Bearer ${t.token}` });
  return {
    get: (url: string) => request(app).get(url).set(h()),
    post: (url: string, body: object = {}) => request(app).post(url).set(h()).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set(h()).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set(h()).send(body),
  };
};

import { Prisma, PrismaClient } from '../generated/prisma';
import { currentTenantId } from './tenant-context';

const logLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'];

// Client gốc (role app_user, bị RLS chi phối). Không export: mọi truy vấn phải qua `prisma` bên dưới.
const createBaseClient = () => new PrismaClient({ log: logLevels });

declare global {
  // eslint-disable-next-line no-var
  var prismaBase: PrismaClient | undefined;
}

const base = globalThis.prismaBase ?? createBaseClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaBase = base;
}

// Các model có cột tenant_id: dùng để thêm điều kiện lọc cho planner dùng index (RLS vẫn là lớp bảo vệ chính).
const tenantScopedModels = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenant_id'))
    .map((m) => m.name)
);

const SET_TENANT_SQL = Prisma.sql`SELECT set_config('app.tenant_id', `;

const setTenant = (tenantId: number) =>
  base.$executeRaw(Prisma.sql`${SET_TENANT_SQL}${String(tenantId)}, true)`);

// Các thao tác có `where` không-unique, an toàn để thêm `tenant_id`.
const whereOps = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

export const prisma = base.$extends({
  name: 'tenant-rls',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = currentTenantId();

        if (tenantScopedModels.has(model) && whereOps.has(operation)) {
          const a = args as { where?: Record<string, unknown> };
          a.where = a.where ? { AND: [a.where, { tenant_id: tenantId }] } : { tenant_id: tenantId };
        }

        const [, result] = await base.$transaction([setTenant(tenantId), query(args) as any]);
        return result;
      },
    },
  },
});

/**
 * Interactive transaction có gắn tenant. Dùng thay cho `prisma.$transaction(async tx => ...)`.
 */
export const withTenantTx = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> => {
  const tenantId = currentTenantId();
  return base.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`${SET_TENANT_SQL}${String(tenantId)}, true)`);
    return fn(tx);
  }, options);
};

/** Dùng cho health check, không đụng bảng tenant. */
export const connectDB = async (): Promise<void> => {
  try {
    await base.$connect();
    console.log('✅ Database connected (Prisma)');
  } catch (error) {
    console.error('❌ Unable to connect to database:', error);
    process.exit(1);
  }
};

export const disconnectDB = async (): Promise<void> => {
  await base.$disconnect();
};

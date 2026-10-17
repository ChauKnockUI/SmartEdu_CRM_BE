import { PrismaClient } from '../generated/prisma';
import { env } from '../config/env';

/**
 * Client role app_admin (BYPASSRLS). CHỈ dùng cho:
 *  - resolve tenant từ subdomain
 *  - API /api/platform/* và onboarding tenant
 *  - job liên tenant
 * Không dùng trong luồng request của tenant.
 */
declare global {
  // eslint-disable-next-line no-var
  var prismaAdmin: PrismaClient | undefined;
}

const createAdminClient = () =>
  new PrismaClient({
    datasourceUrl: env.ADMIN_DATABASE_URL,
    log: ['error'],
  });

export const adminPrisma = globalThis.prismaAdmin ?? createAdminClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaAdmin = adminPrisma;
}

export const disconnectAdminDB = async (): Promise<void> => {
  await adminPrisma.$disconnect();
};

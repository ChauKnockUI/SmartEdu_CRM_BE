import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { adminPrisma } from '../src/database/admin-db';

// Usage: PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=... npx tsx scripts/seed-platform-admin.ts
const main = async () => {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('Cần PLATFORM_ADMIN_EMAIL và PLATFORM_ADMIN_PASSWORD (>= 12 ký tự)');
  }
  const password_hash = await bcrypt.hash(password, 12);
  await adminPrisma.platformAdmin.upsert({
    where: { email },
    update: { password_hash, is_active: true },
    create: { email, password_hash, full_name: process.env.PLATFORM_ADMIN_NAME ?? 'Super Admin' },
  });
  console.log(`Đã tạo/cập nhật platform admin: ${email}`);
};

main().finally(() => adminPrisma.$disconnect());

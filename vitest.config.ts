import { defineConfig } from 'vitest/config';

// Chỉ chạy với Postgres local (Docker smartedu-pg-test). KHÔNG trỏ vào Supabase.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://app_user:x@localhost:55432/smartedu_test',
      ADMIN_DATABASE_URL: 'postgresql://app_admin:x@localhost:55432/smartedu_test',
      DIRECT_URL: 'postgresql://postgres:local_test_pw@localhost:55432/smartedu_test',
      BASE_DOMAIN: 'localhost',
      // Ghim rỗng để test không phụ thuộc DEV_DEFAULT_TENANT_SUBDOMAIN trong .env của người chạy.
      DEV_DEFAULT_TENANT_SUBDOMAIN: '',
      JWT_SECRET: 'test_secret_test_secret_test_secret_123',
    },
  },
});

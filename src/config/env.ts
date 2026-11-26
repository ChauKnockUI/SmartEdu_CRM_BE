import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    ADMIN_DATABASE_URL: z.string().optional(),
    DIRECT_URL: z.string().optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    BASE_DOMAIN: z.string().default('localhost'),
    DEV_DEFAULT_TENANT_SUBDOMAIN: z.string().default('demo'),
    SUPABASE_URL: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET: z.string().default('class-materials'),
    AI_DROPOUT_RISK_URL: z.string().optional(),
    AI_LEAD_SCORING_URL: z.string().optional(),
  })
  .passthrough();

export const env = envSchema.parse(process.env);
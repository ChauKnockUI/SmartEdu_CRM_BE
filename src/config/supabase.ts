import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const getSupabase = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  let role: string | undefined;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* New keys are not JWTs. */ }
  if (key.startsWith('sb_publishable_') || role === 'anon') {
    console.error('[Material] Storage configuration: SUPABASE_SERVICE_ROLE_KEY must be a server secret/service_role key, not a publishable/anon key.');
    throw Object.assign(new Error('Kho tài liệu chưa được cấu hình quyền truy cập. Vui lòng liên hệ quản trị viên trung tâm.'), { statusCode: 503 });
  }
  return supabase;
};

export const SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || 'class-materials';

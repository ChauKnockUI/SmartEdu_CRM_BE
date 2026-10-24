import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { adminPrisma } from '../src/database/admin-db';

/**
 * Dữ liệu mẫu cho trang Super Admin: các gói dịch vụ + một trung tâm có sẵn lịch sử đăng ký và ít dữ liệu nghiệp vụ.
 * Chạy lại nhiều lần an toàn (upsert theo code/subdomain, không nhân đôi dữ liệu).
 *
 * Usage: npx tsx scripts/seed-platform-demo.ts
 * Tùy chọn: SEED_PASSWORD=<mật khẩu tài khoản mẫu, >= 12 ký tự> (mặc định sinh ngẫu nhiên và in ra một lần)
 */

const SUBDOMAIN = 'anhduong';
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY_MS);

const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    price_monthly: 299_000,
    max_students: 100,
    max_users: 5,
    features: ['CRM Leads', 'Quản lý học viên & lớp học', 'Điểm danh', 'Hóa đơn cơ bản'],
  },
  {
    code: 'pro',
    name: 'Pro',
    price_monthly: 790_000,
    max_students: 500,
    max_users: 20,
    features: ['Tất cả tính năng Starter', 'Chấm điểm Lead bằng AI', 'Cảnh báo nguy cơ nghỉ học', 'Báo cáo tài chính & công nợ', 'Tài liệu lớp học'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    price_monthly: 1_990_000,
    max_students: null,
    max_users: null,
    features: ['Tất cả tính năng Pro', 'Không giới hạn học viên & người dùng', 'Hỗ trợ ưu tiên', 'Tên miền riêng (theo yêu cầu)'],
  },
];

const main = async () => {
  const target = new URL(process.env.ADMIN_DATABASE_URL ?? 'postgresql://unset').host;
  console.log(`Đích ghi dữ liệu: ${target}`);
  const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString('base64url');
  if (password.length < 12) throw new Error('SEED_PASSWORD phải có ít nhất 12 ký tự');
  const password_hash = await bcrypt.hash(password, 12);

  // ─── Gói dịch vụ ──────────────────────────────────────────────────────────
  const plans: Record<string, number> = {};
  for (const p of PLANS) {
    const row = await adminPrisma.subscriptionPlan.upsert({
      where: { code: p.code },
      update: { name: p.name, price_monthly: p.price_monthly, max_students: p.max_students, max_users: p.max_users, features: p.features, is_active: true },
      create: { code: p.code, name: p.name, price_monthly: p.price_monthly, max_students: p.max_students, max_users: p.max_users, features: p.features },
    });
    plans[p.code] = row.id;
  }
  console.log(`Gói dịch vụ: ${PLANS.map((p) => p.code).join(', ')}`);

  // ─── Trung tâm mẫu ────────────────────────────────────────────────────────
  const existing = await adminPrisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  if (existing) {
    console.log(`Trung tâm "${SUBDOMAIN}" đã tồn tại (id=${existing.id}), bỏ qua phần dữ liệu trung tâm.`);
    return;
  }

  await adminPrisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: 'Trung tâm Anh ngữ Ánh Dương',
          subdomain: SUBDOMAIN,
          status: 'active',
          plan_id: plans.pro,
          contact_email: 'lienhe@anhduong.edu.vn',
          contact_phone: '0283456789',
          createdAt: daysAgo(120),
        },
      });
      const t = tenant.id;

      // Lịch sử đăng ký: Starter 3 tháng (đã hết hạn) → nâng lên Pro 6 tháng (đang chạy)
      await tx.tenantSubscription.createMany({
        data: [
          { tenant_id: t, plan_id: plans.starter, status: 'expired', amount: 299_000 * 3, period_start: daysAgo(120), period_end: daysAgo(30), createdAt: daysAgo(120) },
          { tenant_id: t, plan_id: plans.pro, status: 'active', amount: 790_000 * 6, period_start: daysAgo(30), period_end: daysAhead(150), createdAt: daysAgo(30) },
        ],
      });

      // Người dùng: chủ trung tâm, nhân viên tư vấn, giáo viên
      const owner = await tx.user.create({
        data: { tenant_id: t, email: 'owner@anhduong.edu.vn', password_hash, full_name: 'Nguyễn Minh Dương', phone: '0901234567', role: 'admin' },
      });
      const sale = await tx.user.create({
        data: { tenant_id: t, email: 'sale@anhduong.edu.vn', password_hash, full_name: 'Trần Thu Hà', phone: '0902345678', role: 'sale' },
      });
      const teacherUser = await tx.user.create({
        data: { tenant_id: t, email: 'gv.lan@anhduong.edu.vn', password_hash, full_name: 'Lê Phương Lan', phone: '0903456789', role: 'teacher' },
      });
      await tx.teacher.create({
        data: { tenant_id: t, user_id: teacherUser.id, full_name: 'Lê Phương Lan', email: 'gv.lan@anhduong.edu.vn', phone: '0903456789', specialization: 'IELTS' },
      });

      // Danh mục: khóa học, phòng học
      const course = await tx.course.create({
        data: { tenant_id: t, name: 'IELTS Foundation', description: 'Nền tảng IELTS 4.5+', total_sessions: 24, fee: 6_500_000, duration_weeks: 12 },
      });
      await tx.course.create({
        data: { tenant_id: t, name: 'Tiếng Anh giao tiếp', description: 'Giao tiếp cho người đi làm', total_sessions: 20, fee: 4_200_000, duration_weeks: 10 },
      });
      await tx.room.create({ data: { tenant_id: t, name: 'Phòng 101', capacity: 20 } });
      await tx.room.create({ data: { tenant_id: t, name: 'Phòng 102', capacity: 15 } });

      // Học viên
      const students = ['Phạm Gia Hân', 'Võ Quốc Bảo', 'Đặng Khánh Linh', 'Bùi Anh Tuấn', 'Hoàng Mai Chi', 'Ngô Đức Thịnh'];
      for (const [i, name] of students.entries()) {
        await tx.student.create({
          data: { tenant_id: t, full_name: name, email: `hocvien${i + 1}@anhduong.edu.vn`, phone: `09100000${String(i + 10)}`, enrollment_date: daysAgo(60 - i * 7) },
        });
      }

      // Lead ở nhiều giai đoạn của phễu
      const leads: Array<[string, 'new' | 'contacted' | 'interested' | 'trial' | 'enrolled' | 'lost', string]> = [
        ['Lý Thanh Tùng', 'new', 'facebook'],
        ['Mai Bảo Ngọc', 'new', 'website_organic'],
        ['Đỗ Hoàng Nam', 'contacted', 'google_ads'],
        ['Trương Ngọc Anh', 'contacted', 'tiktok'],
        ['Phan Quang Huy', 'interested', 'referral'],
        ['Vũ Thị Hoa', 'trial', 'facebook'],
        ['Cao Minh Khôi', 'enrolled', 'referral'],
        ['Tạ Diệu Linh', 'lost', 'other'],
      ];
      for (const [i, [name, status, source]] of leads.entries()) {
        await tx.lead.create({
          data: {
            tenant_id: t,
            full_name: name,
            phone: `09200000${String(i + 10)}`,
            email: `lead${i + 1}@example.com`,
            status,
            lead_source: source,
            course_id: course.id,
            assigned_to: sale.id,
            occupation: 'working_professional',
            study_purpose: 'career_advancement',
            last_contacted: status === 'new' ? null : daysAgo(i % 5),
            createdAt: daysAgo(30 - i * 3),
          },
        });
      }

      console.log(`Trung tâm: ${tenant.name} (id=${t}, ${SUBDOMAIN}) — gói Pro, đang hoạt động`);
      console.log(`Tài khoản chủ trung tâm: ${owner.email}`);
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  console.log('\nTài khoản mẫu (cùng một mật khẩu):');
  console.log('  owner@anhduong.edu.vn (admin), sale@anhduong.edu.vn (sale), gv.lan@anhduong.edu.vn (teacher)');
  console.log(`  Mật khẩu: ${password}${process.env.SEED_PASSWORD ? '' : '   <- chỉ hiển thị lần này'}`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => adminPrisma.$disconnect());

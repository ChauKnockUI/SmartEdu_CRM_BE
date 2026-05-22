import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();
const password = 'SmartEdu@123';
let password_hash = '';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function upsertUser(email: string, full_name: string, role: 'admin' | 'student' | 'teacher', phone: string) {
  return prisma.user.upsert({
    where: { email },
    update: { full_name, role, phone, is_active: true },
    create: { email, password_hash, full_name, role, phone, is_active: true },
  });
}

async function course(name: string, fee: number, sessions: number, weeks: number) {
  const existing = await prisma.course.findFirst({ where: { name } });
  const data = { name, fee, total_sessions: sessions, duration_weeks: weeks, is_active: true };
  return existing ? prisma.course.update({ where: { id: existing.id }, data }) : prisma.course.create({ data });
}

async function feePlan(course_id: number, name: string, items: Array<{ type: any; description: string; amount: number; sort_order: number }>) {
  const existing = await prisma.feePlan.findFirst({ where: { name } });
  if (existing) {
    await prisma.feePlanItem.deleteMany({ where: { fee_plan_id: existing.id } });
    return prisma.feePlan.update({
      where: { id: existing.id },
      data: { course_id, is_default: true, is_active: true, items: { create: items } },
    });
  }
  return prisma.feePlan.create({
    data: { course_id, name, is_default: true, is_active: true, items: { create: items } },
  });
}

async function main() {
  console.log('Seeding finance workflow data...');
  password_hash = await bcrypt.hash(password, 12);

  const admin = await upsertUser('admin.finance@smartedu.com', 'Admin Finance', 'admin', '0909000001');
  const teacherUser = await upsertUser('teacher.finance@smartedu.com', 'Nguyen Thi Giang', 'teacher', '0909000002');

  const teacher = await prisma.teacher.upsert({
    where: { email: 'teacher.finance@smartedu.com' },
    update: { user_id: teacherUser.id, full_name: teacherUser.full_name, is_active: true },
    create: { user_id: teacherUser.id, full_name: teacherUser.full_name, email: teacherUser.email, phone: teacherUser.phone, specialization: 'IELTS, TOEIC', is_active: true },
  });

  const room = await prisma.room.upsert({
    where: { name: 'Finance Demo Room A' },
    update: { capacity: 18, equipment: 'TV, whiteboard', is_active: true },
    create: { name: 'Finance Demo Room A', capacity: 18, equipment: 'TV, whiteboard', is_active: true },
  });

  const ielts = await course('IELTS Foundation 5.5 - Finance Demo', 8500000, 36, 12);
  const comm = await course('English Communication A2 - Finance Demo', 5200000, 24, 8);
  const toeic = await course('TOEIC 650+ - Finance Demo', 6800000, 30, 10);

  const ieltsPlan = await feePlan(ielts.id, 'IELTS Foundation Standard Fee Plan', [
    { type: 'tuition', description: 'IELTS Foundation tuition', amount: 8000000, sort_order: 1 },
    { type: 'material', description: 'IELTS workbook and mock test pack', amount: 300000, sort_order: 2 },
    { type: 'registration', description: 'Registration fee', amount: 200000, sort_order: 3 },
  ]);
  const commPlan = await feePlan(comm.id, 'Communication A2 Standard Fee Plan', [
    { type: 'tuition', description: 'Communication A2 tuition', amount: 5000000, sort_order: 1 },
    { type: 'registration', description: 'Registration fee', amount: 200000, sort_order: 2 },
  ]);
  const toeicPlan = await feePlan(toeic.id, 'TOEIC 650 Standard Fee Plan', [
    { type: 'tuition', description: 'TOEIC 650+ tuition', amount: 6500000, sort_order: 1 },
    { type: 'material', description: 'TOEIC practice book', amount: 300000, sort_order: 2 },
  ]);

  const classRows = [
    { name: 'IELTS-FD-MON-WED-1900', course_id: ielts.id, fee_plan_id: ieltsPlan.id, status: 'ongoing' as const },
    { name: 'COMM-A2-TUE-THU-1800', course_id: comm.id, fee_plan_id: commPlan.id, status: 'ongoing' as const },
    { name: 'TOEIC650-SAT-SUN-0900', course_id: toeic.id, fee_plan_id: toeicPlan.id, status: 'ongoing' as const },
  ];

  const classes = [];
  for (const item of classRows) {
    const existing = await prisma.class.findFirst({ where: { name: item.name } });
    const data = {
      ...item,
      teacher_id: teacher.id,
      room_id: room.id,
      start_date: d('2026-05-04'),
      end_date: d('2026-07-24'),
      schedule_days: 'Mon,Wed,Fri',
      schedule_time: '19:00-21:00',
      max_students: 18,
    };
    classes.push(existing ? await prisma.class.update({ where: { id: existing.id }, data }) : await prisma.class.create({ data }));
  }

  const studentSpecs = [
    ['payment.pending@smartedu.com', 'Tran Minh Pending', classes[0].id],
    ['payment.partial@smartedu.com', 'Le Ngoc Partial', classes[0].id],
    ['payment.paid@smartedu.com', 'Pham Hoang Paid', classes[1].id],
    ['payment.overdue@smartedu.com', 'Vo Thanh Overdue', classes[2].id],
    ['payment.noinvoice@smartedu.com', 'Dang An No Invoice', classes[0].id],
  ] as const;

  const students = [];
  for (const [email, full_name, class_id] of studentSpecs) {
    const user = await upsertUser(email, full_name, 'student', `0911${String(students.length + 1).padStart(6, '0')}`);
    const student = await prisma.student.upsert({
      where: { email },
      update: { user_id: user.id, full_name, status: 'active', enrollment_date: d('2026-05-04') },
      create: { user_id: user.id, email, full_name, phone: user.phone, status: 'active', enrollment_date: d('2026-05-04') },
    });
    await prisma.classEnrollment.upsert({
      where: { class_id_student_id: { class_id, student_id: student.id } },
      update: { status: 'active' },
      create: { class_id, student_id: student.id, status: 'active' },
    });
    students.push({ ...student, class_id });
  }

  await prisma.invoice.deleteMany({ where: { invoice_no: { startsWith: 'INV-SEED-' } } });

  async function invoice(invoice_no: string, idx: number, status: any, paid: number, due_date: Date) {
    const template = await prisma.class.findUnique({
      where: { id: students[idx].class_id },
      include: { feePlan: { include: { items: true } } },
    });
    const items = template!.feePlan!.items.sort((a, b) => a.sort_order - b.sort_order);
    const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
    const row = await prisma.invoice.create({
      data: {
        invoice_no,
        student_id: students[idx].id,
        class_id: students[idx].class_id,
        total_amount: total,
        discount_amount: 0,
        due_date,
        status,
        notes: 'Seed invoice for finance workflow testing',
        items: { create: items.map((item) => ({ type: item.type, description: item.description, amount: item.amount })) },
      },
    });
    if (paid > 0) {
      const tx = await prisma.paymentTransaction.create({
        data: { invoice_id: row.id, amount: paid, method: 'bank_transfer', paid_at: new Date(), reference_code: `SEED-${invoice_no}`, received_by: admin.id },
      });
      await prisma.receipt.create({ data: { receipt_no: `REC-${invoice_no}`, invoice_id: row.id, transaction_id: tx.id, issued_by: admin.id } });
    }
  }

  await invoice('INV-SEED-PENDING-001', 0, 'pending', 0, d('2026-06-05'));
  await invoice('INV-SEED-PARTIAL-001', 1, 'partial', 3000000, d('2026-06-05'));
  await invoice('INV-SEED-PAID-001', 2, 'paid', 5200000, d('2026-05-20'));
  await invoice('INV-SEED-OVERDUE-001', 3, 'overdue', 0, d('2026-05-01'));

  console.log('Finance seed completed.');
  console.log(`Admin login: admin.finance@smartedu.com / ${password}`);
  console.log('Use payment.noinvoice@smartedu.com to test creating a new invoice from class.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());

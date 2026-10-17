import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPrisma } from '../src/database/admin-db';
import { cleanupTenants, client, setupTenants, TestTenant } from './helpers';

const SUBS = ['biz-a', 'biz-b'];
let A: TestTenant;
let B: TestTenant;
let a: ReturnType<typeof client>;
let b: ReturnType<typeof client>;

beforeAll(async () => {
  const t = await setupTenants(SUBS);
  A = t['biz-a'];
  B = t['biz-b'];
  a = client(A);
  b = client(B);
});

afterAll(async () => {
  await cleanupTenants(SUBS);
  await adminPrisma.$disconnect();
});

const mkStudent = (tenantId: number, email: string) =>
  adminPrisma.student.create({ data: { tenant_id: tenantId, full_name: `HV ${email}`, email } });

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe('tạo lớp + sinh lịch (transaction)', () => {
  it('tạo lớp sinh buổi học, mọi dòng thuộc đúng tenant', async () => {
    const room = await adminPrisma.room.create({ data: { tenant_id: A.id, name: 'R1' } });
    const res = await a.post('/api/classes', {
      name: 'Lớp A1',
      room_id: room.id,
      start_date: isoDay(1),
      end_date: isoDay(28),
      schedule_days: [0, 1, 2, 3, 4, 5, 6],
      schedule_time: ['18:00', '20:00'],
      max_students: 10,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const classId = res.body.data.id;
    const schedules = await adminPrisma.schedule.findMany({ where: { class_id: classId } });
    expect(schedules.length).toBeGreaterThan(20);
    expect(schedules.every((s) => s.tenant_id === A.id)).toBe(true);
    expect((await adminPrisma.class.findUnique({ where: { id: classId } }))?.tenant_id).toBe(A.id);
  });

  it('dùng phòng của tenant khác → bị từ chối, không tạo lớp hay lịch nào', async () => {
    const roomB = await adminPrisma.room.create({ data: { tenant_id: B.id, name: 'RB' } });
    const res = await a.post('/api/classes', {
      name: 'Lớp Chéo',
      room_id: roomB.id,
      start_date: isoDay(1),
      end_date: isoDay(7),
      schedule_days: [0, 1, 2, 3, 4, 5, 6],
      schedule_time: ['10:00', '11:00'],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await adminPrisma.class.findFirst({ where: { name: 'Lớp Chéo' } })).toBeNull();
    expect(await adminPrisma.schedule.count({ where: { room_id: roomB.id } })).toBe(0);
  });

  it('tenant khác không thấy lớp, không ghi danh được vào lớp tenant này', async () => {
    const cls = await adminPrisma.class.findFirstOrThrow({ where: { name: 'Lớp A1' } });
    expect((await b.get(`/api/classes/${cls.id}`)).status).toBe(404);
    const studentB = await mkStudent(B.id, 'sv-b@biz.test');
    const enroll = await b.post(`/api/classes/${cls.id}/enroll`, { student_ids: [studentB.id] });
    expect(enroll.status).toBeGreaterThanOrEqual(400);
    expect(await adminPrisma.classEnrollment.count({ where: { class_id: cls.id } })).toBe(0);
  });

  it('ghi danh học viên cùng tenant thành công', async () => {
    const cls = await adminPrisma.class.findFirstOrThrow({ where: { name: 'Lớp A1' } });
    const st = await mkStudent(A.id, 'sv-a@biz.test');
    const res = await a.post(`/api/classes/${cls.id}/enroll`, { student_ids: [st.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await adminPrisma.classEnrollment.findFirst({ where: { class_id: cls.id, student_id: st.id } });
    expect(row?.tenant_id).toBe(A.id);
  });
});

describe('hóa đơn và thanh toán (transaction)', () => {
  let invoiceId = 0;
  let studentId = 0;

  it('tạo hóa đơn nhiều dòng (nested create) với số hóa đơn 8 chữ số', async () => {
    studentId = (await mkStudent(A.id, 'inv@biz.test')).id;
    const res = await a.post('/api/invoices', {
      student_id: studentId,
      items: [
        { type: 'tuition', description: 'Học phí', amount: 900 },
        { type: 'material', description: 'Giáo trình', amount: 100 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const inv = res.body.data;
    invoiceId = inv.id;
    expect(inv.invoice_no).toMatch(/^INV-\d{8}-\d{8}$/);
    const items = await adminPrisma.invoiceItem.findMany({ where: { invoice_id: invoiceId } });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.tenant_id === A.id)).toBe(true);
  });

  it('thanh toán từng phần → partial, đủ → paid, vượt số dư → 400, có phiếu thu', async () => {
    const p1 = await a.post(`/api/invoices/${invoiceId}/payments`, { amount: 400 });
    expect(p1.status, JSON.stringify(p1.body)).toBeLessThan(300);
    expect((await adminPrisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('partial');

    const over = await a.post(`/api/invoices/${invoiceId}/payments`, { amount: 700 });
    expect(over.status).toBe(400);

    const p2 = await a.post(`/api/invoices/${invoiceId}/payments`, { amount: 600 });
    expect(p2.status, JSON.stringify(p2.body)).toBeLessThan(300);
    expect((await adminPrisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('paid');

    const receipts = await adminPrisma.receipt.findMany({ where: { invoice_id: invoiceId } });
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.tenant_id === A.id && /^REC-\d{8}-\d{8}$/.test(r.receipt_no))).toBe(true);
  });

  it('tenant khác không thanh toán được hóa đơn này (404) và không có giao dịch mới', async () => {
    const before = await adminPrisma.paymentTransaction.count({ where: { invoice_id: invoiceId } });
    const res = await b.post(`/api/invoices/${invoiceId}/payments`, { amount: 1 });
    expect(res.status).toBe(404);
    expect(await adminPrisma.paymentTransaction.count({ where: { invoice_id: invoiceId } })).toBe(before);
  });

  it('hóa đơn cho học viên của tenant khác → bị từ chối, không tạo gì', async () => {
    const stB = await mkStudent(B.id, 'invb@biz.test');
    const res = await a.post('/api/invoices', { student_id: stB.id, items: [{ description: 'x', amount: 1 }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await adminPrisma.invoice.count({ where: { student_id: stB.id } })).toBe(0);
  });

  it('danh sách và công nợ chỉ thấy hóa đơn của tenant mình', async () => {
    const mine = await a.get('/api/invoices');
    const theirs = await b.get('/api/invoices');
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).toContain('inv@biz.test');
    expect(JSON.stringify(theirs.body)).not.toContain('inv@biz.test');
  });
});

describe('điểm danh (upsert hàng loạt trong transaction)', () => {
  let scheduleId = 0;
  let s1 = 0;
  let s2 = 0;

  it('lưu điểm danh, gọi lại thì cập nhật chứ không nhân đôi', async () => {
    const cls = await adminPrisma.class.findFirstOrThrow({ where: { name: 'Lớp A1' } });
    s1 = (await mkStudent(A.id, 'att1@biz.test')).id;
    s2 = (await mkStudent(A.id, 'att2@biz.test')).id;
    scheduleId = (
      await adminPrisma.schedule.create({
        data: { tenant_id: A.id, class_id: cls.id, date: new Date(), status: 'scheduled' },
      })
    ).id;

    const first = await a.patch(`/api/schedules/${scheduleId}/attendance`, {
      attendances: [
        { student_id: s1, status: 'present' },
        { student_id: s2, status: 'absent' },
      ],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const second = await a.patch(`/api/schedules/${scheduleId}/attendance`, {
      attendances: [{ student_id: s2, status: 'late' }],
    });
    expect(second.status).toBe(200);

    const rows = await adminPrisma.attendance.findMany({ where: { schedule_id: scheduleId }, orderBy: { student_id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tenant_id === A.id)).toBe(true);
    expect(rows.find((r) => r.student_id === s2)?.status).toBe('late');
  });

  it('một học viên thuộc tenant khác trong danh sách → cả lô bị hủy (atomic)', async () => {
    const stB = await mkStudent(B.id, 'attb@biz.test');
    const s3 = (await mkStudent(A.id, 'att3@biz.test')).id;
    const res = await a.patch(`/api/schedules/${scheduleId}/attendance`, {
      attendances: [
        { student_id: s3, status: 'present' },
        { student_id: stB.id, status: 'present' },
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await adminPrisma.attendance.count({ where: { schedule_id: scheduleId, student_id: s3 } })).toBe(0);
    expect(await adminPrisma.attendance.count({ where: { student_id: stB.id } })).toBe(0);
  });

  it('tenant khác không điểm danh được buổi học này', async () => {
    const res = await b.patch(`/api/schedules/${scheduleId}/attendance`, {
      attendances: [{ student_id: s1, status: 'absent' }],
    });
    expect(res.status).toBe(404);
    const row = await adminPrisma.attendance.findFirst({ where: { schedule_id: scheduleId, student_id: s1 } });
    expect(row?.status).toBe('present');
  });
});

describe('chuyển lead thành học viên (transaction)', () => {
  const convert = async (t: TestTenant, c: ReturnType<typeof client>, email: string) => {
    const lead = await adminPrisma.lead.create({
      data: { tenant_id: t.id, full_name: 'Lead Convert', phone: '0900000009', email },
    });
    return { lead, res: await c.post(`/api/leads/${lead.id}/convert`, { email }) };
  };

  it('chuyển đổi tạo user + student + cập nhật lead; cùng email ở tenant khác vẫn được', async () => {
    const ra = await convert(A, a, 'conv@biz.test');
    expect(ra.res.status, JSON.stringify(ra.res.body)).toBeLessThan(300);
    const rb = await convert(B, b, 'conv@biz.test');
    expect(rb.res.status, JSON.stringify(rb.res.body)).toBeLessThan(300);

    const lead = await adminPrisma.lead.findUnique({ where: { id: ra.lead.id } });
    expect(lead?.status).toBe('enrolled');
    const student = await adminPrisma.student.findFirst({ where: { tenant_id: A.id, email: 'conv@biz.test' } });
    const user = await adminPrisma.user.findFirst({ where: { tenant_id: A.id, email: 'conv@biz.test' } });
    expect(student?.lead_id).toBe(ra.lead.id);
    expect(user).not.toBeNull();
    expect(await adminPrisma.student.count({ where: { email: 'conv@biz.test' } })).toBe(2);
  });

  it('chuyển đổi lead của tenant khác → 404, không tạo gì', async () => {
    const lead = await adminPrisma.lead.create({
      data: { tenant_id: B.id, full_name: 'Lead B Only', email: 'bonly@biz.test' },
    });
    const res = await a.post(`/api/leads/${lead.id}/convert`, { email: 'bonly@biz.test' });
    expect(res.status).toBe(404);
    expect(await adminPrisma.user.count({ where: { email: 'bonly@biz.test' } })).toBe(0);
  });
});

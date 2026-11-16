import { randomInt } from 'crypto';
import { Prisma, type InvoiceItemType } from '../generated/prisma';

export type ClassInvoiceInput = {
    class_id: number; student_id: number; due_date?: Date; discount_amount?: number; notes?: string;
    extra_items?: { type?: InvoiceItemType; description: string; amount: number }[];
    allowEmpty?: boolean;
};

export function classFeeItems(record: {
    course?: { name: string; fee: Prisma.Decimal | null } | null;
    feePlan?: { items: { type: InvoiceItemType; description: string; amount: Prisma.Decimal }[] } | null;
}) {
    if (record.feePlan?.items.length) return record.feePlan.items.map(item => ({
        type: item.type, description: item.description, amount: Number(item.amount),
    }));
    return record.course?.fee && Number(record.course.fee) > 0
        ? [{ type: 'tuition' as const, description: `Học phí - ${record.course.name}`, amount: Number(record.course.fee) }] : [];
}

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const include = { student: { select: { id: true, full_name: true, email: true, phone: true } },
    class: { select: { id: true, name: true } }, items: true, payments: true } as const;

// All automatic and manual class invoices use this path, including legacy Lead invoices.
export async function createClassInvoice(tx: Prisma.TransactionClient, data: ClassInvoiceInput) {
    await tx.$queryRaw`SELECT id FROM classes WHERE id = ${data.class_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM students WHERE id = ${data.student_id} FOR UPDATE`;
    const enrollment = await tx.classEnrollment.findUnique({
        where: { class_id_student_id: { class_id: data.class_id, student_id: data.student_id } },
    });
    if (!enrollment || enrollment.status !== 'active') throw fail('Học viên chưa được ghi danh vào lớp này.', 400);
    const existing = await tx.invoice.findFirst({ where: {
        class_id: data.class_id, student_id: data.student_id, status: { notIn: ['cancelled', 'refunded'] },
    } });
    if (existing) throw fail(`Lớp đã có khoản phải thu ${existing.invoice_no}.`, 409);

    const record = await tx.class.findUnique({ where: { id: data.class_id },
        include: { course: true, feePlan: { include: { items: { orderBy: { sort_order: 'asc' } } } } } });
    if (!record) throw fail('Không tìm thấy lớp học.', 404);
    const student = await tx.student.findUnique({ where: { id: data.student_id },
        select: { lead_id: true, lead: { select: { course_id: true } } } });
    if (student?.lead_id && record.course_id && student.lead?.course_id === record.course_id) {
        const legacy = await tx.invoice.findFirst({ where: {
            student_id: data.student_id, class_id: null, notes: `Auto-created from Lead #${student.lead_id}`,
            status: { notIn: ['cancelled', 'refunded'] },
        } });
        if (legacy) {
            if (data.extra_items?.length || data.discount_amount) {
                throw fail(`Đã có khoản phải thu ${legacy.invoice_no} từ Lead. Vui lòng kiểm tra tại Học phí trước khi điều chỉnh.`, 409);
            }
            // Keep the original agreed amount, due date and payment history.
            return tx.invoice.update({ where: { id: legacy.id }, data: { class_id: data.class_id }, include });
        }
    }
    const items = [...classFeeItems(record), ...(data.extra_items || [])];
    if (!items.length) {
        if (data.allowEmpty) return null;
        throw fail('Lớp chưa có học phí hoặc bảng phí.', 400);
    }
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return tx.invoice.create({ data: {
        invoice_no: `INV-${stamp}-${randomInt(0, 100_000_000).toString().padStart(8, '0')}`,
        student_id: data.student_id, class_id: data.class_id,
        total_amount: items.reduce((total, item) => total + item.amount, 0), discount_amount: data.discount_amount || 0,
        due_date: data.due_date, notes: data.notes || `Tạo từ lớp ${record.name}`,
        items: { create: items.map(item => ({ ...item, type: item.type || 'tuition' })) },
    }, include });
}

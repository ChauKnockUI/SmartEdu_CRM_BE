import { InvoiceStatus, PaymentMethod, Prisma } from '../generated/prisma';
import { randomInt } from 'crypto';
import { prisma, withTenantTx } from '../database/db';
import { classFeeItems, createClassInvoice } from '../repositories/classInvoice';
import { invoiceBalance, moneyCents, inactiveInvoiceStatuses } from '../utils/billing';
import { studentReadScope, classReadScope, type AcademicActor } from '../utils/academicAccess';
import { validateInvoiceDate, validateInvoicePricing } from '../utils/invoiceValidation';
import { currentTenantId } from '../database/tenant-context';

const toNumber = (value: Prisma.Decimal | number | null | undefined) => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
};

const httpError = (message: string, statusCode: number) => {
  const err = new Error(message);
  (err as any).statusCode = statusCode;
  return err;
};

const code = (prefix: string) => {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  // 8 chữ số ngẫu nhiên mật mã học: xác suất trùng trong 1 ngày/1 tenant là không đáng kể (unique theo tenant ở DB)
  const random = randomInt(0, 100_000_000).toString().padStart(8, '0');
  return `${prefix}-${ymd}-${random}`;
};

export type InvoiceItemInput = {
  type?: 'tuition' | 'registration' | 'material' | 'exam' | 'other';
  description: string;
  amount: number;
};

export class InvoiceService {
  private readScope(actor: AcademicActor): Prisma.InvoiceWhereInput {
    if (!['admin', 'sale', 'student'].includes(actor.role)) throw httpError('Không có quyền xem học phí.', 403);
    return actor.role === 'admin' ? {} : { student: studentReadScope(actor) };
  }

  private validId(id: number) {
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw httpError('ID không hợp lệ.', 400);
  }

  async getInvoiceById(id: number, actor: AcademicActor) {
    this.validId(id);
    const invoice = await prisma.invoice.findFirst({ where: { id, ...this.readScope(actor) }, include: {
      student: { select: { id: true, full_name: true, email: true, phone: true } },
      class: { select: { id: true, name: true } },
      items: { orderBy: { id: 'asc' } },
      payments: { orderBy: { paid_at: 'desc' }, include: { receiver: { select: { full_name: true } } } },
      receipts: { orderBy: { issued_at: 'desc' }, select: { id: true, receipt_no: true, transaction_id: true, issued_at: true } },
    } });
    if (!invoice) throw httpError('Không tìm thấy khoản phải thu trong phạm vi được xem.', 404);
    return { ...invoice, ...invoiceBalance(invoice) };
  }

  async getReceipt(invoiceId: number, receiptId: number, actor: AcademicActor) {
    this.validId(invoiceId); this.validId(receiptId);
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, invoice_id: invoiceId, invoice: this.readScope(actor) },
      select: { id: true, receipt_no: true, issued_at: true, notes: true,
        issuer: { select: { full_name: true } },
        invoice: { select: { invoice_no: true, student: { select: { full_name: true } }, class: { select: { name: true } } } },
        transaction: { select: { invoice_id: true, tenant_id: true, amount: true, method: true, paid_at: true,
          reference_code: true, notes: true, receiver: { select: { full_name: true } } } },
      },
    });
    if (!receipt) throw httpError('Không tìm thấy phiếu thu trong phạm vi được xem.', 404);
    if (!receipt.transaction || receipt.transaction.invoice_id !== invoiceId || receipt.transaction.tenant_id !== currentTenantId())
      throw httpError('Phiếu thu chưa liên kết giao dịch hợp lệ. Vui lòng kiểm tra dữ liệu trước khi in.', 409);
    const center = await prisma.tenant.findUnique({ where: { id: currentTenantId() }, select: { name: true } });
    return { ...receipt, center_name: center?.name };
  }

  async cancelInvoice(id: number, reason: unknown, actor: AcademicActor) {
    if (actor.role !== 'admin') throw httpError('Chỉ Admin được hủy khoản phải thu.', 403);
    this.validId(id);
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000)
      throw httpError('Vui lòng nhập lý do hủy từ 1 đến 1000 ký tự.', 400);
    return withTenantTx(async tx => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id }, include: { payments: true, receipts: true } });
      if (!invoice) throw httpError('Không tìm thấy khoản phải thu.', 404);
      if (invoice.payments.length || invoice.receipts.length || ['paid', 'partial', 'refunded'].includes(invoice.status))
        throw httpError('Khoản đã ghi nhận thanh toán hoặc phát hành phiếu thu không thể hủy.', 409);
      if (invoice.status === 'cancelled') return { ...invoice, ...invoiceBalance(invoice) };
      const audit = `[Hủy ${new Date().toISOString()} | Admin #${actor.userId}] ${reason.trim()}`;
      const updated = await tx.invoice.update({ where: { id }, data: { status: 'cancelled', notes: [invoice.notes, audit].filter(Boolean).join('\n') }, include: { payments: true } });
      return { ...updated, ...invoiceBalance(updated) };
    });
  }

  private async assertStudentCollection(studentId: number, actor: AcademicActor) {
    if (!['admin', 'sale'].includes(actor.role)) throw httpError('Không có quyền quản lý khoản phải thu.', 403);
    if (!Number.isInteger(studentId) || studentId <= 0 || studentId > 2147483647) throw httpError('ID học viên không hợp lệ.', 400);
    const student = await prisma.student.findFirst({ where: { id: studentId, ...studentReadScope(actor) }, select: { id: true } });
    if (!student) throw httpError('Không tìm thấy học viên trong phạm vi phụ trách.', 404);
  }

  async getClassFeeTemplate(classId: number, actor: AcademicActor) {
    this.validId(classId);
    const classRecord = await prisma.class.findFirst({
      where: { id: classId, ...classReadScope(actor) },
      include: {
        course: true,
        feePlan: { include: { items: { orderBy: { sort_order: 'asc' } } } },
        classEnrollments: {
          where: { status: 'active', student: studentReadScope(actor) },
          include: { student: { select: { id: true, full_name: true, email: true, phone: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!classRecord) throw httpError('Không tìm thấy lớp học.', 404);

    const feeItems = classFeeItems(classRecord);

    return {
      class: {
        id: classRecord.id,
        name: classRecord.name,
        course: classRecord.course,
      },
      fee_plan: classRecord.feePlan,
      items: feeItems,
      total_amount: feeItems.reduce((sum, item) => sum + item.amount, 0),
      students: classRecord.classEnrollments.map((item) => item.student),
    };
  }

  async getInvoices(query: {
    page?: number;
    limit?: number;
    student_id?: number;
    class_id?: number;
    status?: InvoiceStatus;
    invoice_id?: number;
  }, actor: AcademicActor) {
    for (const id of [query.invoice_id, query.student_id, query.class_id]) {
      if (id !== undefined && (!Number.isInteger(id) || id <= 0 || id > 2147483647)) throw httpError('ID khoản phải thu, học viên hoặc lớp không hợp lệ.', 400);
    }
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;
    const where: Prisma.InvoiceWhereInput = { AND: [this.readScope(actor)] };

    if (query.student_id) where.student_id = query.student_id;
    if (query.class_id) where.class_id = query.class_id;
    if (query.status) where.status = query.status;
    if (query.invoice_id !== undefined) where.id = query.invoice_id;

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          student: { select: { id: true, full_name: true, email: true, phone: true } },
          class: { select: { id: true, name: true } },
          items: true,
          payments: true,
        },
      }),
    ]);

    return {
      data: invoices.map(invoice => ({ ...invoice, ...invoiceBalance(invoice) })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async createInvoice(data: {
    student_id: number;
    class_id?: number;
    total_amount?: number;
    discount_amount?: number;
    due_date?: Date;
    notes?: string;
    items: InvoiceItemInput[];
  }, actor: AcademicActor) {
    const pricing = validateInvoicePricing(data.items, data.discount_amount, data.total_amount);
    validateInvoiceDate(data.due_date);
    await this.assertStudentCollection(data.student_id, actor);
    if (data.class_id !== undefined) {
      if (!Number.isInteger(data.class_id) || data.class_id <= 0 || data.class_id > 2147483647) throw httpError('ID lớp không hợp lệ.', 400);
      const cls = await prisma.class.findFirst({ where: { id: data.class_id, ...classReadScope(actor) }, select: { id: true } });
      if (!cls) throw httpError('Không tìm thấy lớp trong phạm vi phụ trách.', 404);
    }

    return prisma.invoice.create({
      data: {
        invoice_no: code('INV'),
        student_id: data.student_id,
        class_id: data.class_id,
        total_amount: pricing.total_amount,
        discount_amount: pricing.discount_amount,
        due_date: data.due_date,
        notes: data.notes,
        items: {
          create: pricing.items,
        },
      },
      include: {
        student: { select: { id: true, full_name: true, email: true, phone: true } },
        class: { select: { id: true, name: true } },
        items: true,
        payments: true,
      },
    });
  }

  async createInvoiceFromClass(data: {
    class_id: number;
    student_id: number;
    due_date?: Date;
    discount_amount?: number;
    notes?: string;
    extra_items?: InvoiceItemInput[];
  }, actor: AcademicActor) {
    await this.assertStudentCollection(data.student_id, actor);
    this.validId(data.class_id);
    return withTenantTx(tx => createClassInvoice(tx, data));
  }

  async createInvoicesForClass(data: {
    class_id: number;
    student_ids?: number[];
    due_date?: Date;
    discount_amount?: number;
    notes?: string;
    extra_items?: InvoiceItemInput[];
  }, actor: AcademicActor) {
    if (!['admin', 'sale'].includes(actor.role)) throw httpError('Không có quyền tạo khoản phải thu.', 403);
    const template = await this.getClassFeeTemplate(data.class_id, actor);
    if (!template.items.length) throw httpError('Lớp chưa có học phí hoặc bảng phí.', 400);
    validateInvoiceDate(data.due_date);
    if (data.extra_items !== undefined && !Array.isArray(data.extra_items)) throw httpError('Danh sách khoản thu thêm không hợp lệ.', 400);
    validateInvoicePricing([...template.items, ...(data.extra_items ?? [])], data.discount_amount);

    const enrollments = await prisma.classEnrollment.findMany({
      where: {
        class_id: data.class_id,
        status: 'active',
        student: studentReadScope(actor),
        ...(data.student_ids?.length ? { student_id: { in: data.student_ids } } : {}),
      },
      include: { student: { select: { id: true, full_name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const created: unknown[] = [];
    if (data.student_ids?.some(id => !enrollments.some(item => item.student_id === id))) {
      throw httpError('Có học viên không thuộc lớp hoặc ngoài phạm vi phụ trách.', 403);
    }
    const skipped: Array<{ student_id: number; student_name?: string; reason: string }> = [];

    for (const enrollment of enrollments) {
      try {
        const invoice = await this.createInvoiceFromClass({
          class_id: data.class_id,
          student_id: enrollment.student_id,
          due_date: data.due_date,
          discount_amount: data.discount_amount,
          notes: data.notes || `Tạo hàng loạt từ lớp ${template.class.name}`,
          extra_items: data.extra_items,
        }, actor);
        created.push(invoice);
      } catch (error: any) {
        skipped.push({
          student_id: enrollment.student_id,
          student_name: enrollment.student.full_name,
          reason: error.message,
        });
      }
    }

    return {
      class: template.class,
      created,
      skipped,
    };
  }

  async recordPayment(invoiceId: number, data: {
    amount: number;
    method?: PaymentMethod;
    paid_at?: Date;
    reference_code?: string;
    received_by?: number;
    notes?: string;
  }, actor: AcademicActor) {
    if (!['admin', 'sale'].includes(actor.role)) throw httpError('Không có quyền ghi nhận thanh toán.', 403);
    if (data.reference_code !== undefined && (typeof data.reference_code !== 'string' || data.reference_code.length > 100))
      throw httpError('Mã giao dịch phải là chuỗi tối đa 100 ký tự.', 400);
    if (data.method && !Object.values(PaymentMethod).includes(data.method)) throw httpError('Phương thức thanh toán không hợp lệ.', 400);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0 || invoiceId > 2147483647 || !Number.isFinite(data.amount) || data.amount <= 0
        || data.amount > 9999999999999.99 || Math.abs(data.amount * 100 - moneyCents(data.amount)) > 0.000001) {
      throw httpError('Số tiền thanh toán phải lớn hơn 0 và có tối đa 2 chữ số thập phân.', 400);
    }
    const now = new Date();
    if (data.paid_at && (!Number.isFinite(data.paid_at.getTime()) || data.paid_at > now)) {
      throw httpError('Ngày thanh toán không hợp lệ hoặc ở tương lai.', 400);
    }

    return withTenantTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, ...this.readScope(actor) }, include: { payments: true } });
      if (!invoice) throw httpError('Không tìm thấy khoản phải thu.', 404);

      if (inactiveInvoiceStatuses.includes(invoice.status as typeof inactiveInvoiceStatuses[number])) {
        throw httpError('Không thể thu tiền cho khoản phải thu đã hủy hoặc hoàn tiền.', 400);
      }
      if (invoice.payments.some(payment => payment.paid_at > now)) {
        throw httpError('Khoản phải thu có giao dịch mang ngày tương lai. Vui lòng kiểm tra trước khi thu thêm.', 400);
      }
      const before = invoiceBalance(invoice, now);
      if (moneyCents(data.amount) > moneyCents(before.remaining_amount)) throw httpError('Số tiền thanh toán vượt quá số dư còn phải thu.', 400);

      const transaction = await tx.paymentTransaction.create({
        data: {
          invoice_id: invoiceId,
          amount: data.amount,
          method: data.method || 'cash',
          paid_at: data.paid_at || now,
          reference_code: data.reference_code,
          received_by: actor.userId,
          notes: data.notes,
        },
      });

      const status = invoiceBalance({ ...invoice, payments: [...invoice.payments, { amount: data.amount, paid_at: data.paid_at || now }] }, now).collection_status;
      await tx.invoice.update({ where: { id: invoiceId }, data: { status } });

      const receipt = await tx.receipt.create({
        data: {
          receipt_no: code('REC'),
          invoice_id: invoiceId,
          transaction_id: transaction.id,
          issued_by: actor.userId,
        },
      });

      return { transaction, receipt, invoice_status: status };
    });
  }

  async getDebts(actor: AcademicActor) {
    const invoices = await prisma.invoice.findMany({
      where: { AND: [this.readScope(actor)], status: { notIn: [...inactiveInvoiceStatuses] } },
      include: {
        student: { select: { id: true, full_name: true, email: true, phone: true } },
        class: { select: { id: true, name: true } },
        payments: true,
      },
      orderBy: [{ due_date: 'asc' }, { createdAt: 'desc' }],
    });

    const today = new Date();
    return invoices
      .map((invoice) => {
        const balance = invoiceBalance(invoice, today);
        return {
          invoice_id: invoice.id,
          invoice_no: invoice.invoice_no,
          student: invoice.student,
          class: invoice.class,
          total_amount: toNumber(invoice.total_amount),
          discount_amount: toNumber(invoice.discount_amount),
          ...balance,
          debt_amount: balance.remaining_amount,
          due_date: invoice.due_date,
          status: balance.collection_status,
        };
      })
      .filter((item) => item.debt_amount > 0)
      .sort((a, b) => {
        const rank: Record<string, number> = { overdue: 0, partial: 1, pending: 2 };
        return rank[a.collection_status] - rank[b.collection_status] || b.debt_amount - a.debt_amount;
      });
  }

  async getRevenueSummary(query: { from_date?: Date; to_date?: Date }, actor: AcademicActor) {
    const where: Prisma.PaymentTransactionWhereInput = { invoice: this.readScope(actor) };
    if (query.from_date || query.to_date) {
      where.paid_at = { gte: query.from_date, lte: query.to_date };
    }
    const transactions = await prisma.paymentTransaction.findMany({ where });
    return {
      total_revenue: transactions.reduce((sum, item) => sum + toNumber(item.amount), 0),
      transaction_count: transactions.length,
    };
  }
}

export const invoiceService = new InvoiceService();

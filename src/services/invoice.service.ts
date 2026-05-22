import { InvoiceStatus, PaymentMethod, Prisma } from '../generated/prisma';
import { prisma } from '../database/db';

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
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `${prefix}-${ymd}-${random}`;
};

export type InvoiceItemInput = {
  type?: 'tuition' | 'registration' | 'material' | 'exam' | 'other';
  description: string;
  amount: number;
};

export class InvoiceService {
  private payable(invoice: { total_amount: Prisma.Decimal; discount_amount: Prisma.Decimal }) {
    return Math.max(toNumber(invoice.total_amount) - toNumber(invoice.discount_amount), 0);
  }

  async getClassFeeTemplate(classId: number) {
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: true,
        feePlan: { include: { items: { orderBy: { sort_order: 'asc' } } } },
        classEnrollments: {
          where: { status: 'active' },
          include: { student: { select: { id: true, full_name: true, email: true, phone: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!classRecord) throw httpError('Class not found', 404);

    const feeItems: InvoiceItemInput[] = classRecord.feePlan?.items.length
      ? classRecord.feePlan.items.map((item) => ({
          type: item.type,
          description: item.description,
          amount: toNumber(item.amount),
        }))
      : classRecord.course?.fee
        ? [{
            type: 'tuition',
            description: `Học phí - ${classRecord.course.name}`,
            amount: toNumber(classRecord.course.fee),
          }]
        : [];

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
  }) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;
    const where: Prisma.InvoiceWhereInput = {};

    if (query.student_id) where.student_id = query.student_id;
    if (query.class_id) where.class_id = query.class_id;
    if (query.status) where.status = query.status;

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
      data: invoices.map((invoice) => {
        const paid = invoice.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
        const payable = this.payable(invoice);
        return {
          ...invoice,
          paid_amount: paid,
          remaining_amount: Math.max(payable - paid, 0),
        };
      }),
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
  }) {
    if (!data.items.length) throw httpError('Invoice must have at least one item', 400);
    const totalAmount = data.total_amount ?? data.items.reduce((sum, item) => sum + item.amount, 0);

    return prisma.invoice.create({
      data: {
        invoice_no: code('INV'),
        student_id: data.student_id,
        class_id: data.class_id,
        total_amount: totalAmount,
        discount_amount: data.discount_amount || 0,
        due_date: data.due_date,
        notes: data.notes,
        items: {
          create: data.items.map((item) => ({
            type: item.type || 'tuition',
            description: item.description,
            amount: item.amount,
          })),
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
  }) {
    const enrollment = await prisma.classEnrollment.findUnique({
      where: { class_id_student_id: { class_id: data.class_id, student_id: data.student_id } },
    });
    if (!enrollment || enrollment.status !== 'active') {
      throw httpError('Student is not actively enrolled in this class', 400);
    }

    const existing = await prisma.invoice.findFirst({
      where: {
        class_id: data.class_id,
        student_id: data.student_id,
        status: { notIn: ['cancelled', 'refunded'] },
      },
    });
    if (existing) throw httpError(`Active invoice already exists (${existing.invoice_no})`, 409);

    const template = await this.getClassFeeTemplate(data.class_id);
    if (!template.items.length) throw httpError('This class has no fee template', 400);

    const items = [...template.items, ...(data.extra_items || [])];
    return this.createInvoice({
      student_id: data.student_id,
      class_id: data.class_id,
      due_date: data.due_date,
      discount_amount: data.discount_amount,
      notes: data.notes || `Tạo từ lớp ${template.class.name}`,
      items,
    });
  }

  async createInvoicesForClass(data: {
    class_id: number;
    student_ids?: number[];
    due_date?: Date;
    discount_amount?: number;
    notes?: string;
    extra_items?: InvoiceItemInput[];
  }) {
    const template = await this.getClassFeeTemplate(data.class_id);
    if (!template.items.length) throw httpError('This class has no fee template', 400);

    const enrollments = await prisma.classEnrollment.findMany({
      where: {
        class_id: data.class_id,
        status: 'active',
        ...(data.student_ids?.length ? { student_id: { in: data.student_ids } } : {}),
      },
      include: { student: { select: { id: true, full_name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const created: unknown[] = [];
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
        });
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
  }) {
    if (data.amount <= 0) throw httpError('Payment amount must be greater than 0', 400);

    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
      if (!invoice) throw httpError('Invoice not found', 404);

      const paidBefore = invoice.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
      const payable = this.payable(invoice);
      if (paidBefore + data.amount > payable) throw httpError('Payment amount exceeds remaining balance', 400);

      const transaction = await tx.paymentTransaction.create({
        data: {
          invoice_id: invoiceId,
          amount: data.amount,
          method: data.method || 'cash',
          paid_at: data.paid_at || new Date(),
          reference_code: data.reference_code,
          received_by: data.received_by,
          notes: data.notes,
        },
      });

      const paidAfter = paidBefore + data.amount;
      const status: InvoiceStatus = paidAfter >= payable ? 'paid' : 'partial';
      await tx.invoice.update({ where: { id: invoiceId }, data: { status } });

      const receipt = await tx.receipt.create({
        data: {
          receipt_no: code('REC'),
          invoice_id: invoiceId,
          transaction_id: transaction.id,
          issued_by: data.received_by,
        },
      });

      return { transaction, receipt, invoice_status: status };
    });
  }

  async getDebts() {
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ['pending', 'partial', 'overdue'] } },
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
        const paid = invoice.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
        const payable = this.payable(invoice);
        const debt = Math.max(payable - paid, 0);
        return {
          invoice_id: invoice.id,
          invoice_no: invoice.invoice_no,
          student: invoice.student,
          class: invoice.class,
          total_amount: toNumber(invoice.total_amount),
          discount_amount: toNumber(invoice.discount_amount),
          paid_amount: paid,
          debt_amount: debt,
          due_date: invoice.due_date,
          status: invoice.due_date && invoice.due_date < today && debt > 0 ? 'overdue' : invoice.status,
        };
      })
      .filter((item) => item.debt_amount > 0);
  }

  async getRevenueSummary(query: { from_date?: Date; to_date?: Date }) {
    const where: Prisma.PaymentTransactionWhereInput = {};
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

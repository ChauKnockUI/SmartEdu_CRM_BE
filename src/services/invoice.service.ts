import { Prisma, InvoiceStatus, PaymentMethod } from '../generated/prisma';
import { prisma } from '../database/db';
import { ApiError } from '../utils/apiError';

type InvoiceItemInput = {
  type?: 'tuition' | 'registration' | 'material' | 'exam' | 'other';
  description: string;
  amount: number;
};

type CreateInvoiceInput = {
  student_id: number;
  class_id?: number;
  total_amount?: number;
  discount_amount?: number;
  due_date?: Date;
  notes?: string;
  items: InvoiceItemInput[];
};

type RecordPaymentInput = {
  amount: number;
  method?: PaymentMethod;
  paid_at?: Date;
  reference_code?: string;
  received_by?: number;
  notes?: string;
};

const toNumber = (value: Prisma.Decimal | number | null | undefined) => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
};

const getPayableAmount = (invoice: { total_amount: Prisma.Decimal; discount_amount: Prisma.Decimal }) => {
  return Math.max(toNumber(invoice.total_amount) - toNumber(invoice.discount_amount), 0);
};

const buildInvoiceNo = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `INV-${yyyy}${mm}${dd}-${random}`;
};

const buildReceiptNo = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `REC-${yyyy}${mm}${dd}-${random}`;
};

export class InvoiceService {
  async getInvoices(query: {
    page?: number;
    limit?: number;
    student_id?: number;
    class_id?: number;
    status?: InvoiceStatus;
    from_date?: Date;
    to_date?: Date;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {};
    if (query.student_id) where.student_id = query.student_id;
    if (query.class_id) where.class_id = query.class_id;
    if (query.status) where.status = query.status;
    if (query.from_date || query.to_date) {
      where.createdAt = {
        gte: query.from_date,
        lte: query.to_date,
      };
    }

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
        const payable = getPayableAmount(invoice);
        return {
          ...invoice,
          paid_amount: paid,
          remaining_amount: Math.max(payable - paid, 0),
        };
      }),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getInvoiceById(id: number) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, full_name: true, email: true, phone: true } },
        class: { select: { id: true, name: true } },
        items: true,
        payments: {
          include: {
            receiver: { select: { id: true, full_name: true, email: true } },
            receipts: true,
          },
          orderBy: { paid_at: 'desc' },
        },
        receipts: true,
      },
    });

    if (!invoice) throw new ApiError(404, 'Invoice not found');

    const paid = invoice.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const payable = getPayableAmount(invoice);
    return {
      ...invoice,
      paid_amount: paid,
      remaining_amount: Math.max(payable - paid, 0),
    };
  }

  async createInvoice(data: CreateInvoiceInput) {
    if (!data.items.length) throw new ApiError(400, 'Invoice must have at least one item');

    const student = await prisma.student.findUnique({ where: { id: data.student_id } });
    if (!student) throw new ApiError(404, 'Student not found');

    if (data.class_id) {
      const classRecord = await prisma.class.findUnique({ where: { id: data.class_id } });
      if (!classRecord) throw new ApiError(404, 'Class not found');
    }

    const itemsTotal = data.items.reduce((sum, item) => sum + item.amount, 0);
    const totalAmount = data.total_amount ?? itemsTotal;

    return prisma.invoice.create({
      data: {
        invoice_no: buildInvoiceNo(),
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
      },
    });
  }

  async recordPayment(invoiceId: number, data: RecordPaymentInput) {
    if (data.amount <= 0) throw new ApiError(400, 'Payment amount must be greater than 0');

    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      });

      if (!invoice) throw new ApiError(404, 'Invoice not found');
      if (['cancelled', 'refunded'].includes(invoice.status)) {
        throw new ApiError(400, 'Cannot record payment for cancelled or refunded invoice');
      }

      const paidBefore = invoice.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
      const payable = getPayableAmount(invoice);
      if (paidBefore + data.amount > payable) {
        throw new ApiError(400, 'Payment amount exceeds remaining balance');
      }

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

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status },
      });

      const receipt = await tx.receipt.create({
        data: {
          receipt_no: buildReceiptNo(),
          invoice_id: invoiceId,
          transaction_id: transaction.id,
          issued_by: data.received_by,
        },
      });

      return {
        transaction,
        receipt,
        invoice_status: status,
        paid_amount: paidAfter,
        remaining_amount: Math.max(payable - paidAfter, 0),
      };
    });
  }

  async cancelInvoice(invoiceId: number, notes?: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });

    if (!invoice) throw new ApiError(404, 'Invoice not found');
    if (invoice.payments.length > 0) {
      throw new ApiError(400, 'Cannot cancel invoice that already has payments');
    }

    return prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'cancelled', notes: notes || invoice.notes },
    });
  }

  async getStudentInvoices(studentId: number) {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new ApiError(404, 'Student not found');

    return this.getInvoices({ student_id: studentId, page: 1, limit: 100 });
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
        const payable = getPayableAmount(invoice);
        const debt = Math.max(payable - paid, 0);
        const isOverdue = !!invoice.due_date && invoice.due_date < today && debt > 0;

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
          status: isOverdue ? 'overdue' : invoice.status,
        };
      })
      .filter((row) => row.debt_amount > 0);
  }

  async getRevenueSummary(query: { from_date?: Date; to_date?: Date }) {
    const where: Prisma.PaymentTransactionWhereInput = {};
    if (query.from_date || query.to_date) {
      where.paid_at = {
        gte: query.from_date,
        lte: query.to_date,
      };
    }

    const transactions = await prisma.paymentTransaction.findMany({
      where,
      include: {
        invoice: {
          include: {
            class: { select: { id: true, name: true } },
            student: { select: { id: true, full_name: true } },
          },
        },
      },
    });

    const totalRevenue = transactions.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const byMethod = transactions.reduce<Record<string, number>>((acc, item) => {
      acc[item.method] = (acc[item.method] || 0) + toNumber(item.amount);
      return acc;
    }, {});

    return {
      total_revenue: totalRevenue,
      transaction_count: transactions.length,
      by_method: byMethod,
      recent_transactions: transactions
        .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime())
        .slice(0, 10),
    };
  }
}

export const invoiceService = new InvoiceService();

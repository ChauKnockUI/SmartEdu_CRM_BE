import { Prisma, type InvoiceStatus } from '../generated/prisma';

export const inactiveInvoiceStatuses = ['cancelled', 'refunded'] as const;
type Amount = Prisma.Decimal | number | string | null | undefined;
export interface BillingInvoice {
    total_amount: Amount; discount_amount?: Amount; status: string; due_date?: Date | string | null;
    payments?: { amount: Amount; paid_at?: Date | string }[];
}
export const moneyCents = (value: Amount) => Math.round(Number(value ?? 0) * 100);
export const vietnamBillingDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

export function invoiceBalance(invoice: BillingInvoice, now = new Date()): {
    payable_amount: number; paid_amount: number; remaining_amount: number; collection_status: InvoiceStatus; days_overdue: number;
} {
    const payable = Math.max(moneyCents(invoice.total_amount) - moneyCents(invoice.discount_amount), 0);
    const paid = (invoice.payments || []).filter(payment => !payment.paid_at || new Date(payment.paid_at).getTime() <= now.getTime())
        .reduce((total, payment) => total + moneyCents(payment.amount), 0);
    const inactive = inactiveInvoiceStatuses.includes(invoice.status as typeof inactiveInvoiceStatuses[number]);
    const remaining = inactive ? 0 : Math.max(payable - paid, 0);
    const dueDay = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : null;
    const days = dueDay ? Math.max(0, Math.round((Date.parse(vietnamBillingDay(now)) - Date.parse(dueDay)) / 86_400_000)) : 0;
    const status = inactive ? invoice.status as 'cancelled' | 'refunded' : remaining <= 0 ? 'paid'
        : days > 0 ? 'overdue' : paid > 0 ? 'partial' : 'pending';
    return { payable_amount: payable / 100, paid_amount: paid / 100, remaining_amount: remaining / 100,
        collection_status: status, days_overdue: remaining > 0 ? days : 0 };
}

export function studentBillingSummary(invoices: BillingInvoice[], now = new Date()) {
    const active = invoices.filter(invoice => !inactiveInvoiceStatuses.includes(invoice.status as typeof inactiveInvoiceStatuses[number]));
    const balances = active.map(invoice => invoiceBalance(invoice, now));
    const sum = (field: 'payable_amount' | 'paid_amount' | 'remaining_amount') => balances.reduce((total, item) => total + moneyCents(item[field]), 0) / 100;
    const remaining = sum('remaining_amount');
    const status = !active.length ? 'none' : remaining <= 0 ? 'paid' : balances.some(item => item.collection_status === 'overdue') ? 'overdue'
        : sum('paid_amount') > 0 ? 'partial' : 'pending';
    return { invoice_count: active.length, payable_amount: sum('payable_amount'), paid_amount: sum('paid_amount'),
        remaining_amount: remaining, overdue_amount: balances.filter(item => item.collection_status === 'overdue')
            .reduce((total, item) => total + moneyCents(item.remaining_amount), 0) / 100, status };
}

// Both student debt filters and invoice/debt queries use the same ledger expression (alias i).
export const invoiceRemainingSql = (tenantId: number, now: Date) => Prisma.sql`GREATEST(
    GREATEST(i.total_amount - COALESCE(i.discount_amount, 0), 0) - COALESCE((
        SELECT sum(p.amount) FROM payment_transactions p
         WHERE p.invoice_id = i.id AND p.tenant_id = ${tenantId} AND p.paid_at <= ${now}
    ), 0), 0)`;

import { InvoiceItemType } from '../generated/prisma';
import { moneyCents } from './billing';

const fail = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const MAX_CENTS = 999999999999999;
const amountCents = (value: unknown, label: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
        || Math.abs(value * 100 - moneyCents(value)) > 0.000001 || moneyCents(value) > MAX_CENTS)
        throw fail(`${label} phải là số không âm, trong giới hạn cho phép và có tối đa 2 chữ số thập phân.`);
    return moneyCents(value);
};

export function validateInvoicePricing(items: unknown, discount: unknown = 0, submittedTotal?: unknown) {
    if (!Array.isArray(items) || !items.length) throw fail('Khoản phải thu cần có ít nhất một khoản phí.');
    let total = 0;
    const normalized = items.map(item => {
        if (!item || typeof item.description !== 'string' || !item.description.trim() || item.description.trim().length > 255)
            throw fail('Mỗi khoản phí cần có nội dung từ 1 đến 255 ký tự.');
        const type = item.type ?? 'tuition';
        if (!Object.values(InvoiceItemType).includes(type)) throw fail('Loại khoản phí không hợp lệ.');
        const amount = amountCents(item.amount, 'Số tiền khoản phí');
        total += amount;
        if (total > MAX_CENTS) throw fail('Tổng khoản thu vượt giới hạn cho phép.');
        return { type: type as InvoiceItemType, description: item.description.trim(), amount: amount / 100 };
    });
    const discountCents = amountCents(discount ?? 0, 'Giảm giá');
    if (discountCents > total) throw fail('Giảm giá không được vượt tổng các khoản phí.');
    if (submittedTotal !== undefined && submittedTotal !== null && amountCents(submittedTotal, 'Tổng tiền') !== total)
        throw fail('Tổng tiền không khớp các khoản phí. Vui lòng kiểm tra lại.');
    return { items: normalized, total_amount: total / 100, discount_amount: discountCents / 100 };
}

export function validateInvoiceDate(value?: Date) {
    if (value && !Number.isFinite(value.getTime())) throw fail('Hạn thu không hợp lệ.');
}

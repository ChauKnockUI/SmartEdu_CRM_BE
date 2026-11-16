import type { ClassStatus } from '../generated/prisma';

export interface ClassDates {
    status: ClassStatus;
    start_date?: Date | string | null;
    end_date?: Date | string | null;
}

export const vietnamClassDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

// Class dates are PostgreSQL DATE values, represented by Prisma at UTC midnight.
export function classDateDay(value?: Date | string | null) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

export function effectiveClassStatus(record: ClassDates, now = new Date()): ClassStatus {
    if (!['upcoming', 'ongoing'].includes(record.status)) return record.status;
    const start = classDateDay(record.start_date);
    const end = classDateDay(record.end_date);
    // Do not invent a start date or automatically advance malformed legacy records.
    if (!start || (record.end_date && !end) || (end && end < start)) return record.status;
    const today = vietnamClassDay(now);
    if (end && today > end) return 'completed';
    if (record.status === 'upcoming' && today >= start) return 'ongoing';
    return record.status;
}

import type { Prisma } from '../generated/prisma';
import { vietnamClassDay } from './classStatus';
import { scheduleMoment } from './classScheduling';

export const attendanceAttentionStatuses = ['absent', 'late', 'excused'] as const;

export function summarizeAttendance(rows: { status?: string | null }[]) {
    let present = 0, late = 0, absent = 0, excused = 0;
    for (const row of rows) {
        if (row.status === 'present') present++;
        else if (row.status === 'late') late++;
        else if (row.status === 'absent') absent++;
        else if (row.status === 'excused') excused++;
    }
    const marked = present + late + absent + excused;
    return { present, late, absent, excused, marked, total: rows.length, unmarked: rows.length - marked,
        rate: marked ? Math.round((present + late) / marked * 1000) / 10 : null };
}

export function sessionHasEnded(row: { date: Date; end_time: Date | null }, now: Date) {
    return row.end_time ? scheduleMoment(row.date, row.end_time) <= now
        : row.date < new Date(`${vietnamClassDay(now)}T00:00:00Z`);
}

export function attendanceStatsScheduleWhere(now: Date): Prisma.ScheduleWhereInput {
    const day = new Date(`${vietnamClassDay(now)}T00:00:00Z`);
    const clock = new Date(Date.UTC(1970, 0, 1, (now.getUTCHours() + 7) % 24, now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
    return { status: { not: 'cancelled' }, class: { status: { not: 'cancelled' } },
        OR: [{ date: { lt: day } }, { date: day, end_time: { lte: clock } }],
    };
}

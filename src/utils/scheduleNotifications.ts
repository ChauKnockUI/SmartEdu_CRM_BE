import { NotificationType, type Prisma } from '../generated/prisma';
import type { AcademicActor } from './academicAccess';
import { scheduleMoment } from './classScheduling';
import { sessionJournal } from './sessionChanges';
import { vietnamClassDay } from './classStatus';

export function overdueAttendanceWhere(now: Date, teacherUserId?: number): Prisma.ScheduleWhereInput {
    const day = new Date(`${vietnamClassDay(now)}T00:00:00Z`);
    const clock = new Date(Date.UTC(1970, 0, 1, (now.getUTCHours() + 7) % 24, now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
    return { status: { not: 'cancelled' }, attendances: { none: {} }, start_time: { not: null }, end_time: { not: null },
        class: { status: { not: 'cancelled' }, classEnrollments: { some: { status: 'active' } } },
        teacher: { ...(teacherUserId ? { user_id: teacherUserId } : {}), user: { is_active: true, role: 'teacher' } },
        OR: [{ date: { lt: day } }, { date: day, end_time: { lte: clock } }],
    };
}

export const attendanceNotificationTypes = [NotificationType.attendance_reminder, NotificationType.overdue_attendance];
export type ReminderSession = {
    id: number; date: Date; start_time: Date | null; end_time: Date | null; teacher_id: number | null; memo?: string | null;
    is_attendance_unlocked?: boolean;
    teacher?: { user_id: number | null; user?: { is_active: boolean; role: string } | null } | null;
    class?: { status: string; _count?: { classEnrollments: number } } | null;
    _count: { attendances: number };
};
export const sessionNotificationVersion = (row: Pick<ReminderSession, 'date' | 'start_time' | 'end_time' | 'teacher_id' | 'memo'>) => JSON.stringify([
    row.date.toISOString().slice(0, 10), row.start_time?.toISOString().slice(11, 19), row.end_time?.toISOString().slice(11, 19),
    row.teacher_id, sessionJournal(row.memo).history.length,
]);

export function attendanceReminderState(row: ReminderSession & { status: string }, now = new Date()) {
    const start = row.start_time ? scheduleMoment(row.date, row.start_time) : null;
    const end = row.end_time ? scheduleMoment(row.date, row.end_time) : null;
    const reason = row.status === 'cancelled' || row.class?.status === 'cancelled' ? 'Buổi học hoặc lớp đã hủy/nghỉ.'
        : row._count.attendances ? 'Buổi học đã được điểm danh.'
        : !start || !end || end <= start ? 'Buổi học chưa có ngày và giờ hợp lệ.'
        : now < start ? 'Buổi học chưa bắt đầu, chưa cần nhắc điểm danh.'
        : !row.teacher?.user_id || !row.teacher.user?.is_active || row.teacher.user.role !== 'teacher' ? 'Giảng viên chưa có tài khoản đang hoạt động.'
        : !row.class?._count?.classEnrollments ? 'Buổi học chưa có học viên đang ghi danh.' : '';
    return { reason, overdue: !!end && now >= end, start, end };
}

export const notificationMetadata = (value: Prisma.JsonValue | null) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};

export function notificationSessionId(item: { metadata: Prisma.JsonValue | null; link: string | null }) {
    const meta = notificationMetadata(item.metadata);
    const id = meta.schedule_id ?? meta.scheduleId ?? item.link?.match(/^\/lms\/sessions\/(\d+)\/?$/)?.[1];
    if (typeof id !== 'number' && (typeof id !== 'string' || !/^\d+$/.test(id))) return undefined;
    const number = Number(id);
    return Number.isInteger(number) && number > 0 && number <= 2147483647 ? number : undefined;
}

export function obsoleteSessionNotification(item: { type: NotificationType; metadata: Prisma.JsonValue | null },
    row: (ReminderSession & { status: string }) | undefined, actor: AcademicActor, now = new Date()) {
    if (!row) return 'Buổi học không còn trong phạm vi được xem.';
    const meta = notificationMetadata(item.metadata);
    if (meta.version && meta.version !== sessionNotificationVersion(row)) return 'Lịch buổi học đã được cập nhật.';
    const unlock = meta.kind === 'attendance_unlock_request' || (meta.scheduleId && !meta.schedule_id);
    if (unlock) {
        const start = row.start_time ? scheduleMoment(row.date, row.start_time) : null;
        return actor.role !== 'admin' || row.is_attendance_unlocked || row.status === 'cancelled' || row.class?.status === 'cancelled'
            || !start || now.getTime() - start.getTime() <= 48 * 3600000
            ? 'Yêu cầu mở điểm danh này không còn cần xử lý.' : '';
    }
    if (attendanceNotificationTypes.includes(item.type as typeof attendanceNotificationTypes[number])) {
        if (actor.role !== 'teacher' || row.teacher?.user_id !== actor.userId) return 'Buổi học đã thay đổi giáo viên phụ trách.';
        return attendanceReminderState(row, now).reason;
    }
    return row.class?.status === 'cancelled' ? 'Lớp học đã hủy.' : '';
}

export async function archiveAttendanceNotifications(tx: Prisma.TransactionClient, scheduleId: number) {
    await tx.notification.updateMany({ where: { type: { in: attendanceNotificationTypes }, OR: [
        { metadata: { path: ['schedule_id'], equals: scheduleId } }, { metadata: { path: ['scheduleId'], equals: scheduleId } },
    ] }, data: { is_read: true, link: null } });
}

export async function archiveUnlockNotifications(tx: Prisma.TransactionClient, scheduleId: number) {
    await tx.notification.updateMany({ where: { OR: [
        { AND: [{ metadata: { path: ['schedule_id'], equals: scheduleId } }, { metadata: { path: ['kind'], equals: 'attendance_unlock_request' } }] },
        { metadata: { path: ['scheduleId'], equals: scheduleId } },
    ] }, data: { is_read: true, link: null } });
}

export async function notifySessionChange(tx: Prisma.TransactionClient, row: {
    id: number; class_id: number | null; teacher_id: number | null; room_id: number | null; date: Date;
    start_time: Date | null; end_time: Date | null; memo: string | null;
}, className: string, action: 'cancel' | 'makeup', reason: string, actorId: number) {
    await archiveAttendanceNotifications(tx, row.id);
    await tx.notification.updateMany({ where: { metadata: { path: ['schedule_id'], equals: row.id },
        OR: [{ metadata: { path: ['kind'], equals: 'session_cancel' } }, { metadata: { path: ['kind'], equals: 'session_makeup' } }],
    }, data: { is_read: true, link: null } });
    const users = await tx.user.findMany({ where: { is_active: true, id: { not: actorId }, OR: [
        { role: 'admin' }, ...(row.teacher_id ? [{ role: 'teacher' as const, teacher: { id: row.teacher_id } }] : []),
        { role: 'student', student: { classEnrollments: { some: { class_id: row.class_id!, status: 'active' } } } },
    ] }, select: { id: true } });
    const ids = [...new Set(users.map(user => user.id))];
    if (!ids.length) return;
    const date = row.date.toISOString().slice(0, 10).split('-').reverse().join('/');
    const time = row.start_time && row.end_time ? `, ${row.start_time.toISOString().slice(11, 16)}–${row.end_time.toISOString().slice(11, 16)}` : '';
    const room = row.room_id ? await tx.room.findFirst({ where: { id: row.room_id }, select: { name: true } }) : null;
    const title = `${action === 'cancel' ? 'Nghỉ buổi học' : 'Lịch học bù'}: ${className}`.slice(0, 255);
    const message = action === 'cancel'
        ? `Buổi học lớp ${className} ngày ${date}${time} được báo nghỉ. Lý do: ${reason}. Lịch học bù sẽ được cập nhật sau.`
        : `Lớp ${className} học bù vào ${date}${time}${room ? `, phòng ${room.name}` : ''}. Lý do: ${reason}. Vui lòng kiểm tra lịch học mới.`;
    await tx.notification.createMany({ data: ids.map(user_id => ({ user_id, type: NotificationType.general,
        title, message, link: `/lms/sessions/${row.id}`, metadata: { kind: `session_${action}`, schedule_id: row.id,
            class_id: row.class_id, version: sessionNotificationVersion(row) } })) });
}

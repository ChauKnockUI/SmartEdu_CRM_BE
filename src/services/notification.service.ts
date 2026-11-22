import { prisma, withTenantTx } from '../database/db';
import { NotificationType, Prisma } from '../generated/prisma';
import { scheduleReadScope, type AcademicActor } from '../utils/academicAccess';
import { attendanceAccess } from '../utils/attendanceAccess';
import { attendanceNotificationTypes, attendanceReminderState, notificationMetadata, notificationSessionId,
    obsoleteSessionNotification, sessionNotificationVersion, overdueAttendanceWhere } from '../utils/scheduleNotifications';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2147483647;
const sessionInclude = {
    teacher: { include: { user: { select: { is_active: true, role: true } } } },
    class: { select: { name: true, status: true, _count: { select: { classEnrollments: { where: { status: 'active' } } } } } },
    _count: { select: { attendances: true } },
} as const;

export class NotificationService {
    async getForUser(actor: AcademicActor, limit = 30) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Số thông báo mỗi lần phải từ 1 đến 100.');
        return withTenantTx(async tx => {
            const notifications = await tx.notification.findMany({ where: { user_id: actor.userId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
            // Include older unread reminders so the badge does not retain obsolete tasks outside the first page.
            const unread = await tx.notification.findMany({ where: { user_id: actor.userId, is_read: false,
                OR: [{ type: { in: attendanceNotificationTypes } }, { link: { startsWith: '/lms/sessions/' } }] } });
            const candidates = [...new Map([...notifications, ...unread].map(item => [item.id, item])).values()];
            const ids = [...new Set(candidates.map(notificationSessionId).filter((id): id is number => !!id))];
            const sessions = ids.length ? await tx.schedule.findMany({ where: { id: { in: ids }, AND: [scheduleReadScope(actor)] }, include: sessionInclude }) : [];
            const byId = new Map(sessions.map(item => [item.id, item]));
            const obsolete = new Map<number, string>();
            const now = new Date();
            for (const item of candidates) {
                const id = notificationSessionId(item);
                if (!id) continue;
                const reason = obsoleteSessionNotification(item, byId.get(id), actor, now);
                if (reason) obsolete.set(item.id, reason);
            }
            if (obsolete.size) await tx.notification.updateMany({ where: { user_id: actor.userId, id: { in: [...obsolete.keys()] } },
                data: { is_read: true, link: null } });
            const unreadCount = await tx.notification.count({ where: { user_id: actor.userId, is_read: false } });
            return { notifications: notifications.map(item => obsolete.has(item.id)
                ? { ...item, is_read: true, link: null, message: `${obsolete.get(item.id)} ${item.message}` } : item), unreadCount };
        });
    }

    async markAsRead(id: number, user_id: number) {
        if (!validId(id)) throw fail('ID thông báo không hợp lệ.');
        const result = await prisma.notification.updateMany({ where: { id, user_id, is_read: false }, data: { is_read: true } });
        if (!result.count && !await prisma.notification.findFirst({ where: { id, user_id }, select: { id: true } }))
            throw fail('Không tìm thấy thông báo.', 404);
        return { already_read: result.count === 0 };
    }

    async markAllAsRead(user_id: number) {
        await prisma.notification.updateMany({ where: { user_id, is_read: false }, data: { is_read: true } });
        return { success: true };
    }

    async create(data: { user_id: number; type: NotificationType; title: string; message: string; link?: string; metadata?: object }) {
        return prisma.notification.create({ data: { ...data, title: data.title.slice(0, 255),
            metadata: data.metadata as Prisma.InputJsonValue | undefined, link: data.link || null } });
    }

    async remindAttendance(scheduleId: number, overdueOnly = false) {
        if (!validId(scheduleId)) throw fail('ID buổi học không hợp lệ.');
        return withTenantTx(async tx => {
            // Same row lock as attendance and session changes: recheck before creating a notification.
            await tx.$queryRaw`SELECT id FROM schedules WHERE id = ${scheduleId} FOR UPDATE`;
            const row = await tx.schedule.findUnique({ where: { id: scheduleId }, include: sessionInclude });
            if (!row) throw fail('Không tìm thấy buổi học.', 404);
            const now = new Date();
            const state = attendanceReminderState(row, now);
            if (state.reason) return { sent: false, reason: state.reason };
            if (overdueOnly && !state.overdue) return { sent: false, reason: 'Buổi học chưa kết thúc.' };
            const teacherUserId = row.teacher!.user_id!;
            const version = sessionNotificationVersion(row);
            const recent = await tx.notification.findFirst({ where: { user_id: teacherUserId,
                type: { in: attendanceNotificationTypes }, createdAt: { gte: new Date(now.getTime() - 24 * 3600000) }, AND: [
                    { metadata: { path: ['kind'], equals: 'attendance_reminder' } },
                    { metadata: { path: ['schedule_id'], equals: scheduleId } }, { metadata: { path: ['version'], equals: version } },
                ] }, select: { id: true } });
            if (recent) return { sent: false, duplicate: true, reason: 'Buổi học này đã được nhắc trong 24 giờ qua; không gửi thêm thông báo trùng.' };
            const date = row.date.toISOString().slice(0, 10).split('-').reverse().join('/');
            const time = `${row.start_time!.toISOString().slice(11, 16)}–${row.end_time!.toISOString().slice(11, 16)}`;
            const className = row.class!.name;
            await tx.notification.create({ data: { user_id: teacherUserId,
                type: state.overdue ? NotificationType.overdue_attendance : NotificationType.attendance_reminder,
                title: `${state.overdue ? 'Chưa điểm danh sau buổi học' : 'Nhắc điểm danh'}: ${className}`.slice(0, 255),
                message: `Buổi học lớp ${className} ngày ${date}, ${time} ${state.overdue ? 'đã kết thúc nhưng chưa có điểm danh' : 'chưa có điểm danh'}. Vui lòng hoàn tất điểm danh.`,
                link: `/lms/sessions/${row.id}`, metadata: { kind: 'attendance_reminder', schedule_id: row.id,
                    class_id: row.class_id, teacher_id: row.teacher_id, version, is_overdue: state.overdue },
            } });
            return { sent: true, teacher_name: row.teacher!.full_name, class_name: className, schedule_date: date };
        });
    }

    async requestAttendanceUnlock(scheduleId: number, actor: AcademicActor) {
        if (!validId(scheduleId)) throw fail('ID buổi học không hợp lệ.');
        return withTenantTx(async tx => {
            await tx.$queryRaw`SELECT id FROM schedules WHERE id = ${scheduleId} FOR UPDATE`;
            const row = await tx.schedule.findUnique({ where: { id: scheduleId }, include: sessionInclude });
            if (!row) throw fail('Buổi học không tồn tại.', 404);
            const access = attendanceAccess(row, actor.userId, actor.role);
            if (!access.canRequestUnlock) throw fail(access.blockReason || 'Buổi học hiện không cần yêu cầu mở khóa.', 403);
            const admins = await tx.user.findMany({ where: { role: 'admin', is_active: true }, select: { id: true } });
            if (!admins.length) throw fail('Trung tâm chưa có Admin đang hoạt động để nhận yêu cầu.');
            const version = sessionNotificationVersion(row);
            const recent = await tx.notification.findMany({ where: { user_id: { in: admins.map(user => user.id) },
                link: { not: null }, createdAt: { gte: new Date(Date.now() - 24 * 3600000) }, AND: [
                    { metadata: { path: ['kind'], equals: 'attendance_unlock_request' } },
                    { metadata: { path: ['schedule_id'], equals: row.id } }, { metadata: { path: ['version'], equals: version } },
                ] }, select: { user_id: true } });
            const alreadySent = new Set(recent.map(item => item.user_id));
            const recipients = admins.filter(user => !alreadySent.has(user.id));
            const className = row.class?.name || 'Lớp học';
            const date = row.date.toISOString().slice(0, 10).split('-').reverse().join('/');
            if (recipients.length) await tx.notification.createMany({ data: recipients.map(user => ({ user_id: user.id,
                type: NotificationType.attendance_reminder, title: `Yêu cầu mở điểm danh: ${className}`.slice(0, 255),
                message: `${row.teacher?.full_name || 'Giảng viên'} yêu cầu mở khóa điểm danh lớp ${className} ngày ${date}.`,
                link: `/lms/sessions/${row.id}`, metadata: { kind: 'attendance_unlock_request', schedule_id: row.id, version },
            })) });
            return { sent: recipients.length, duplicate: !recipients.length };
        });
    }

    async remindAllOverdue() {
        const now = new Date();
        const where = overdueAttendanceWhere(now);
        const total = await prisma.schedule.count({ where });
        const recent = await prisma.notification.findMany({ where: { type: { in: attendanceNotificationTypes },
            createdAt: { gte: new Date(now.getTime() - 24 * 3600000) }, metadata: { path: ['kind'], equals: 'attendance_reminder' } },
            select: { user_id: true, metadata: true } });
        const reminded = new Set(recent.map(item => `${notificationMetadata(item.metadata).schedule_id}:${item.user_id}:${notificationMetadata(item.metadata).version}`));
        let sent = 0, skipped = 0, scanned = 0;
        const details: { schedule_id: number; class_name: string; sent: boolean; reason?: string }[] = [];
        // Scan beyond already-reminded rows; cap newly sent notifications at 100 per request.
        while (scanned < total && sent < 100) {
            const rows = await prisma.schedule.findMany({ where, skip: scanned, take: 100,
                orderBy: [{ date: 'asc' }, { id: 'asc' }], include: sessionInclude });
            if (!rows.length) break;
            for (const row of rows) {
                scanned++;
                const key = `${row.id}:${row.teacher?.user_id}:${sessionNotificationVersion(row)}`;
                const result = reminded.has(key) ? { sent: false, reason: 'Đã nhắc trong 24 giờ qua.' } : await this.remindAttendance(row.id, true);
                if (result.sent) { sent++; reminded.add(key); } else skipped++;
                if (details.length < 100) details.push({ schedule_id: row.id, class_name: row.class?.name || 'Buổi học', ...result });
                if (sent >= 100) break;
            }
        }
        return { total_overdue: total, sent, skipped, remaining: Math.max(0, total - scanned), details };
    }

    async deleteOld(days = 30) {
        const { count } = await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400000) }, is_read: true } });
        return { deleted: count };
    }
}

export const notificationService = new NotificationService();

import { prisma } from '../database/db';
import { NotificationType } from '../generated/prisma';

export class NotificationService {
    /**
     * Lấy danh sách thông báo của user (kèm số lượng chưa đọc)
     */
    async getForUser(user_id: number, limit = 30) {
        const [notifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where: { user_id },
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            prisma.notification.count({
                where: { user_id, is_read: false },
            }),
        ]);

        return { notifications, unreadCount };
    }

    /**
     * Đánh dấu đã đọc một thông báo
     */
    async markAsRead(id: number, user_id: number) {
        const notif = await prisma.notification.findFirst({
            where: { id, user_id },
        });

        if (!notif) {
            const err = new Error('Không tìm thấy thông báo');
            (err as any).statusCode = 404;
            throw err;
        }

        return prisma.notification.update({
            where: { id },
            data: { is_read: true },
        });
    }

    /**
     * Đánh dấu tất cả đã đọc cho user
     */
    async markAllAsRead(user_id: number) {
        await prisma.notification.updateMany({
            where: { user_id, is_read: false },
            data: { is_read: true },
        });
        return { success: true };
    }

    /**
     * Tạo thông báo mới (nội bộ)
     */
    async create(data: {
        user_id: number;
        type: NotificationType;
        title: string;
        message: string;
        link?: string;
        metadata?: object;
    }) {
        return prisma.notification.create({
            data: {
                user_id: data.user_id,
                type: data.type,
                title: data.title,
                message: data.message,
                link: data.link || null,
                metadata: data.metadata ? (data.metadata as any) : undefined,
            },
        });
    }

    /**
     * Gửi nhắc điểm danh cho 1 ca học cụ thể
     * Tìm giảng viên phụ trách ca đó và tạo thông báo
     */
    async remindAttendance(schedule_id: number): Promise<{
        sent: boolean;
        teacher_name?: string;
        schedule_date?: string;
        class_name?: string;
        reason?: string;
    }> {
        const schedule = await prisma.schedule.findUnique({
            where: { id: schedule_id },
            include: {
                class: {
                    include: {
                        teacher: {
                            include: { user: true }
                        }
                    }
                },
                teacher: {
                    include: { user: true }
                },
                attendances: { select: { id: true } },
            },
        });

        if (!schedule) {
            const err = new Error('Không tìm thấy buổi học');
            (err as any).statusCode = 404;
            throw err;
        }

        if (schedule.status === 'cancelled') {
            return { sent: false, reason: 'Buổi học đã bị hủy' };
        }

        if (schedule.attendances.length > 0) {
            return { sent: false, reason: 'Buổi học đã được điểm danh' };
        }

        // Tìm giảng viên phụ trách
        const teacher = schedule.teacher || schedule.class?.teacher;
        if (!teacher) {
            return { sent: false, reason: 'Buổi học chưa có giảng viên phụ trách' };
        }

        const teacherUserId = teacher.user_id;
        if (!teacherUserId) {
            return { sent: false, reason: 'Giảng viên chưa có tài khoản hệ thống' };
        }

        // Kiểm tra buổi học đã qua chưa
        const scheduleDate = new Date(schedule.date);
        const now = new Date();

        // So sánh theo ngày (UTC)
        const scheduleDateStr = scheduleDate.toISOString().split('T')[0];
        const todayStr = now.toISOString().split('T')[0];

        const isOverdue = scheduleDateStr < todayStr || (
            scheduleDateStr === todayStr &&
            schedule.end_time &&
            schedule.end_time < now
        );

        const dateVN = scheduleDate.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
        const className = schedule.class?.name || 'Lớp học';
        const timeStr = schedule.start_time
            ? schedule.start_time.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || ''
            : '';

        await this.create({
            user_id: teacherUserId,
            type: isOverdue ? NotificationType.overdue_attendance : NotificationType.attendance_reminder,
            title: isOverdue
                ? `⚠️ Cần điểm danh gấp: ${className}`
                : `🔔 Nhắc nhở điểm danh: ${className}`,
            message: isOverdue
                ? `Buổi học ${dateVN}${timeStr ? ` lúc ${timeStr}` : ''} của lớp ${className} đã kết thúc nhưng chưa được điểm danh. Vui lòng hoàn tất điểm danh ngay.`
                : `Buổi học ${dateVN}${timeStr ? ` lúc ${timeStr}` : ''} của lớp ${className} sắp đến. Vui lòng nhớ điểm danh sau khi giảng dạy.`,
            link: `/lms/sessions/${schedule_id}`,
            metadata: {
                schedule_id,
                class_id: schedule.class_id,
                teacher_id: teacher.id,
                is_overdue: isOverdue,
            },
        });

        return {
            sent: true,
            teacher_name: teacher.full_name,
            schedule_date: dateVN,
            class_name: className,
        };
    }

    /**
     * Quét tất cả buổi học quá hạn chưa điểm danh và gửi nhắc tất cả cùng lúc
     */
    async remindAllOverdue(): Promise<{
        total_overdue: number;
        sent: number;
        skipped: number;
        details: { schedule_id: number; class_name: string; reason?: string; sent: boolean }[];
    }> {
        const now = new Date();
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);

        // Tìm tất cả ca học đã qua mà chưa điểm danh
        const overdueSchedules = await prisma.schedule.findMany({
            where: {
                status: { not: 'cancelled' },
                date: { lte: now },
                attendances: { none: {} },
            },
            include: {
                class: {
                    include: {
                        teacher: { include: { user: true } }
                    }
                },
                teacher: { include: { user: true } },
            },
            orderBy: { date: 'desc' },
            take: 100, // Giới hạn an toàn
        });

        const details: { schedule_id: number; class_name: string; reason?: string; sent: boolean }[] = [];
        let sent = 0;
        let skipped = 0;

        // Tránh spam: chỉ gửi nếu chưa có thông báo tương tự trong 24h qua
        const recentNotifs = await prisma.notification.findMany({
            where: {
                type: { in: [NotificationType.overdue_attendance, NotificationType.attendance_reminder] },
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            select: { metadata: true },
        });

        // Danh sách schedule_id đã nhắc trong 24h
        const alreadyRemindedIds = new Set<number>(
            recentNotifs
                .map((n) => (n.metadata as any)?.schedule_id)
                .filter(Boolean)
        );

        for (const schedule of overdueSchedules) {
            const className = schedule.class?.name || `Schedule #${schedule.id}`;

            if (alreadyRemindedIds.has(schedule.id)) {
                details.push({ schedule_id: schedule.id, class_name: className, reason: 'Đã nhắc trong 24h qua', sent: false });
                skipped++;
                continue;
            }

            const result = await this.remindAttendance(schedule.id);

            if (result.sent) {
                sent++;
                details.push({ schedule_id: schedule.id, class_name: className, sent: true });
            } else {
                skipped++;
                details.push({ schedule_id: schedule.id, class_name: className, reason: result.reason, sent: false });
            }
        }

        return {
            total_overdue: overdueSchedules.length,
            sent,
            skipped,
            details,
        };
    }

    /**
     * Xóa thông báo cũ (cleanup)
     */
    async deleteOld(days = 30) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const { count } = await prisma.notification.deleteMany({
            where: {
                createdAt: { lt: cutoff },
                is_read: true,
            },
        });
        return { deleted: count };
    }
}

export const notificationService = new NotificationService();

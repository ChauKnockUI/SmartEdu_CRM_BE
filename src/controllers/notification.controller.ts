import { Request, Response } from 'express';
import { notificationService } from '../services/notification.service';

export class NotificationController {
    /**
     * GET /notifications
     * Lấy danh sách thông báo của user đang đăng nhập
     */
    async getMyNotifications(req: Request, res: Response) {
        try {
            const user_id = (req as any).user?.userId;
            if (!user_id) {
                return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập' });
            }

            const limit = req.query.limit ? Number(req.query.limit) : 30;
            const result = await notificationService.getForUser(user_id, limit);

            return res.status(200).json({
                success: true,
                data: result.notifications,
                unread_count: result.unreadCount,
            });
        } catch (error: any) {
            console.error('[NotificationController] getMyNotifications error:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * PUT /notifications/:id/read
     * Đánh dấu đã đọc một thông báo
     */
    async markAsRead(req: Request, res: Response) {
        try {
            const user_id = (req as any).user?.userId;
            const id = Number(req.params.id);

            if (!user_id) {
                return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập' });
            }

            if (isNaN(id)) {
                return res.status(400).json({ success: false, message: 'ID thông báo không hợp lệ' });
            }

            await notificationService.markAsRead(id, user_id);

            return res.status(200).json({ success: true, message: 'Đã đánh dấu đọc' });
        } catch (error: any) {
            console.error('[NotificationController] markAsRead error:', error);
            return res.status(error.statusCode || 500).json({ success: false, message: error.message });
        }
    }

    /**
     * PUT /notifications/read-all
     * Đánh dấu tất cả thông báo là đã đọc
     */
    async markAllAsRead(req: Request, res: Response) {
        try {
            const user_id = (req as any).user?.userId;
            if (!user_id) {
                return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập' });
            }

            await notificationService.markAllAsRead(user_id);

            return res.status(200).json({ success: true, message: 'Đã đánh dấu tất cả là đã đọc' });
        } catch (error: any) {
            console.error('[NotificationController] markAllAsRead error:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * POST /notifications/remind-schedule/:scheduleId
     * Admin/Quản lý gửi thông báo nhắc nhở giảng viên điểm danh ca học
     */
    async remindSchedule(req: Request, res: Response) {
        try {
            const scheduleId = Number(req.params.scheduleId);
            if (isNaN(scheduleId)) {
                return res.status(400).json({ success: false, message: 'Mã buổi học không hợp lệ' });
            }

            const result = await notificationService.remindAttendance(scheduleId);
            if (!result.sent) {
                return res.status(400).json({
                    success: false,
                    message: result.reason || 'Không thể gửi thông báo nhắc điểm danh',
                });
            }

            return res.status(200).json({
                success: true,
                message: `Đã gửi thông báo nhắc điểm danh tới giáo viên ${result.teacher_name || ''} cho lớp ${result.class_name || ''}`,
                data: result,
            });
        } catch (error: any) {
            console.error('[NotificationController] remindSchedule error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Lỗi gửi nhắc điểm danh',
            });
        }
    }

    /**
     * POST /notifications/remind-overdue
     * Admin quét và gửi thông báo nhắc tất cả các ca học quá hạn chưa điểm danh
     */
    async remindAllOverdue(req: Request, res: Response) {
        try {
            const result = await notificationService.remindAllOverdue();
            return res.status(200).json({
                success: true,
                message: `Đã xử lý nhắc điểm danh: gửi ${result.sent} thông báo, bỏ qua ${result.skipped}`,
                data: result,
            });
        } catch (error: any) {
            console.error('[NotificationController] remindAllOverdue error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Lỗi quét và nhắc điểm danh quá hạn',
            });
        }
    }
}

export const notificationController = new NotificationController();

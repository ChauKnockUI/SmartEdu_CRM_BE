import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả endpoints đều yêu cầu đăng nhập
router.use(authenticate);

// Thông báo cá nhân
router.get('/', notificationController.getMyNotifications);
router.put('/read-all', notificationController.markAllAsRead);
router.put('/:id/read', notificationController.markAsRead);

// Nhắc điểm danh (Chỉ admin và manager/teacher phụ trách)
router.post(
    '/remind-schedule/:scheduleId',
    authorize('admin'),
    notificationController.remindSchedule
);

router.post(
    '/remind-overdue',
    authorize('admin'),
    notificationController.remindAllOverdue
);

export default router;

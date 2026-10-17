import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

router.get('/', scheduleController.getAllSchedules);
router.get('/my/schedules', scheduleController.getMySchedules);
router.get('/class/:classId', scheduleController.getByClass);
router.patch(
    '/:id/attendance',
    authorize('admin', 'teacher'),
    scheduleController.updateAttendance
);

// Nhắc điểm danh ca học
router.post(
    '/:scheduleId/remind-attendance',
    authorize('admin'),
    notificationController.remindSchedule
);

// Quét và nhắc tất cả các ca học quá hạn chưa điểm danh
router.post(
    '/remind-overdue',
    authorize('admin'),
    notificationController.remindAllOverdue
);

export default router;

import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

router.get('/my/schedules', scheduleController.getMySchedules);

router.patch(
    '/:id/attendance',
    authorize('admin', 'teacher'),
    scheduleController.updateAttendance
);

export default router;

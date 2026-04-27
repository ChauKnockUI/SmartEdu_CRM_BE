import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

// API Điểm danh (Chỉ admin hoặc giáo viên được phép)
// Trong service đã có check logic user có phải là giáo viên của lớp hay không
router.post('/:id/attendance', authorize('admin', 'teacher'), scheduleController.updateAttendance);

export default router;

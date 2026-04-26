import { Router } from 'express';
import { teacherController } from '../controllers/teacher.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

// Tìm giáo viên rảnh rỗi (Không bị trùng lịch)
router.get('/available', teacherController.getAvailableTeachers);

export default router;

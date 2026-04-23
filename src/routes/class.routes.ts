import { Router } from 'express';
import { classController } from '../controllers/class.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

// Lấy danh sách lớp học (có phân trang, search, filter status, course, teacher)
router.get('/', classController.getClasses);

// Lấy chi tiết lớp học
router.get('/:id', classController.getClassById);

// ─── Các API sửa đổi dữ liệu cần Role Admin ────────────────────────────────

// Tạo lớp học mới
router.post('/', authorize('admin'), classController.createClass);

// Cập nhật thông tin lớp học
router.put('/:id', authorize('admin'), classController.updateClass);

export default router;

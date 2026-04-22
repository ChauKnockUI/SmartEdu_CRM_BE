import { Router } from 'express';
import { courseController } from '../controllers/course.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

// Lấy danh sách khóa học (có phân trang, search) - Bất kỳ role nào đã đăng nhập đều xem được
router.get('/', courseController.getCourses);

// Lấy chi tiết khóa học
router.get('/:id', courseController.getCourseById);

// ─── Các API sửa đổi dữ liệu cần Role Admin ────────────────────────────────

// Tạo khóa học mới
router.post('/', authorize('admin'), courseController.createCourse);

// Cập nhật thông tin khóa học
router.put('/:id', authorize('admin'), courseController.updateCourse);

// Xóa khóa học (Soft delete)
router.delete('/:id', authorize('admin'), courseController.deleteCourse);

export default router;

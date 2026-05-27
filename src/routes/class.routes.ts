import { Router } from 'express';
import { classController } from '../controllers/class.controller';
import { assignmentController } from '../controllers/assignment.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

// Lấy danh sách lớp học (có phân trang, search, filter status, course, teacher)
router.get('/', classController.getClasses);

// Lấy danh sách lớp của tôi
router.get('/my/classes', classController.getMyClasses);
// Lấy chi tiết lớp học
router.get('/:id', classController.getClassById);

router.get('/:classId/assignments', authorize('admin', 'teacher'), assignmentController.getClassAssignments);
router.post('/:classId/assignments', authorize('admin', 'teacher'), assignmentController.createAssignment);
router.post('/:id/dropout-risk/score', authorize('admin', 'teacher'), classController.scoreDropoutRisk);

// ─── Các API sửa đổi dữ liệu cần Role Admin ────────────────────────────────

// Tạo lớp học mới
router.post('/', authorize('admin'), classController.createClass);

// Cập nhật thông tin lớp học
router.put('/:id', authorize('admin'), classController.updateClass);

// Ghi danh học viên vào lớp (Academic Enrollment)
router.post('/:id/enroll', authorize('admin', 'sale'), classController.enrollStudent);

export default router;

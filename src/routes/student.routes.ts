import { Router, Request, Response, NextFunction } from 'express';
import { studentController } from '../controllers/student.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { invoiceController } from '../controllers/invoice.controller';

const router = Router();

router.use(authenticate);

// Lấy danh sách học viên (Có tìm kiếm, phân trang, lọc nợ học phí)
router.get('/', studentController.getStudents);

// Lấy chi tiết học viên
router.get('/:id/invoices', invoiceController.getStudentInvoices);
router.get('/:id', studentController.getStudentById);

// ─── Các tác vụ thay đổi dữ liệu yêu cầu quyền Admin hoặc Sale ──────────────

// Tạo học viên mới (Đồng thời tạo User + Sinh mật khẩu ngẫu nhiên)
router.post('/', authorize('admin', 'sale'), studentController.createStudent);
router.put('/:id', authorize('admin', 'sale'), studentController.updateStudent);
router.post('/:id/reset-password', authorize('admin', 'sale'), studentController.resetPassword);
router.post('/:id/dropout-risk/score', authorize('admin', 'sale', 'teacher'), studentController.scoreDropoutRisk);

export default router;

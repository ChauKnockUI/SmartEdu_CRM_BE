import { Router } from 'express';
import { studentController } from '../controllers/student.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { invoiceController } from '../controllers/invoice.controller';

const router = Router();

// Tất cả các API quản lý học viên đều cần đăng nhập
router.use(authenticate);

// Lấy danh sách học viên (Có tìm kiếm, phân trang, lọc nợ học phí)
router.get('/', studentController.getStudents);

// Lấy chi tiết học viên
router.get('/:id/invoices', invoiceController.getStudentInvoices);
router.get('/:id', studentController.getStudentById);

// ─── Các tác vụ thay đổi dữ liệu yêu cầu quyền Admin hoặc Sale ──────────────

// Tạo học viên mới (Đồng thời tạo User + Sinh mật khẩu ngẫu nhiên)
router.post('/', authorize('admin', 'sale'), studentController.createStudent);

// Cập nhật thông tin học viên (Đồng bộ với bảng User)
router.put('/:id', authorize('admin', 'sale'), studentController.updateStudent);

// Khôi phục mật khẩu (Reset Password)
router.post('/:id/reset-password', authorize('admin', 'sale'), studentController.resetPassword);

export default router;

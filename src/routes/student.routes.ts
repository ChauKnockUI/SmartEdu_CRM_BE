import { Router } from 'express';
import { studentController } from '../controllers/student.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { invoiceController } from '../controllers/invoice.controller';
import { requireStudentRead } from '../middlewares/studentAccess.middleware';

const router = Router();

router.use(authenticate);

// Lấy danh sách học viên (Có tìm kiếm, phân trang, lọc nợ học phí)
router.get('/', studentController.getStudents);
router.get('/me', authorize('student'), studentController.getMyProfile);
router.get('/filter-options', authorize('admin', 'sale', 'teacher'), studentController.getFilterOptions);
router.get('/export', authorize('admin', 'sale', 'teacher'), studentController.exportStudents);

// Lấy chi tiết học viên
router.get('/:id/invoices', authorize('admin', 'sale', 'student'), requireStudentRead, invoiceController.getStudentInvoices);
router.get('/:id', requireStudentRead, studentController.getStudentById);
router.get('/:id/dropout-risk', authorize('admin', 'sale', 'teacher'), requireStudentRead, studentController.getClassDropoutRisks);

// Hồ sơ hành chính và tài khoản học viên do Admin quản lý.

// Tạo học viên mới (Đồng thời tạo User + Sinh mật khẩu ngẫu nhiên)
router.post('/', authorize('admin'), studentController.createStudent);
router.put('/:id', authorize('admin'), studentController.updateStudent);
router.post('/:id/reset-password', authorize('admin'), studentController.resetPassword);
router.post('/:id/dropout-risk/score', authorize('admin', 'teacher'), requireStudentRead, studentController.scoreDropoutRisk);

export default router;

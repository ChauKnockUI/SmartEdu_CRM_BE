import { Router } from 'express';
import { attendanceController } from '../controllers/attendance.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

/**
 * Điểm danh (Attendance) Routes
 */

// GET /attendance/sessions/:id - Xem thông tin điểm danh buổi học
// Người dùng: Admin, Giáo viên, Học viên (nếu tham gia lớp)
router.get('/sessions/:id', attendanceController.getSessionAttendance);

// GET /attendance/sessions/:id/absences - Xem danh sách học viên vắng/trễ
// Người dùng: Admin, Giáo viên, Học viên (nếu tham gia lớp)
router.get('/sessions/:id/absences', attendanceController.getAbsenceList);

// PATCH /attendance/sessions/:id/mark - Giáo viên điểm danh
// Người dùng: Admin, Giáo viên (của lớp)
router.patch(
  '/sessions/:id/mark',
  authorize('admin', 'teacher'),
  attendanceController.markAttendance
);

// GET /attendance/students/:studentId/classes/:classId/history - Xem lịch sử điểm danh
// Người dùng: Admin, Giáo viên, Học viên (chỉ xem của chính mình)
router.get(
  '/students/:studentId/classes/:classId/history',
  attendanceController.getStudentAttendanceHistory
);

export default router;

import { Request, Response, NextFunction } from 'express';
import { prisma, withTenantTx } from '../database/db';
import { attendanceService } from '../services/attendance.service';
import { attendanceAccess } from '../utils/attendanceAccess';
import { notificationService } from '../services/notification.service';
import { archiveUnlockNotifications } from '../utils/scheduleNotifications';

export class AttendanceController {
  /**
   * GET /attendance/sessions/:id
   * Get session attendance with memo and all enrolled students
   */
  async getSessionAttendance(req: Request, res: Response) {
    try {
      const schedule_id = parseInt(req.params.id);
      const user_id = (req as any).user?.userId;
      const user_role = (req as any).user?.role;

      if (isNaN(schedule_id)) {
        return res.status(400).json({
          success: false,
          message: 'ID buổi học không hợp lệ'
        });
      }

      if (!user_id || !user_role) {
        return res.status(401).json({
          success: false,
          message: 'Vui lòng đăng nhập'
        });
      }

      const attendance = await attendanceService.getSessionAttendance(
        schedule_id,
        user_id,
        user_role
      );

      return res.status(200).json({
        success: true,
        data: attendance
      });
    } catch (error: any) {
      console.error('[AttendanceController] getSessionAttendance error:', error);

      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Lỗi server',
        error: error.message
      });
    }
  }

  /**
   * GET /attendance/sessions/:id/absences
   * Get absence list (absent, late and excused students) for a session
   */
  async getAbsenceList(req: Request, res: Response) {
    try {
      const schedule_id = parseInt(req.params.id);
      const user_id = (req as any).user?.userId;
      const user_role = (req as any).user?.role;

      if (isNaN(schedule_id)) {
        return res.status(400).json({
          success: false,
          message: 'ID buổi học không hợp lệ'
        });
      }

      if (!user_id || !user_role) {
        return res.status(401).json({
          success: false,
          message: 'Vui lòng đăng nhập'
        });
      }

      const absences = await attendanceService.getAbsenceList(
        schedule_id,
        user_id,
        user_role
      );

      return res.status(200).json({
        success: true,
        data: absences
      });
    } catch (error: any) {
      console.error('[AttendanceController] getAbsenceList error:', error);

      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Lỗi server',
        error: error.message
      });
    }
  }

  /**
   * PATCH /attendance/sessions/:id/mark
   * Teacher marks attendance for students
   * Body: { attendances: [{ student_id, status, notes? }] }
   */
  async markAttendance(req: Request, res: Response) {
    try {
      const schedule_id = parseInt(req.params.id);
      const { attendances } = req.body;
      const user_id = (req as any).user?.userId;
      const user_role = (req as any).user?.role;

      if (isNaN(schedule_id)) {
        return res.status(400).json({
          success: false,
          message: 'ID buổi học không hợp lệ',
        });
      }

      if (!Array.isArray(attendances)) {
        return res.status(400).json({
          success: false,
          message: 'Dữ liệu điểm danh phải là một mảng',
        });
      }

      if (!user_id || !user_role) {
        return res.status(401).json({
          success: false,
          message: 'Vui lòng đăng nhập',
        });
      }

      await attendanceService.recordAttendance(
        schedule_id,
        user_id,
        user_role,
        req.body
      );

      return res.status(200).json({
        success: true,
        message: 'Lưu điểm danh thành công',
      });
    } catch (error: any) {
      console.error('[AttendanceController] markAttendance error:', error);

      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Lỗi server',
        error: error.message,
      });
    }
  }
  /**
   * GET /attendance/students/:studentId/classes/:classId/history
   * Get student's attendance history for a class
   */
  async getStudentAttendanceHistory(req: Request, res: Response) {
    try {
      const student_id = parseInt(req.params.studentId);
      const class_id = parseInt(req.params.classId);
      const user_id = (req as any).user?.userId;
      const user_role = (req as any).user?.role;

      if (isNaN(student_id) || isNaN(class_id)) {
        return res.status(400).json({
          success: false,
          message: 'ID học viên hoặc lớp không hợp lệ'
        });
      }

      if (!user_id || !user_role) {
        return res.status(401).json({
          success: false,
          message: 'Vui lòng đăng nhập'
        });
      }

      const history = await attendanceService.getStudentAttendanceHistory(
        student_id,
        class_id,
        user_id,
        user_role
      );

      return res.status(200).json({
        success: true,
        data: history
      });
    } catch (error: any) {
      console.error(
        '[AttendanceController] getStudentAttendanceHistory error:',
        error
      );

      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Lỗi server',
        error: error.message
      });
    }
  }

  unlockAttendance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scheduleId = parseInt(req.params.id, 10);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ success: false, message: 'ID buổi học không hợp lệ' });
      }

      const updated = await prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          is_attendance_unlocked: true,
          attendance_unlocked_at: new Date(),
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Đã mở khóa quyền điểm danh cho buổi học này thành công.',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };

  toggleUnlockAttendance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scheduleId = Number(req.params.id);
      const { unlock } = req.body;
      if (!Number.isInteger(scheduleId) || scheduleId <= 0 || scheduleId > 2147483647 || typeof unlock !== 'boolean')
        return res.status(400).json({ success: false, message: 'ID buổi học và trạng thái mở khóa không hợp lệ.' });
      const updated = await withTenantTx(async tx => {
        await tx.$queryRaw`SELECT id FROM schedules WHERE id = ${scheduleId} FOR UPDATE`;
        const schedule = await tx.schedule.findUnique({ where: { id: scheduleId }, include: { class: { select: { status: true } } } });
        if (!schedule) throw Object.assign(new Error('Buổi học không tồn tại.'), { statusCode: 404 });
        const access = attendanceAccess(schedule, req.user!.userId, 'admin');
        if (unlock && (access.cancelled || !access.timeLocked)) throw Object.assign(new Error(access.cancelled
          ? 'Buổi học đã hủy.' : 'Buổi học chưa bị khóa sau 48 giờ.'), { statusCode: 400 });
        const result = await tx.schedule.update({ where: { id: scheduleId }, data: {
          is_attendance_unlocked: unlock, attendance_unlocked_at: unlock ? new Date() : null,
        } });
        if (unlock) await archiveUnlockNotifications(tx, scheduleId);
        return result;
      });
      return res.status(200).json({
        success: true,
        message: updated.is_attendance_unlocked
          ? 'Đã mở khóa quyền điểm danh cho giáo viên.'
          : 'Đã khóa lại quyền điểm danh.',
        data: updated,
      });
    } catch (error: any) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
      next(error);
    }
  };

  requestUnlockAttendance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scheduleId = Number(req.params.id);
      const result = await notificationService.requestAttendanceUnlock(scheduleId, req.user!);
      return res.status(200).json({
        success: true,
        message: result.duplicate ? 'Yêu cầu mở điểm danh đã được gửi trong 24 giờ qua.' : 'Đã gửi yêu cầu mở khóa điểm danh đến Quản trị viên.',
      });
    } catch (error: any) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
      next(error);
    }
  };
}

export const attendanceController = new AttendanceController();

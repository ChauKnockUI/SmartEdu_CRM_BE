import { Request, Response } from 'express';
import { attendanceService } from '../services/attendance.service';
import { AttendanceInput } from '../services/attendance.service';

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
   * Get absence list (absent & late students) for a session
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
}

export const attendanceController = new AttendanceController();

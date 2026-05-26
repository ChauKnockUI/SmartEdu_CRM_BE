import { Request, Response } from 'express';
import { scheduleService } from '../services/schedule.service';

export class ScheduleController {
    async updateAttendance(req: Request, res: Response) {
        try {
            const schedule_id = parseInt(req.params.id);
            const { attendances } = req.body;

            // Lấy thông tin user đăng nhập từ middleware
            const user_id = (req as any).user?.userId;
            const user_role = (req as any).user?.role;

            if (isNaN(schedule_id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID buổi học không hợp lệ'
                });
            }

            if (!Array.isArray(attendances)) {
                return res.status(400).json({
                    success: false,
                    message: 'Dữ liệu điểm danh phải là một mảng (Array)'
                });
            }

            if (!user_id || !user_role) {
                return res.status(401).json({
                    success: false,
                    message: 'Vui lòng đăng nhập'
                });
            }

            await scheduleService.updateAttendance(schedule_id, user_id, user_role, attendances);

            return res.status(200).json({
                success: true,
                message: 'Lưu điểm danh thành công'
            });

        } catch (error: any) {
            console.error('[ScheduleController] updateAttendance error:', error);

            if (error.statusCode) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getMySchedules(req: Request, res: Response) {
        try {
            const user_id = (req as any).user?.userId;
            const role = (req as any).user?.role;

            if (!user_id || !role) {
                return res.status(401).json({
                    success: false,
                    message: 'Vui lòng đăng nhập'
                });
            }

            const data = await scheduleService.getMySchedules(user_id, role);

            return res.status(200).json({
                success: true,
                data
            });

        } catch (error: any) {
            console.error('[ScheduleController] getMySchedules error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }
}

export const scheduleController = new ScheduleController();

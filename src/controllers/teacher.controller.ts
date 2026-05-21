import { Request, Response } from 'express';
import { classService } from '../services/class.service';

export class TeacherController {
    async getAvailableTeachers(req: Request, res: Response) {
        try {
            const { start_date, end_date, schedule_days, schedule_time, class_id } = req.query;

            if (!start_date || !end_date || !schedule_days || !schedule_time) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu các tham số bắt buộc: start_date, end_date, schedule_days, schedule_time'
                });
            }

            // Parse schedule_days: "1,3,5" -> [1, 3, 5]
            const daysArray = (schedule_days as string).split(',').map(Number);
            if (daysArray.some(isNaN)) {
                return res.status(400).json({ success: false, message: 'schedule_days không hợp lệ' });
            }

            // Parse schedule_time: "18:00,20:00" -> ["18:00", "20:00"]
            const timeArray = (schedule_time as string).split(',');
            if (timeArray.length !== 2) {
                return res.status(400).json({ success: false, message: 'schedule_time không hợp lệ (cần 2 giờ)' });
            }

            const excludeClassId = class_id ? Number(class_id) : undefined;
            if (excludeClassId !== undefined && isNaN(excludeClassId)) {
                return res.status(400).json({ success: false, message: 'class_id khÃ´ng há»£p lá»‡' });
            }

            const availableTeachers = await classService.getAvailableTeachers(
                new Date(start_date as string),
                new Date(end_date as string),
                daysArray,
                timeArray,
                excludeClassId
            );

            return res.status(200).json({
                success: true,
                data: availableTeachers
            });
        } catch (error: any) {
            console.error('[TeacherController] getAvailableTeachers error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }
}

export const teacherController = new TeacherController();

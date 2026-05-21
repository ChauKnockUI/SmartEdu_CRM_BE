import { Request, Response } from 'express';
import { classService } from '../services/class.service';

const parseScheduleDays = (value: unknown): number[] | null => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const days = parsed.map(Number);
            return days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) ? days : null;
        }
    } catch {
        // Fallback to comma-separated values below.
    }

    const days = raw.split(',').map(day => Number(day.trim()));
    return days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) ? days : null;
};

const parseScheduleTime = (value: unknown): string[] | null => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const times = parsed.map(String);
            return times.length === 2 ? times : null;
        }
    } catch {
        // Fallback to extracting HH:mm values below.
    }

    const matches = raw.match(/\d{1,2}:\d{2}/g);
    return matches && matches.length >= 2 ? matches.slice(0, 2) : null;
};

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
            const daysArray = parseScheduleDays(schedule_days);
            if (!daysArray) {
                return res.status(400).json({ success: false, message: 'schedule_days không hợp lệ' });
            }

            // Parse schedule_time: "18:00,20:00" -> ["18:00", "20:00"]
            const timeArray = parseScheduleTime(schedule_time);
            if (!timeArray) {
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
}

export const teacherController = new TeacherController();

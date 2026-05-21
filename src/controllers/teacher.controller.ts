import { Request, Response } from 'express';
import { classService } from '../services/class.service';
import { teacherService } from '../services/teacher.service';
import { TeacherType } from '../generated/prisma';

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

const parseTeacherType = (value: unknown): TeacherType | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    return value === 'full_time' || value === 'part_time' ? value : undefined;
};

export class TeacherController {
    async getTeachers(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const search = req.query.search as string;
            const type = parseTeacherType(req.query.type);

            if (req.query.type && !type) {
                return res.status(400).json({
                    success: false,
                    message: 'Loại giảng viên không hợp lệ'
                });
            }

            let is_active: boolean | undefined = undefined;
            if (req.query.is_active === 'true') is_active = true;
            if (req.query.is_active === 'false') is_active = false;

            const result = await teacherService.getTeachers({ page, limit, search, type, is_active });

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            console.error('[TeacherController] getTeachers error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getTeacherById(req: Request, res: Response) {
        try {
            const id = Number(req.params.id);

            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID giảng viên không hợp lệ'
                });
            }

            const teacher = await teacherService.getTeacherById(id);

            if (!teacher) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy giảng viên'
                });
            }

            return res.status(200).json({
                success: true,
                data: teacher
            });
        } catch (error: any) {
            console.error('[TeacherController] getTeacherById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async createTeacher(req: Request, res: Response) {
        try {
            const { full_name, email, phone, type, specialization, is_active } = req.body;

            if (!full_name || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'Tên giảng viên và email là bắt buộc'
                });
            }

            const teacherType = parseTeacherType(type);
            if (type && !teacherType) {
                return res.status(400).json({
                    success: false,
                    message: 'Loại giảng viên không hợp lệ'
                });
            }

            const result = await teacherService.createTeacher({
                full_name,
                email,
                phone,
                type: teacherType,
                specialization,
                is_active
            });

            return res.status(201).json({
                success: true,
                message: 'Tạo giảng viên thành công',
                data: result.teacher,
                temp_password: result.temp_password
            });
        } catch (error: any) {
            console.error('[TeacherController] createTeacher error:', error);

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

    async updateTeacher(req: Request, res: Response) {
        try {
            const id = Number(req.params.id);
            const { full_name, email, phone, type, specialization, is_active } = req.body;

            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID giảng viên không hợp lệ'
                });
            }

            const teacherType = parseTeacherType(type);
            if (type && !teacherType) {
                return res.status(400).json({
                    success: false,
                    message: 'Loại giảng viên không hợp lệ'
                });
            }

            const updatedTeacher = await teacherService.updateTeacher(id, {
                full_name,
                email,
                phone,
                type: teacherType,
                specialization,
                is_active
            });

            if (!updatedTeacher) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy giảng viên để cập nhật'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Cập nhật giảng viên thành công',
                data: updatedTeacher
            });
        } catch (error: any) {
            console.error('[TeacherController] updateTeacher error:', error);

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

    async deleteTeacher(req: Request, res: Response) {
        try {
            const id = Number(req.params.id);

            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID giảng viên không hợp lệ'
                });
            }

            const teacher = await teacherService.deleteTeacher(id);

            if (!teacher) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy giảng viên để ngưng hoạt động'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Đã ngưng hoạt động giảng viên',
                data: teacher
            });
        } catch (error: any) {
            console.error('[TeacherController] deleteTeacher error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async resetPassword(req: Request, res: Response) {
        try {
            const id = Number(req.params.id);

            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID giảng viên không hợp lệ'
                });
            }

            const result = await teacherService.resetTeacherPassword(id);

            return res.status(200).json({
                success: true,
                message: 'Khôi phục mật khẩu thành công',
                new_password: result.new_password
            });
        } catch (error: any) {
            console.error('[TeacherController] resetPassword error:', error);

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

    async getTeacherSchedule(req: Request, res: Response) {
        try {
            const id = Number(req.params.id);

            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID giảng viên không hợp lệ'
                });
            }

            const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
            const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;
            const schedule = await teacherService.getTeacherSchedule(id, startDate, endDate);

            if (!schedule) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy giảng viên'
                });
            }

            return res.status(200).json({
                success: true,
                data: schedule
            });
        } catch (error: any) {
            console.error('[TeacherController] getTeacherSchedule error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

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

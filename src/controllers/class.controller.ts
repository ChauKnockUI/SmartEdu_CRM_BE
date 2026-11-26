import { Request, Response } from 'express';
import { classService } from '../services/class.service';
import { dropoutRiskService } from '../services/ai/dropoutRisk.service';
import { ClassStatus } from '../generated/prisma';
import { dropoutRiskRepository } from '../repositories/dropoutRisk.repository';
import { classListQuery } from '../utils/classListQuery';

export class ClassController {
    async getFilterOptions(req: Request, res: Response) {
        try {
            const data = await classService.getClassFilterOptions(req.user!);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, data });
        } catch {
            return res.status(500).json({ success: false, message: 'Không tải được bộ lọc lớp học.' });
        }
    }
    async getDropoutAlerts(req: Request, res: Response) {
        try {
            const classId = req.query.class_id === undefined ? undefined : Number(req.query.class_id);
            if (classId !== undefined && (!Number.isInteger(classId) || classId <= 0 || classId > 2147483647)) {
                return res.status(400).json({ success: false, message: 'ID lớp không hợp lệ.' });
            }
            return res.json({ success: true, data: await dropoutRiskRepository.getSnapshots(req.user!, { classId }) });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({ success: false, message: 'Không tải được cảnh báo bỏ học.' });
        }
    }
    async getClasses(req: Request, res: Response) {
        try {
            const query = classListQuery.safeParse(req.query);
            if (!query.success) return res.status(400).json({ success: false, message: 'Bộ lọc hoặc phân trang lớp học không hợp lệ.' });
            const result = await classService.getClasses(query.data, req.user!);

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            console.error('[ClassController] getClasses error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getMyClasses(req: Request, res: Response) {
        try {
            const user_id = (req as any).user?.userId;
            const role = (req as any).user?.role;

            if (!user_id || !role) {
                return res.status(401).json({
                    success: false,
                    message: 'Vui lòng đăng nhập'
                });
            }

            const data = await classService.getMyClasses(user_id, role);

            return res.status(200).json({
                success: true,
                data
            });

        } catch (error: any) {
            console.error('[ClassController] getMyClasses error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getClassById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Lớp học không hợp lệ'
                });
            }

            const classData = await classService.getClassById(Number(id), req.user!);

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Lớp học'
                });
            }

            return res.status(200).json({
                success: true,
                data: classData
            });
        } catch (error: any) {
            console.error('[ClassController] getClassById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async createClass(req: Request, res: Response) {
        try {
            const {
                name, course_id, fee_plan_id, teacher_id, room_id, status,
                start_date, end_date, schedule_days, schedule_time, max_students
            } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Tên lớp học là bắt buộc'
                });
            }

            // Validation mảng schedule_days (Ví dụ: [1, 3, 5])
            if (schedule_days && !Array.isArray(schedule_days)) {
                return res.status(400).json({
                    success: false,
                    message: 'schedule_days phải là một mảng các số nguyên (0-6)'
                });
            }

            // Validation mảng schedule_time (Ví dụ: ["18:00", "20:00"])
            if (schedule_time && (!Array.isArray(schedule_time) || schedule_time.length !== 2)) {
                return res.status(400).json({
                    success: false,
                    message: 'schedule_time phải là một mảng gồm 2 phần tử giờ bắt đầu và kết thúc (VD: ["18:00", "20:00"])'
                });
            }

            const newClass = await classService.createClass({
                name,
                course_id: course_id === undefined || course_id === null || course_id === '' ? undefined : Number(course_id),
                fee_plan_id: fee_plan_id ? Number(fee_plan_id) : undefined,
                teacher_id: teacher_id !== undefined && teacher_id !== null && teacher_id !== '' ? Number(teacher_id) : undefined,
                room_id: room_id !== undefined && room_id !== null && room_id !== '' ? Number(room_id) : undefined,
                status: status as ClassStatus,
                start_date: start_date ? new Date(start_date) : undefined,
                end_date: end_date ? new Date(end_date) : undefined,
                schedule_days: schedule_days as number[],
                schedule_time: schedule_time as string[],
                max_students: max_students ? Number(max_students) : undefined
            });

            return res.status(201).json({
                success: true,
                message: 'Tạo Lớp học và Sinh Lịch học thành công',
                data: newClass
            });
        } catch (error: any) {
            console.error('[ClassController] createClass error:', error);

            // Xử lý lỗi từ Service ném ra (400 hoặc 409 Conflict)
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

    async updateClass(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const {
                name, course_id, fee_plan_id, teacher_id, room_id, status,
                start_date, end_date, schedule_days, schedule_time, max_students
            } = req.body;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Lớp học không hợp lệ'
                });
            }

            const updatedClass = await classService.updateClass(Number(id), {
                name,
                course_id: course_id ? Number(course_id) : undefined,
                fee_plan_id: fee_plan_id ? Number(fee_plan_id) : undefined,
                teacher_id: teacher_id === undefined ? undefined : teacher_id === null || teacher_id === '' ? null : Number(teacher_id),
                room_id: room_id === undefined ? undefined : room_id === null || room_id === '' ? null : Number(room_id),
                status: status as ClassStatus,
                start_date: start_date ? new Date(start_date) : undefined,
                end_date: end_date ? new Date(end_date) : undefined,
                schedule_days,
                schedule_time,
                max_students: max_students !== undefined ? Number(max_students) : undefined
            });

            if (!updatedClass) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Lớp học để cập nhật'
                });
            }

            return res.status(200).json({
                success: true,
                message: updatedClass.schedule_sync?.incomplete ? 'Đã cập nhật thông tin lớp. Cần bổ sung đủ ngày/giờ để tạo các buổi học.'
                    : updatedClass.schedule_sync ? `Đã cập nhật lớp: ${updatedClass.schedule_sync.updated} buổi thay đổi, ${updatedClass.schedule_sync.created} buổi mới, ${updatedClass.schedule_sync.cancelled} buổi hủy. Các buổi đã học/có điểm danh được giữ nguyên.`
                    : 'Cập nhật lớp học thành công',
                data: updatedClass
            });
        } catch (error: any) {
            console.error('[ClassController] updateClass error:', error);

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

    async checkStudentConflicts(req: Request, res: Response) {
        try {
            const class_id = Number(req.params.id);
            const { student_ids } = req.body;
            if (isNaN(class_id) || !Array.isArray(student_ids)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID lớp học hoặc danh sách student_ids không hợp lệ'
                });
            }
            const conflicts = await classService.checkStudentConflicts(class_id, student_ids);
            return res.status(200).json({
                success: true,
                data: conflicts
            });
        } catch (error: any) {
            console.error('[ClassController] checkStudentConflicts error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Lỗi khi kiểm tra xung đột lịch học'
            });
        }
    }

    async enrollStudent(req: Request, res: Response) {
        try {
            const class_id = Number(req.params.id);
            const { student_ids, allow_conflicts } = req.body;
            if (isNaN(class_id) || !Array.isArray(student_ids) || student_ids.length === 0
                || (allow_conflicts !== undefined && typeof allow_conflicts !== 'boolean')) {
                return res.status(400).json({
                    success: false,
                    message: 'ID lớp học không hợp lệ hoặc danh sách student_ids trống'
                });
            }
            const result = await classService.enrollStudents(
                class_id,
                student_ids,
                allow_conflicts ?? false
            );
            return res.status(201).json({
                success: true,
                message: 'Đã xử lý danh sách ghi danh',
                data: result
            });
        } catch (error: any) {
            console.error('[ClassController] enrollStudents error:', error);

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

    async getDropoutRisk(req: Request, res: Response) {
        try {
            const classId = Number(req.params.id);
            if (!Number.isInteger(classId) || classId <= 0) return res.status(400).json({ success: false, message: 'ID lớp không hợp lệ' });
            await dropoutRiskService.assertScoringAccess(classId, req.user!.userId, req.user!.role);
            return res.json({ success: true, data: await dropoutRiskService.getClassSnapshots(classId, req.user!) });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({ success: false, message: error.message });
        }
    }

    async scoreDropoutRisk(req: Request, res: Response) {
        try {
            const classId = Number(req.params.id);

            if (!classId || isNaN(classId)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID lớp học không hợp lệ'
                });
            }

            await dropoutRiskService.assertScoringAccess(classId, req.user!.userId, req.user!.role);
            const results = await dropoutRiskService.scoreClass(classId);
            const successCount = results.filter((item: any) => item.success && !item.skipped).length;

            return res.status(200).json({
                success: true,
                message: `Đã cập nhật dropout risk cho ${successCount}/${results.length} học viên`,
                data: results
            });
        } catch (error: any) {
            console.error('[ClassController] scoreDropoutRisk error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Không tính được dropout risk cho lớp'
            });
        }
    }

    async unenrollStudent(req: Request, res: Response) {
        try {
            const class_id = Number(req.params.id);
            const student_id = Number(req.params.studentId);

            if (isNaN(class_id) || isNaN(student_id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID lớp học hoặc ID học viên không hợp lệ'
                });
            }

            const result = await classService.unenrollStudent(class_id, student_id);

            return res.status(200).json({
                success: true,
                message: result.message
            });
        } catch (error: any) {
            console.error('[ClassController] unenrollStudent error:', error);
            if (error.statusCode) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: error.message || 'Lỗi server'
            });
        }
    }
}

export const classController = new ClassController();

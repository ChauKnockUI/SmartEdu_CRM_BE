import { Request, Response } from 'express';
import { classService } from '../services/class.service';
import { ClassStatus } from '../generated/prisma';

export class ClassController {
    async getClasses(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const search = req.query.search as string;
            const status = req.query.status as ClassStatus;
            
            const course_id = req.query.course_id ? parseInt(req.query.course_id as string) : undefined;
            const teacher_id = req.query.teacher_id ? parseInt(req.query.teacher_id as string) : undefined;

            const result = await classService.getClasses({ page, limit, search, status, course_id, teacher_id });

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

    async getClassById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Lớp học không hợp lệ'
                });
            }

            const classData = await classService.getClassById(Number(id));

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
                name, course_id, teacher_id, room_id, status, 
                start_date, end_date, schedule_days, schedule_time, max_students 
            } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Tên lớp học là bắt buộc'
                });
            }

            const newClass = await classService.createClass({
                name,
                course_id: course_id ? Number(course_id) : undefined,
                teacher_id: teacher_id ? Number(teacher_id) : undefined,
                room_id: room_id ? Number(room_id) : undefined,
                status: status as ClassStatus,
                start_date: start_date ? new Date(start_date) : undefined,
                end_date: end_date ? new Date(end_date) : undefined,
                schedule_days,
                schedule_time,
                max_students: max_students ? Number(max_students) : undefined
            });

            return res.status(201).json({
                success: true,
                message: 'Tạo Lớp học thành công',
                data: newClass
            });
        } catch (error: any) {
            console.error('[ClassController] createClass error:', error);
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
                name, course_id, teacher_id, room_id, status, 
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
                teacher_id: teacher_id ? Number(teacher_id) : undefined,
                room_id: room_id ? Number(room_id) : undefined,
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
                message: 'Cập nhật Lớp học thành công',
                data: updatedClass
            });
        } catch (error: any) {
            console.error('[ClassController] updateClass error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }
}

export const classController = new ClassController();

import { Request, Response } from 'express';
import { courseService } from '../services/course.service';

export class CourseController {
    async getCourses(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const search = req.query.search as string;

            const result = await courseService.getCourses({ page, limit, search });

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            console.error('[CourseController] getCourses error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getCourseById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Khóa học không hợp lệ'
                });
            }

            const course = await courseService.getCourseById(Number(id));

            if (!course) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Khóa học'
                });
            }

            return res.status(200).json({
                success: true,
                data: course
            });
        } catch (error: any) {
            console.error('[CourseController] getCourseById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async createCourse(req: Request, res: Response) {
        try {
            const { name, description, total_sessions, fee, duration_weeks } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Tên khóa học là bắt buộc'
                });
            }

            const newCourse = await courseService.createCourse({
                name,
                description,
                total_sessions: total_sessions ? Number(total_sessions) : undefined,
                fee: fee ? Number(fee) : undefined,
                duration_weeks: duration_weeks ? Number(duration_weeks) : undefined
            });

            return res.status(201).json({
                success: true,
                message: 'Tạo Khóa học thành công',
                data: newCourse
            });
        } catch (error: any) {
            console.error('[CourseController] createCourse error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async updateCourse(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { name, description, total_sessions, fee, duration_weeks } = req.body;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Khóa học không hợp lệ'
                });
            }

            const updatedCourse = await courseService.updateCourse(Number(id), {
                name,
                description,
                total_sessions: total_sessions ? Number(total_sessions) : undefined,
                fee: fee ? Number(fee) : undefined,
                duration_weeks: duration_weeks ? Number(duration_weeks) : undefined
            });

            if (!updatedCourse) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Khóa học để cập nhật'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Cập nhật Khóa học thành công',
                data: updatedCourse
            });
        } catch (error: any) {
            console.error('[CourseController] updateCourse error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async deleteCourse(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Khóa học không hợp lệ'
                });
            }

            const isDeleted = await courseService.deleteCourse(Number(id));

            if (!isDeleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Khóa học để xóa'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Đã xóa Khóa học thành công'
            });
        } catch (error: any) {
            console.error('[CourseController] deleteCourse error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getClasses(req: Request, res: Response) {
        try {
            const courseId = Number(req.params.id);

            const classes = await courseService.getClasses(courseId);

            res.json({
                success: true,
                data: classes,
            });
        } catch (error: any) {
            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }
}

export const courseController = new CourseController();

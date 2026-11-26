import { Request, Response } from 'express';
import { courseService } from '../services/course.service';

function courseId(req: Request): number {
    const raw = req.params.id;
    const id = Number(raw);
    if (!/^\d+$/.test(raw || '') || !Number.isInteger(id) || id <= 0 || id > 2147483647) {
        throw Object.assign(new Error('ID khóa học không hợp lệ.'), { statusCode: 400 });
    }
    return id;
}

function respondError(res: Response, error: any, message: string) {
    if (error?.code === 'P2025') return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học.' });
    if ([400, 401, 403, 404].includes(error?.statusCode)) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('[CourseController]', error);
    return res.status(500).json({ success: false, message });
}

export class CourseController {
    async getCourses(req: Request, res: Response) {
        try {
            const { page, limit, search, is_active } = req.query;
            const result = await courseService.getCourses({ page, limit, search, is_active });
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            return respondError(res, error, 'Không thể tải danh sách khóa học.');
        }
    }

    async getCourseById(req: Request, res: Response) {
        try {
            const course = await courseService.getCourseById(courseId(req));
            if (!course) return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học.' });
            return res.status(200).json({ success: true, data: course });
        } catch (error) {
            return respondError(res, error, 'Không thể tải thông tin khóa học.');
        }
    }

    async createCourse(req: Request, res: Response) {
        try {
            const course = await courseService.createCourse(req.body);
            return res.status(201).json({ success: true, message: 'Tạo khóa học thành công.', data: course });
        } catch (error) {
            return respondError(res, error, 'Không thể tạo khóa học.');
        }
    }

    async updateCourse(req: Request, res: Response) {
        try {
            const course = await courseService.updateCourse(courseId(req), req.body);
            if (!course) return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học để cập nhật.' });
            return res.status(200).json({ success: true, message: 'Cập nhật khóa học thành công.', data: course });
        } catch (error) {
            return respondError(res, error, 'Không thể cập nhật khóa học.');
        }
    }

    async deleteCourse(req: Request, res: Response) {
        try {
            const paused = await courseService.deleteCourse(courseId(req));
            if (!paused) return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học để tạm dừng.' });
            return res.status(200).json({ success: true, message: 'Đã tạm dừng khóa học. Lịch sử được giữ nguyên.' });
        } catch (error) {
            return respondError(res, error, 'Không thể tạm dừng khóa học.');
        }
    }

    async getClasses(req: Request, res: Response) {
        try {
            const result = await courseService.getClasses(courseId(req), req.user!);
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            return respondError(res, error, 'Không thể tải danh sách lớp của khóa học.');
        }
    }
}

export const courseController = new CourseController();

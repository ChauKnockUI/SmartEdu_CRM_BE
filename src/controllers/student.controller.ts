import { Request, Response } from 'express';
import { studentService } from '../services/student.service';
import { dropoutRiskService } from '../services/ai/dropoutRisk.service';
import { StudentStatus } from '../generated/prisma';

export class StudentController {
    async getStudents(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const search = req.query.search as string;
            const status = req.query.status as StudentStatus;
            const class_id = req.query.class_id ? parseInt(req.query.class_id as string) : undefined;
            
            let has_debt: boolean | undefined = undefined;
            if (req.query.has_debt === 'true') has_debt = true;
            if (req.query.has_debt === 'false') has_debt = false;

            const result = await studentService.getStudents({ page, limit, search, status, class_id, has_debt });

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            console.error('[StudentController] getStudents error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getStudentById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Học viên không hợp lệ'
                });
            }

            const studentData = await studentService.getStudentById(Number(id));

            if (!studentData) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Học viên'
                });
            }

            return res.status(200).json({
                success: true,
                data: studentData
            });
        } catch (error: any) {
            console.error('[StudentController] getStudentById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async createStudent(req: Request, res: Response) {
        try {
            const { full_name, email, phone, dob, lead_id } = req.body;

            if (!full_name || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'Tên học viên và Email là bắt buộc'
                });
            }

            const result = await studentService.createStudent({
                full_name,
                email,
                phone,
                dob: dob ? new Date(dob) : undefined,
                lead_id: lead_id ? Number(lead_id) : undefined
            });

            return res.status(201).json({
                success: true,
                message: 'Tạo tài khoản Học viên thành công',
                data: result.student,
                temp_password: result.temp_password
            });
        } catch (error: any) {
            console.error('[StudentController] createStudent error:', error);
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

    async updateStudent(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { full_name, email, phone, dob, status } = req.body;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Học viên không hợp lệ'
                });
            }

            const updatedStudent = await studentService.updateStudent(Number(id), {
                full_name,
                email,
                phone,
                dob: dob ? new Date(dob) : undefined,
                status: status as StudentStatus
            });

            if (!updatedStudent) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Học viên để cập nhật'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Cập nhật thông tin Học viên thành công',
                data: updatedStudent
            });
        } catch (error: any) {
            console.error('[StudentController] updateStudent error:', error);
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

    async resetPassword(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Học viên không hợp lệ'
                });
            }

            const result = await studentService.resetStudentPassword(Number(id));

            return res.status(200).json({
                success: true,
                message: 'Khôi phục mật khẩu thành công',
                new_password: result.new_password
            });
        } catch (error: any) {
            console.error('[StudentController] resetPassword error:', error);
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

    async scoreDropoutRisk(req: Request, res: Response) {
        try {
            const studentId = Number(req.params.id);
            const classId = req.query.class_id ? Number(req.query.class_id) : NaN;

            if (!studentId || isNaN(studentId) || !classId || isNaN(classId)) {
                return res.status(400).json({
                    success: false,
                    message: 'student id va class_id la bat buoc'
                });
            }

            const result = await dropoutRiskService.scoreStudent(studentId, classId);

            if (!result.success) {
                return res.status(503).json({
                    success: false,
                    message: 'AI dropout service chua san sang',
                    features: result.features
                });
            }

            return res.status(200).json(result);
        } catch (error: any) {
            console.error('[StudentController] scoreDropoutRisk error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message
            });
        }
    }
}

export const studentController = new StudentController();

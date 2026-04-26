import { Prisma, StudentStatus } from '../generated/prisma';
import { studentRepository } from '../repositories/student.repository';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

export interface GetStudentsQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: StudentStatus;
    class_id?: number;
    has_debt?: boolean;
}

export interface CreateStudentInput {
    full_name: string;
    email: string;
    phone?: string;
    dob?: Date;
    lead_id?: number;
}

export interface UpdateStudentInput {
    full_name?: string;
    email?: string;
    phone?: string;
    dob?: Date;
    status?: StudentStatus;
}

export class StudentService {
    // Hàm sinh mật khẩu ngẫu nhiên
    private generateRandomPassword(length: number = 8): string {
        return crypto.randomBytes(length).toString('hex').slice(0, length);
    }

    async getStudents(query: GetStudentsQuery) {
        const { page = 1, limit = 10, search, status, class_id, has_debt } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.StudentWhereInput = {};

        if (search) {
            where.OR = [
                { full_name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } }
            ];
        }

        if (status) {
            where.status = status;
        }

        if (class_id) {
            where.classEnrollments = {
                some: { class_id }
            };
        }

        if (has_debt !== undefined) {
            if (has_debt) {
                // Có nợ: Có ít nhất 1 payment trạng thái pending
                where.payments = {
                    some: {
                        status: 'pending'
                    }
                };
            } else {
                // Không nợ: Mọi payment đều không phải pending
                where.payments = {
                    none: {
                        status: 'pending'
                    }
                };
            }
        }

        const [total, students] = await Promise.all([
            studentRepository.count(where),
            studentRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: { createdAt: 'desc' }
            })
        ]);

        return {
            data: students,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getStudentById(id: number) {
        return await studentRepository.findById(id);
    }

    async createStudent(data: CreateStudentInput) {
        // Kiểm tra email đã tồn tại trong User table chưa
        const existingUser = await studentRepository.findByEmail(data.email);
        if (existingUser) {
            const err = new Error('Email này đã tồn tại trong hệ thống User.');
            (err as any).statusCode = 409;
            throw err;
        }

        // Sinh mật khẩu ngẫu nhiên và mã hóa
        const tempPassword = this.generateRandomPassword(8);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(tempPassword, salt);

        // Chuẩn bị dữ liệu cho User
        const userData: Prisma.UserCreateInput = {
            email: data.email,
            password_hash: passwordHash,
            full_name: data.full_name,
            phone: data.phone,
            role: 'student'
        };

        // Chuẩn bị dữ liệu cho Student
        const studentData: Omit<Prisma.StudentUncheckedCreateInput, 'user_id'> = {
            full_name: data.full_name,
            email: data.email,
            phone: data.phone,
            dob: data.dob,
            lead_id: data.lead_id
        };

        const newStudent = await studentRepository.createStudentWithUser(userData, studentData);

        return {
            student: newStudent,
            temp_password: tempPassword // Chỉ trả về 1 lần duy nhất
        };
    }

    async updateStudent(id: number, data: UpdateStudentInput) {
        const existingStudent = await studentRepository.findById(id);
        if (!existingStudent) return null;

        // Nếu có đổi email, kiểm tra email mới có bị trùng không
        if (data.email && data.email !== existingStudent.email) {
            const checkUser = await studentRepository.findByEmail(data.email);
            if (checkUser) {
                const err = new Error('Email mới đã tồn tại trong hệ thống User.');
                (err as any).statusCode = 409;
                throw err;
            }
        }

        const studentData: Prisma.StudentUncheckedUpdateInput = { ...data };
        
        // Chuẩn bị update bảng User song song
        let userData: Prisma.UserUncheckedUpdateInput | undefined = undefined;
        if (existingStudent.user_id && (data.full_name || data.email || data.phone)) {
            userData = {};
            if (data.full_name) userData.full_name = data.full_name;
            if (data.email) userData.email = data.email;
            if (data.phone) userData.phone = data.phone;
        }

        return await studentRepository.updateStudentAndUser(id, existingStudent.user_id, studentData, userData);
    }

    async resetStudentPassword(id: number) {
        const existingStudent = await studentRepository.findById(id);
        if (!existingStudent || !existingStudent.user_id) {
            const err = new Error('Không tìm thấy học viên hoặc học viên chưa có tài khoản User.');
            (err as any).statusCode = 404;
            throw err;
        }

        const newTempPassword = this.generateRandomPassword(8);
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(newTempPassword, salt);

        await studentRepository.updateUserPassword(existingStudent.user_id, newPasswordHash);

        return { new_password: newTempPassword };
    }
}

export const studentService = new StudentService();

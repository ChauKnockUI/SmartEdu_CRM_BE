import { Prisma, TeacherType } from '../generated/prisma';
import { teacherRepository } from '../repositories/teacher.repository';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

export interface GetTeachersQuery {
    page?: number;
    limit?: number;
    search?: string;
    type?: TeacherType;
    is_active?: boolean;
}

export interface CreateTeacherInput {
    full_name: string;
    email: string;
    phone?: string;
    type?: TeacherType;
    specialization?: string;
    is_active?: boolean;
}

export interface UpdateTeacherInput extends Partial<CreateTeacherInput> {}

export class TeacherService {
    private generateRandomPassword(length: number = 8): string {
        return crypto.randomBytes(length).toString('hex').slice(0, length);
    }

    async getTeachers(query: GetTeachersQuery) {
        const { page = 1, limit = 10, search, type, is_active } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.TeacherWhereInput = {};

        if (search) {
            where.OR = [
                { full_name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { specialization: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (type) {
            where.type = type;
        }

        if (is_active !== undefined) {
            where.is_active = is_active;
        }

        const [total, teachers] = await Promise.all([
            teacherRepository.count(where),
            teacherRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: { createdAt: 'desc' }
            })
        ]);

        return {
            data: teachers,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getTeacherById(id: number) {
        return await teacherRepository.findById(id);
    }

    async createTeacher(data: CreateTeacherInput) {
        const existingUser = await teacherRepository.findUserByEmail(data.email);
        const existingTeacher = await teacherRepository.findTeacherByEmail(data.email);

        if (existingUser || existingTeacher) {
            const err = new Error('Email này đã tồn tại trong hệ thống.');
            (err as any).statusCode = 409;
            throw err;
        }

        const tempPassword = this.generateRandomPassword(8);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(tempPassword, salt);
        const isActive = data.is_active ?? true;

        const userData: Prisma.UserCreateInput = {
            email: data.email,
            password_hash: passwordHash,
            full_name: data.full_name,
            phone: data.phone,
            role: 'teacher',
            is_active: isActive
        };

        const teacherData: Omit<Prisma.TeacherUncheckedCreateInput, 'user_id'> = {
            full_name: data.full_name,
            email: data.email,
            phone: data.phone,
            type: data.type ?? 'full_time',
            specialization: data.specialization,
            is_active: isActive
        };

        const teacher = await teacherRepository.createTeacherWithUser(userData, teacherData);

        return {
            teacher,
            temp_password: tempPassword
        };
    }

    async updateTeacher(id: number, data: UpdateTeacherInput) {
        const existingTeacher = await teacherRepository.findById(id);
        if (!existingTeacher) return null;

        if (data.email && data.email !== existingTeacher.email) {
            const userWithEmail = await teacherRepository.findUserByEmail(data.email);
            const teacherWithEmail = await teacherRepository.findTeacherByEmail(data.email);

            if ((userWithEmail && userWithEmail.id !== existingTeacher.user_id) ||
                (teacherWithEmail && teacherWithEmail.id !== existingTeacher.id)) {
                const err = new Error('Email mới đã tồn tại trong hệ thống.');
                (err as any).statusCode = 409;
                throw err;
            }
        }

        const teacherData: Prisma.TeacherUncheckedUpdateInput = {};
        if (data.full_name !== undefined) teacherData.full_name = data.full_name;
        if (data.email !== undefined) teacherData.email = data.email;
        if (data.phone !== undefined) teacherData.phone = data.phone;
        if (data.type !== undefined) teacherData.type = data.type;
        if (data.specialization !== undefined) teacherData.specialization = data.specialization;
        if (data.is_active !== undefined) teacherData.is_active = data.is_active;

        let userData: Prisma.UserUncheckedUpdateInput | undefined = undefined;
        if (existingTeacher.user_id) {
            userData = {};
            if (data.full_name !== undefined) userData.full_name = data.full_name;
            if (data.email !== undefined) userData.email = data.email;
            if (data.phone !== undefined) userData.phone = data.phone;
            if (data.is_active !== undefined) userData.is_active = data.is_active;
        }

        return await teacherRepository.updateTeacherAndUser(
            id,
            existingTeacher.user_id,
            teacherData,
            userData
        );
    }

    async deleteTeacher(id: number) {
        const existingTeacher = await teacherRepository.findById(id);
        if (!existingTeacher) return null;

        return await teacherRepository.softDelete(id, existingTeacher.user_id);
    }

    async resetTeacherPassword(id: number) {
        const existingTeacher = await teacherRepository.findById(id);
        if (!existingTeacher || !existingTeacher.user_id) {
            const err = new Error('Không tìm thấy giảng viên hoặc giảng viên chưa có tài khoản User.');
            (err as any).statusCode = 404;
            throw err;
        }

        const newTempPassword = this.generateRandomPassword(8);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newTempPassword, salt);

        await teacherRepository.updateUserPassword(existingTeacher.user_id, passwordHash);

        return { new_password: newTempPassword };
    }

    async getTeacherSchedule(id: number, startDate?: Date, endDate?: Date) {
        const existingTeacher = await teacherRepository.findById(id);
        if (!existingTeacher) return null;

        return await teacherRepository.getSchedule(id, startDate, endDate);
    }
}

export const teacherService = new TeacherService();

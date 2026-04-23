import { Prisma, ClassStatus } from '../generated/prisma';
import { classRepository } from '../repositories/class.repository';

export interface GetClassesQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: ClassStatus;
    course_id?: number;
    teacher_id?: number;
}

export interface CreateClassInput {
    name: string;
    course_id?: number;
    teacher_id?: number;
    room_id?: number;
    status?: ClassStatus;
    start_date?: Date;
    end_date?: Date;
    schedule_days?: string;
    schedule_time?: string;
    max_students?: number;
}

export interface UpdateClassInput extends Partial<CreateClassInput> {}

export class ClassService {
    async getClasses(query: GetClassesQuery) {
        const { page = 1, limit = 10, search, status, course_id, teacher_id } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.ClassWhereInput = {};

        if (search) {
            where.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        if (status) {
            where.status = status;
        }

        if (course_id) {
            where.course_id = course_id;
        }

        if (teacher_id) {
            where.teacher_id = teacher_id;
        }

        const [total, classes] = await Promise.all([
            classRepository.count(where),
            classRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: { createdAt: 'desc' }
            })
        ]);

        return {
            data: classes,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getClassById(id: number) {
        return await classRepository.findById(id);
    }

    async createClass(data: CreateClassInput) {
        return await classRepository.create(data as Prisma.ClassUncheckedCreateInput);
    }

    async updateClass(id: number, data: UpdateClassInput) {
        const existing = await classRepository.checkExistence(id);
        if (!existing) return null;

        return await classRepository.update(id, data as Prisma.ClassUncheckedUpdateInput);
    }
}

export const classService = new ClassService();

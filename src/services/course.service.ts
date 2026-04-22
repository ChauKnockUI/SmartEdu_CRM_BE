import { Prisma } from '../generated/prisma';
import { courseRepository } from '../repositories/course.repository';

export interface GetCoursesQuery {
    page?: number;
    limit?: number;
    search?: string;
}

export interface CreateCourseInput {
    name: string;
    description?: string;
    total_sessions?: number;
    fee?: number;
    duration_weeks?: number;
}

export interface UpdateCourseInput {
    name?: string;
    description?: string;
    total_sessions?: number;
    fee?: number;
    duration_weeks?: number;
}

export class CourseService {
    async getCourses(query: GetCoursesQuery) {
        const { page = 1, limit = 10, search } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.CourseWhereInput = {
            is_active: true
        };

        if (search) {
            where.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        const [total, courses] = await Promise.all([
            courseRepository.count(where),
            courseRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: { createdAt: 'desc' }
            })
        ]);

        return {
            data: courses,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getCourseById(id: number) {
        const course = await courseRepository.findById(id);
        if (course && course.is_active) {
            return course;
        }
        return null;
    }

    async createCourse(data: CreateCourseInput) {
        return await courseRepository.create(data as Prisma.CourseCreateInput);
    }

    async updateCourse(id: number, data: UpdateCourseInput) {
        const existing = await courseRepository.checkExistence(id);
        if (!existing) return null;

        return await courseRepository.update(id, data);
    }

    async deleteCourse(id: number) {
        const existing = await courseRepository.checkExistence(id);
        if (!existing) return false;

        await courseRepository.softDelete(id);
        return true;
    }
}

export const courseService = new CourseService();

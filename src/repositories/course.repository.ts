import { Prisma } from '../generated/prisma';
import { prisma } from '../database/db';
import { classReadScope, enrollmentReadScope, studentReadScope, type AcademicActor } from '../utils/academicAccess';

export class CourseRepository {
    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.CourseWhereInput;
        orderBy?: Prisma.CourseOrderByWithRelationInput | Prisma.CourseOrderByWithRelationInput[];
    }) {
        return await prisma.course.findMany(params);
    }

    async count(where?: Prisma.CourseWhereInput) {
        return await prisma.course.count({ where });
    }

    async findClasses(courseId: number, actor: AcademicActor) {
        const enrollmentWhere: Prisma.ClassEnrollmentWhereInput = {
            AND: [enrollmentReadScope(actor), { status: 'active', student: studentReadScope(actor) }],
        };
        return prisma.class.findMany({
            where: { course_id: courseId, AND: [classReadScope(actor)] },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: {
                teacher: { select: { id: true, full_name: true } },
                room: { select: { id: true, name: true } },
                _count: { select: { classEnrollments: { where: { status: 'active' } } } },
                // IDs are only used to deduplicate the summary, never returned to the client.
                classEnrollments: { where: enrollmentWhere, select: { student_id: true } },
            },
        });
    }

    async findById(id: number) {
        return await prisma.course.findUnique({
            where: { id }
        });
    }

    async create(data: Prisma.CourseCreateInput) {
        return await prisma.course.create({ data });
    }

    async update(id: number, data: Prisma.CourseUpdateInput) {
        return await prisma.course.update({
            where: { id },
            data
        });
    }

    async softDelete(id: number) {
        return await prisma.course.update({
            where: { id },
            data: { is_active: false }
        });
    }

    async checkExistence(id: number) {
        return await prisma.course.findUnique({
            where: { id },
            select: { id: true }
        });
    }
}

export const courseRepository = new CourseRepository();

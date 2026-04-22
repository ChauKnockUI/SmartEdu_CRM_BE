import { PrismaClient, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

export class CourseRepository {
    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.CourseWhereInput;
        orderBy?: Prisma.CourseOrderByWithRelationInput;
    }) {
        return await prisma.course.findMany(params);
    }

    async count(where?: Prisma.CourseWhereInput) {
        return await prisma.course.count({ where });
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

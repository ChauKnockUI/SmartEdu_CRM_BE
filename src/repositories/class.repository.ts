import { PrismaClient, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

export class ClassRepository {
    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.ClassWhereInput;
        orderBy?: Prisma.ClassOrderByWithRelationInput;
    }) {
        return await prisma.class.findMany({
            ...params,
            include: {
                course: {
                    select: { id: true, name: true }
                },
                room: {
                    select: { id: true, name: true }
                },
                _count: {
                    select: { classEnrollments: true }
                }
            }
        });
    }

    async count(where?: Prisma.ClassWhereInput) {
        return await prisma.class.count({ where });
    }

    async findById(id: number) {
        return await prisma.class.findUnique({
            where: { id },
            include: {
                course: true,
                room: true,
                teacher: true,
                _count: {
                    select: { classEnrollments: true }
                }
            }
        });
    }

    async create(data: Prisma.ClassCreateInput | Prisma.ClassUncheckedCreateInput) {
        return await prisma.class.create({ data });
    }

    async update(id: number, data: Prisma.ClassUpdateInput | Prisma.ClassUncheckedUpdateInput) {
        return await prisma.class.update({
            where: { id },
            data
        });
    }

    async checkExistence(id: number) {
        return await prisma.class.findUnique({
            where: { id },
            select: { id: true }
        });
    }
}

export const classRepository = new ClassRepository();

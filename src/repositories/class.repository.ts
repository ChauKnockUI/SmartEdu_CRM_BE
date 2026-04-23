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

    async createWithSchedules(
        classData: Prisma.ClassUncheckedCreateInput,
        schedulesData: Prisma.ScheduleCreateManyInput[]
    ) {
        return await prisma.$transaction(async (tx) => {
            // 1. Create Class
            const newClass = await tx.class.create({
                data: classData
            });

            // 2. Map class_id to schedules
            const schedulesWithClassId = schedulesData.map(schedule => ({
                ...schedule,
                class_id: newClass.id
            }));

            // 3. Bulk insert Schedules
            if (schedulesWithClassId.length > 0) {
                await tx.schedule.createMany({
                    data: schedulesWithClassId
                });
            }

            return newClass;
        });
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

    async checkScheduleConflict(roomId: number | null, teacherId: number | null, dates: Date[], startTime: Date, endTime: Date) {
        const OR_conditions: any[] = [];
        if (roomId) OR_conditions.push({ room_id: roomId });
        if (teacherId) OR_conditions.push({ teacher_id: teacherId });

        if (OR_conditions.length === 0) return null;

        return await prisma.schedule.findFirst({
            where: {
                date: { in: dates },
                OR: OR_conditions,
                AND: [
                    { start_time: { lt: endTime } },
                    { end_time: { gt: startTime } }
                ]
            }
        });
    }
}

export const classRepository = new ClassRepository();

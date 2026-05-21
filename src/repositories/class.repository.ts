import { Prisma } from '../generated/prisma';
import { prisma } from '../database/db';

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

    async updateWithFutureSchedules(
        id: number,
        classData: Prisma.ClassUncheckedUpdateInput,
        scheduleData: Prisma.ScheduleUncheckedUpdateManyInput
    ) {
        return await prisma.$transaction(async (tx) => {
            const updatedClass = await tx.class.update({
                where: { id },
                data: classData
            });

            if (Object.keys(scheduleData).length > 0) {
                await tx.schedule.updateMany({
                    where: {
                        class_id: id,
                        date: { gte: new Date() },
                        status: { not: 'cancelled' }
                    },
                    data: scheduleData
                });
            }

            return updatedClass;
        });
    }

    async findFutureSchedulesByClassId(id: number) {
        return await prisma.schedule.findMany({
            where: {
                class_id: id,
                date: { gte: new Date() },
                status: { not: 'cancelled' }
            },
            select: {
                id: true,
                date: true,
                start_time: true,
                end_time: true
            }
        });
    }

    async findScheduleResourceConflict(
        classId: number,
        roomId: number | null,
        teacherId: number | null,
        date: Date,
        startTime: Date,
        endTime: Date
    ) {
        const OR_conditions: Prisma.ScheduleWhereInput[] = [];
        if (roomId) OR_conditions.push({ room_id: roomId });
        if (teacherId) OR_conditions.push({ teacher_id: teacherId });

        if (OR_conditions.length === 0) return null;

        return await prisma.schedule.findFirst({
            where: {
                class_id: { not: classId },
                date,
                OR: OR_conditions,
                AND: [
                    { start_time: { lt: endTime } },
                    { end_time: { gt: startTime } }
                ]
            },
            select: {
                id: true,
                date: true,
                start_time: true,
                end_time: true,
                room_id: true,
                teacher_id: true
            }
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

    async findConflictingResources(dates: Date[], startTime: Date, endTime: Date, excludeClassId?: number) {
        const conflicts = await prisma.schedule.findMany({
            where: {
                ...(excludeClassId ? { class_id: { not: excludeClassId } } : {}),
                date: { in: dates },
                AND: [
                    { start_time: { lt: endTime } },
                    { end_time: { gt: startTime } }
                ]
            },
            select: {
                room_id: true,
                teacher_id: true
            }
        });

        const conflictingRooms = Array.from(new Set(conflicts.map(c => c.room_id).filter(id => id !== null) as number[]));
        const conflictingTeachers = Array.from(new Set(conflicts.map(c => c.teacher_id).filter(id => id !== null) as number[]));

        return { conflictingRooms, conflictingTeachers };
    }
}

export const classRepository = new ClassRepository();

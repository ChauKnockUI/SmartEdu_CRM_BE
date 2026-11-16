import { Prisma } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { classReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';

export class ClassRepository {
    async getFilterOptions(actor: AcademicActor) {
        if (actor.role === 'admin') {
            const [courses, teachers] = await Promise.all([
                prisma.course.findMany({ select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
                prisma.teacher.findMany({ select: { id: true, full_name: true }, orderBy: [{ full_name: 'asc' }, { id: 'asc' }] }),
            ]);
            return { courses, teachers };
        }
        // Non-admin users only see option labels from classes they may actually read.
        const classes = await prisma.class.findMany({ where: classReadScope(actor),
            select: { course: { select: { id: true, name: true } }, teacher: { select: { id: true, full_name: true } } },
        });
        const courses = new Map<number, { id: number; name: string }>();
        const teachers = new Map<number, { id: number; full_name: string }>();
        for (const item of classes) {
            if (item.course) courses.set(item.course.id, item.course);
            if (item.teacher) teachers.set(item.teacher.id, item.teacher);
        }
        return { courses: [...courses.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id - b.id),
            teachers: [...teachers.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi') || a.id - b.id) };
    }

    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.ClassWhereInput;
        orderBy?: Prisma.ClassOrderByWithRelationInput | Prisma.ClassOrderByWithRelationInput[];
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
                teacher: {
                select: { id: true, full_name: true }
                },
                _count: {
                    select: { classEnrollments: { where: { status: 'active' } } }
                }
            }
        });
    }

    async count(where?: Prisma.ClassWhereInput) {
        return await prisma.class.count({ where });
    }

    async findById(id: number, actor?: AcademicActor) {
        return await prisma.class.findFirst({
            where: { id, ...(actor ? classReadScope(actor) : {}) },
            include: {
                course: true,
                room: true,
                teacher: true,
                _count: {
                    select: { classEnrollments: true }
                },
                classEnrollments: {
                    ...(actor ? { where: enrollmentReadScope(actor) } : {}),
                    include: {
                        student: {
                            select: {
                                id: true,
                                full_name: true,
                                email: true,
                                phone: true,
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
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
        return await withTenantTx(async (tx) => {
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
        return await withTenantTx(async (tx) => {
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
        if (roomId) {
            OR_conditions.push({ room_id: roomId });
            OR_conditions.push({ class: { room_id: roomId } });
        }
        if (teacherId) {
            OR_conditions.push({ teacher_id: teacherId });
            OR_conditions.push({ class: { teacher_id: teacherId } });
        }

        if (OR_conditions.length === 0) return null;

        return await prisma.schedule.findFirst({
            where: {
                class_id: { not: classId },
                date,
                status: { not: 'cancelled' },
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
            select: { id: true, status: true, start_date: true, end_date: true }
        });
    }

    async checkScheduleConflict(roomId: number | null, teacherId: number | null, dates: Date[], startTime: Date, endTime: Date) {
        const OR_conditions: Prisma.ScheduleWhereInput[] = [];
        if (roomId) {
            OR_conditions.push({ room_id: roomId });
            OR_conditions.push({ class: { room_id: roomId } });
        }
        if (teacherId) {
            OR_conditions.push({ teacher_id: teacherId });
            OR_conditions.push({ class: { teacher_id: teacherId } });
        }

        if (OR_conditions.length === 0) return null;

        return await prisma.schedule.findFirst({
            where: {
                date: { in: dates },
                status: { not: 'cancelled' },
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
                status: { not: 'cancelled' },
                AND: [
                    { start_time: { lt: endTime } },
                    { end_time: { gt: startTime } }
                ]
            },
            select: {
                room_id: true,
                teacher_id: true,
                class: {
                    select: {
                        room_id: true,
                        teacher_id: true
                    }
                }
            }
        });

        const conflictingRooms = Array.from(new Set(
            conflicts.flatMap(c => [c.room_id, c.class?.room_id]).filter((id): id is number => typeof id === 'number')
        ));
        const conflictingTeachers = Array.from(new Set(
            conflicts.flatMap(c => [c.teacher_id, c.class?.teacher_id]).filter((id): id is number => typeof id === 'number')
        ));

        return { conflictingRooms, conflictingTeachers };
    }
}

export const classRepository = new ClassRepository();

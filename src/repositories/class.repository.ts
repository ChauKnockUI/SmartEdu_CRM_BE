import { Prisma } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { classReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';
import { assertClassResources, assertClassScheduleAvailable, lockClassScheduling, scheduleMoment } from '../utils/classScheduling';
import { assertClassCourse } from '../utils/courseSchedule';

export class ClassRepository {
    async getFilterOptions(actor: AcademicActor) {
        if (actor.role === 'admin') {
            const [courses, teachers] = await Promise.all([
                prisma.course.findMany({ select: { id: true, name: true, is_active: true, total_sessions: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
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
                    select: { classEnrollments: { where: { status: 'active' } } }
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
                                status: true,
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });
    }

    async create(data: Prisma.ClassUncheckedCreateInput) {
        return withTenantTx(async tx => {
            await assertClassCourse(tx, data.course_id);
            await assertClassResources(tx, [data]);
            return tx.class.create({ data });
        });
    }

    async createWithSchedules(
        classData: Prisma.ClassUncheckedCreateInput,
        schedulesData: Prisma.ScheduleCreateManyInput[]
    ) {
        return await withTenantTx(async (tx) => {
            await lockClassScheduling(tx);
            await assertClassCourse(tx, classData.course_id, schedulesData.length);
            const slots = schedulesData.map(item => ({ date: new Date(item.date),
                start_time: item.start_time ? new Date(item.start_time) : null, end_time: item.end_time ? new Date(item.end_time) : null,
                teacher_id: item.teacher_id ?? null, room_id: item.room_id ?? null }));
            const future = slots.filter(item => scheduleMoment(item.date, item.start_time) > new Date());
            if (!future.length) await assertClassResources(tx, [classData]);
            await assertClassScheduleAvailable(tx, future);
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

    async findConflictingResources(slots: { date: Date; start_time: Date | null; end_time: Date | null }[], excludeClassId?: number) {
        if (slots.some(item => !item.start_time || !item.end_time))
            throw Object.assign(new Error('Buổi học chưa có đủ giờ để kiểm tra phòng/giảng viên rảnh.'), { statusCode: 400 });
        const conflicts = await prisma.schedule.findMany({
            where: {
                ...(excludeClassId ? { class_id: { not: excludeClassId } } : {}),
                status: { notIn: ['cancelled', 'completed'] },
                OR: [{ class_id: null }, { class: { status: { notIn: ['cancelled', 'completed'] } } }],
                AND: [{ OR: slots.map(item => ({ date: item.date, start_time: { lt: item.end_time! }, end_time: { gt: item.start_time! } })) }],
            },
            select: {
                room_id: true,
                teacher_id: true,
            }
        });

        const conflictingRooms = Array.from(new Set(conflicts.map(c => c.room_id).filter((id): id is number => id !== null)));
        const conflictingTeachers = Array.from(new Set(conflicts.map(c => c.teacher_id).filter((id): id is number => id !== null)));

        return { conflictingRooms, conflictingTeachers };
    }
}

export const classRepository = new ClassRepository();

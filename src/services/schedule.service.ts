import { AttendanceStatus, Prisma, ScheduleStatus } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { dropoutRiskService } from './ai/dropoutRisk.service';

export interface AttendanceInput {
    student_id: number;
    status: AttendanceStatus;
    notes?: string;
}

export interface GetAllSchedulesQuery {
    startDate?: Date;
    endDate?: Date;
    classId?: number;
    teacherId?: number;
    roomId?: number;
    status?: ScheduleStatus;
}

export class ScheduleService {
    async updateAttendance(
        schedule_id: number,
        user_id: number,
        user_role: string,
        attendances: AttendanceInput[]
    ) {
        // 1. Fetch Schedule and related info
        const schedule = await prisma.schedule.findUnique({
            where: { id: schedule_id },
            include: {
                teacher: { select: { user_id: true } },
                class: { select: { teacher: { select: { user_id: true } } } }
            }
        });

        if (!schedule) {
            const err = new Error('Không tìm thấy buổi học');
            (err as any).statusCode = 404;
            throw err;
        }

        // 2. Authorization
        if (user_role !== 'admin') {
            const assignedTeacherUserId = schedule.teacher?.user_id || schedule.class?.teacher?.user_id;
            if (user_role !== 'teacher' || assignedTeacherUserId !== user_id) {
                const err = new Error('Bạn không có quyền điểm danh cho buổi học này');
                (err as any).statusCode = 403;
                throw err;
            }
        }

        // 3. Time-lock check (48H)
        // Lấy thời điểm bắt đầu buổi học (ghép date và start_time)
        // Nếu không có start_time, ta tính từ 0h của date đó
        let startDateTime = schedule.date;
        if (schedule.start_time) {
            // copy date, set time from start_time
            startDateTime = new Date(schedule.date);
            startDateTime.setUTCHours(
                schedule.start_time.getUTCHours(),
                schedule.start_time.getUTCMinutes(),
                0, 0
            );
        }

        const now = new Date();
        const diffHours = (now.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);

        if (diffHours > 48 && user_role !== 'admin' && !schedule.is_attendance_unlocked) {
            const err = new Error('Dữ liệu đã bị khóa sau 48h. Vui lòng liên hệ Admin để sửa đổi.');
            (err as any).statusCode = 403;
            throw err;
        }

        // 4. Bulk Upsert logic using Prisma Transaction
        await withTenantTx(async (tx) => {
            for (const att of attendances) {
                await tx.attendance.upsert({
                    where: {
                        schedule_id_student_id: {
                            schedule_id,
                            student_id: att.student_id
                        }
                    },
                    update: {
                        status: att.status,
                        notes: att.notes || null
                    },
                    create: {
                        schedule_id,
                        student_id: att.student_id,
                        status: att.status,
                        notes: att.notes || null
                    }
                });
            }
        });

        if (schedule.class_id && attendances.length > 0) {
            const affectedStudentIds = Array.from(new Set(attendances.map((att) => att.student_id)));
            void Promise.allSettled(
                affectedStudentIds.map((studentId) =>
                    dropoutRiskService.scoreStudent(studentId, schedule.class_id as number)
                )
            ).catch((error) => {
                console.error('[ScheduleService] dropout risk scoring error:', error);
            });
        }

        return { success: true };
    }

    async getMySchedules(user_id: number, role: string) {
        if (role === 'teacher') {
            return prisma.schedule.findMany({
                where: {
                    OR: [
                        { teacher: { user_id } },
                        { class: { teacher: { user_id } } },
                    ],
                },
                include: {
                    class: true,
                    room: true,
                    attendances: true,
                },
                orderBy: {
                    date: 'asc',
                },
            });
        }

        if (role === 'student') {
            return prisma.schedule.findMany({
                where: {
                    class: {
                        classEnrollments: {
                            some: {
                                student: {
                                    user_id,
                                },
                            },
                        },
                    },
                },
                include: {
                    class: true,
                    room: true,
                    attendances: true,
                },
                orderBy: {
                    date: 'asc',
                },
            });
        }

        return prisma.schedule.findMany({
            include: {
                class: true,
                room: true,
                attendances: true,
            },
            orderBy: {
                date: 'asc',
            },
        });
    }

    async getByClass(class_id: number) {
        return prisma.schedule.findMany({
            where: { class_id },
            include: {
                room: {
                    select: { id: true, name: true }
                },
                teacher: {
                    select: { id: true, full_name: true }
                },
                attendances: {
                    select: { id: true, student_id: true, status: true }
                },
            },
            orderBy: { date: 'asc' },
        });
    }

    async getAllSchedules(query: GetAllSchedulesQuery = {}) {
        const { startDate, endDate, classId, teacherId, roomId, status } = query;
        const where: Prisma.ScheduleWhereInput = {};

        if (startDate || endDate) {
            where.date = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }

        if (classId) {
            where.class_id = classId;
        }

        if (teacherId) {
            where.OR = [
                { teacher_id: teacherId },
                { class: { teacher_id: teacherId } },
            ];
        }

        if (roomId) {
            where.OR = [
                { room_id: roomId },
                { class: { room_id: roomId } },
            ];
        }

        if (status) {
            where.status = status;
        }

        return prisma.schedule.findMany({
            where,
            include: {
                class: {
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        course_id: true,
                        course: { select: { id: true, name: true } },
                        teacher: { select: { id: true, full_name: true } },
                        room: { select: { id: true, name: true } },
                    }
                },
                room: { select: { id: true, name: true } },
                teacher: { select: { id: true, full_name: true } },
                attendances: {
                    select: {
                        id: true,
                        student_id: true,
                        status: true,
                    }
                },
            },
            orderBy: [
                { date: 'asc' },
                { start_time: 'asc' },
            ],
        });
    }
}

export const scheduleService = new ScheduleService();

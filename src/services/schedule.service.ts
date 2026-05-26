import { AttendanceStatus } from '../generated/prisma';
import { prisma } from '../database/db';

export interface AttendanceInput {
    student_id: number;
    status: AttendanceStatus;
    notes?: string;
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
                teacher: {
                    select: { user_id: true }
                }
            }
        });

        if (!schedule) {
            const err = new Error('Không tìm thấy buổi học');
            (err as any).statusCode = 404;
            throw err;
        }

        // 2. Authorization
        if (user_role !== 'admin') {
            if (user_role !== 'teacher' || schedule.teacher?.user_id !== user_id) {
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

        if (diffHours > 48 && user_role !== 'admin') {
            const err = new Error('Dữ liệu đã bị khóa sau 48h. Vui lòng liên hệ Admin để sửa đổi.');
            (err as any).statusCode = 403;
            throw err;
        }

        // 4. Bulk Upsert logic using Prisma Transaction
        await prisma.$transaction(async (tx) => {
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

        return { success: true };
    }

    async getMySchedules(user_id: number, role: string) {
        if (role === 'teacher') {
            return prisma.schedule.findMany({
                where: {
                    class: {
                        teacher: {
                            user_id,
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
}

export const scheduleService = new ScheduleService();

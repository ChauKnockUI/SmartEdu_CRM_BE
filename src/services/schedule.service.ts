import { AttendanceStatus, Prisma, ScheduleStatus } from '../generated/prisma';
import { prisma } from '../database/db';
import { attendanceService } from './attendance.service';
import { scheduleReadScope, studentReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';
import { sessionChangeInfo } from '../utils/sessionChanges';

const scheduleView = <T extends { memo?: string | null; status: string; class?: { status?: string } | null }>(row: T) => {
    const { memo, ...data } = row;
    return { ...data, scheduleChange: sessionChangeInfo(memo, row.status, row.class?.status) };
};

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
    async getStudentSchedules(studentId: number, query: {
        startDate: Date; endDate: Date; classId?: number; page: number; limit: number;
    }, actor: AcademicActor) {
        const where: Prisma.ScheduleWhereInput = {
            AND: [scheduleReadScope(actor)], date: { gte: query.startDate, lte: query.endDate },
            ...(query.classId ? { class_id: query.classId } : {}),
            class: { classEnrollments: { some: {
                ...enrollmentReadScope(actor), student_id: studentId, status: 'active', student: studentReadScope(actor),
            } } },
        };
        const total = await prisma.schedule.count({ where });
        const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.limit)));
        const rows = total ? await prisma.schedule.findMany({ where, skip: (page - 1) * query.limit, take: query.limit,
            select: { id: true, class_id: true, date: true, start_time: true, end_time: true, status: true, memo: true,
                class: { select: { id: true, name: true, status: true } },
                teacher: { select: { id: true, full_name: true } }, room: { select: { id: true, name: true } },
                attendances: { where: { student_id: studentId }, select: { status: true } },
            }, orderBy: [{ date: 'asc' }, { start_time: 'asc' }, { id: 'asc' }],
        }) : [];
        return { data: rows.map(scheduleView), pagination: { total, page, limit: query.limit, totalPages: Math.ceil(total / query.limit) } };
    }

    async updateAttendance(
        schedule_id: number,
        user_id: number,
        user_role: string,
        attendances: AttendanceInput[]
    ) {
        return attendanceService.recordAttendance(schedule_id, user_id, user_role, { attendances });
    }

    async getMySchedules(user_id: number, role: string) {
        const actor = { userId: user_id, role: role as AcademicActor['role'] };
        const rows = await prisma.schedule.findMany({
            where: role === 'teacher' ? { teacher: { user_id } } : scheduleReadScope(actor),
            include: { class: true, room: true, attendances: {
                ...(!['admin', 'teacher'].includes(role) ? { where: { student: studentReadScope(actor) } } : {}),
            } },
            orderBy: { date: 'asc' },
        });
        return rows.map(scheduleView);
    }

    async getByClass(class_id: number, actor: AcademicActor) {
        const rows = await prisma.schedule.findMany({
            where: { class_id, AND: [scheduleReadScope(actor)] },
            include: {
                class: { select: { status: true } },
                room: {
                    select: { id: true, name: true }
                },
                teacher: {
                    select: { id: true, full_name: true }
                },
                attendances: {
                    ...(!['admin', 'teacher'].includes(actor.role) ? { where: { student: studentReadScope(actor) } } : {}),
                    select: { id: true, student_id: true, status: true }
                },
            },
            orderBy: { date: 'asc' },
        });
        return rows.map(scheduleView);
    }

    async getAllSchedules(query: GetAllSchedulesQuery, actor: AcademicActor) {
        const { startDate, endDate, classId, teacherId, roomId, status } = query;
        const where: Prisma.ScheduleWhereInput = { AND: [scheduleReadScope(actor)] };

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
            where.teacher_id = teacherId;
        }

        if (roomId) {
            where.room_id = roomId;
        }

        if (status) {
            where.status = status;
        }

        const rows = await prisma.schedule.findMany({
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
                    ...(!['admin', 'teacher'].includes(actor.role) ? { where: { student: studentReadScope(actor) } } : {}),
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
        return rows.map(scheduleView);
    }
}

export const scheduleService = new ScheduleService();

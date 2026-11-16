import type { Prisma } from '../generated/prisma';
import type { JwtPayload } from './jwt.util';

export type AcademicActor = Pick<JwtPayload, 'userId' | 'role'>;

export function studentReadScope(actor: AcademicActor): Prisma.StudentWhereInput {
    if (actor.role === 'admin') return {};
    if (actor.role === 'teacher') return { classEnrollments: { some: {
        status: 'active', class: { teacher: { user_id: actor.userId } },
    } } };
    if (actor.role === 'sale') return { lead: { assigned_to: actor.userId } };
    if (actor.role === 'student') return { user_id: actor.userId };
    return { id: -1 };
}

export function classReadScope(actor: AcademicActor): Prisma.ClassWhereInput {
    if (actor.role === 'admin') return {};
    if (actor.role === 'teacher') return { teacher: { user_id: actor.userId } };
    return { classEnrollments: { some: { status: 'active', student: studentReadScope(actor) } } };
}

export function enrollmentReadScope(actor: AcademicActor): Prisma.ClassEnrollmentWhereInput {
    if (actor.role === 'admin') return {};
    if (actor.role === 'teacher') return { status: 'active', class: classReadScope(actor) };
    return { status: 'active', student: studentReadScope(actor) };
}

export function scheduleReadScope(actor: AcademicActor): Prisma.ScheduleWhereInput {
    if (actor.role === 'admin') return {};
    if (actor.role === 'teacher') return { OR: [
        { teacher: { user_id: actor.userId } }, { class: classReadScope(actor) },
    ] };
    return { class: classReadScope(actor) };
}

export async function assertAttendanceStudents(tx: Prisma.TransactionClient, classId: number | null, studentIds: number[]) {
    const ids = [...new Set(studentIds)];
    if (!ids.length) return;
    if (!classId || ids.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
        throw Object.assign(new Error('Danh sách học viên điểm danh không hợp lệ.'), { statusCode: 400 });
    }
    const count = await tx.classEnrollment.count({ where: { class_id: classId, student_id: { in: ids }, status: 'active' } });
    if (count !== ids.length) throw Object.assign(new Error('Chỉ được điểm danh học viên đang ghi danh trong lớp của buổi học.'), { statusCode: 400 });
}

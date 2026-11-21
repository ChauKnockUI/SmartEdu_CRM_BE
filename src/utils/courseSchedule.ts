import type { Prisma } from '../generated/prisma';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function courseScheduleDates(start: Date, days: number[], total: number): Date[] {
    if (!Number.isFinite(start.getTime())) throw fail('Ngày bắt đầu không hợp lệ.');
    if (!Number.isInteger(total) || total < 1 || total > 10000) throw fail('Số buổi của khóa học phải là số nguyên từ 1 đến 10000.');
    if (!Array.isArray(days) || !days.length || new Set(days).size !== days.length
        || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Chọn các thứ học khác nhau trong tuần.');
    const dates: Date[] = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    while (dates.length < total) {
        if (days.includes(cursor.getUTCDay())) dates.push(new Date(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

// Recheck the course under a lock so a concurrent pause/change cannot create an outdated timetable.
export async function assertClassCourse(tx: Prisma.TransactionClient, courseId?: number | null, scheduledCount?: number) {
    if (courseId == null) return;
    if (!Number.isInteger(courseId) || courseId <= 0 || courseId > 2147483647) throw fail('ID khóa học không hợp lệ.');
    await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId} FOR SHARE`;
    const course = await tx.course.findFirst({ where: { id: courseId }, select: { is_active: true, total_sessions: true } });
    if (!course?.is_active) throw fail('Khóa học không tồn tại hoặc đã tạm dừng. Vui lòng chọn khóa học đang mở.');
    if (scheduledCount !== undefined && course.total_sessions != null && scheduledCount !== course.total_sessions)
        throw fail('Số buổi khóa học đã thay đổi. Vui lòng tải lại khóa học và kiểm tra lịch trước khi lưu.', 409);
}

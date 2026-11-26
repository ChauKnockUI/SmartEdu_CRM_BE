import { z } from 'zod';
import { withTenantTx } from '../database/db';
import type { AcademicActor } from '../utils/academicAccess';
import { assertClassScheduleAvailable, lockClassScheduling, scheduleMoment } from '../utils/classScheduling';
import { effectiveClassStatus } from '../utils/classStatus';
import { sessionChangeAccess, sessionChangeInfo, sessionJournal, type SessionChange } from '../utils/sessionChanges';
import { notifySessionChange } from '../utils/scheduleNotifications';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const reasonSchema = z.string().trim().min(1).max(1000);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const makeupSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start_time: clock, end_time: clock,
    reason: reasonSchema, room_id: z.number().int().positive().max(2147483647).optional() });

export class SessionChangeService {
    async change(id: number, action: 'cancel' | 'makeup', input: unknown, actor: AcademicActor) {
        if (!['admin', 'teacher'].includes(actor.role)) throw fail('Bạn không có quyền thay đổi lịch buổi học.', 403);
        if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw fail('ID buổi học không hợp lệ.');
        const parsed = (action === 'cancel' ? z.object({ reason: reasonSchema }) : makeupSchema).safeParse(input);
        if (!parsed.success) throw fail(action === 'cancel' ? 'Nhập lý do nghỉ từ 1 đến 1000 ký tự.'
            : 'Nhập lý do (tối đa 1000 ký tự), ngày và giờ học bù hợp lệ.');
        const values = parsed.data;
        const makeup = action === 'makeup' ? makeupSchema.parse(values) : undefined;
        const date = makeup ? new Date(`${makeup.date}T00:00:00Z`) : undefined;
        const startTime = makeup ? new Date(`1970-01-01T${makeup.start_time}:00Z`) : undefined;
        const endTime = makeup ? new Date(`1970-01-01T${makeup.end_time}:00Z`) : undefined;
        const now = new Date();
        if (makeup && (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== makeup.date
            || endTime! <= startTime! || scheduleMoment(date, startTime!) <= now))
            throw fail('Ngày học bù phải ở tương lai và giờ kết thúc phải sau giờ bắt đầu.');

        return withTenantTx(async tx => {
            await lockClassScheduling(tx);
            const ownership = actor.role === 'teacher' ? { teacher: { user_id: actor.userId } } : {};
            const target = await tx.schedule.findFirst({ where: { id, ...ownership }, select: { class_id: true } });
            if (!target?.class_id) throw fail('Không tìm thấy buổi học trong phạm vi phụ trách.', 404);
            await tx.$queryRaw`SELECT id FROM classes WHERE id = ${target.class_id} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM schedules WHERE id = ${id} FOR UPDATE`;
            const row = await tx.schedule.findFirst({ where: { id, ...ownership },
                include: { class: true, teacher: { select: { user_id: true } }, _count: { select: { attendances: true } } } });
            if (!row?.class || row.class_id !== target.class_id) throw fail('Không tìm thấy buổi học trong phạm vi phụ trách.', 404);
            const changedAt = new Date();
            const access = sessionChangeAccess(row, actor, changedAt);
            if (action === 'cancel' && access.canMakeup) return { id: row.id, status: row.status, scheduleChange: access };
            if (action === 'cancel' ? !access.canCancel : !access.canMakeup)
                throw fail(action === 'cancel' ? 'Chỉ được cho nghỉ buổi chưa bắt đầu, chưa điểm danh và thuộc lớp đang hoạt động.'
                    : 'Chỉ xếp học bù cho buổi đã báo nghỉ, chưa điểm danh và thuộc lớp chưa hủy.', 409);

            let slot: { date: Date; start_time: Date; end_time: Date; teacher_id: number; room_id: number | null } | undefined;
            if (makeup) {
                const teacherId = row.teacher_id ?? row.class.teacher_id;
                const roomId = makeup.room_id ?? row.room_id ?? row.class.room_id;
                if (!teacherId) throw fail('Phân công giáo viên cho lớp trước khi xếp học bù.');
                if (scheduleMoment(date!, startTime!) <= changedAt) throw fail('Giờ học bù đã qua. Vui lòng chọn lại ngày và giờ.');
                if (actor.role !== 'admin' && makeup.room_id !== undefined && makeup.room_id !== (row.room_id ?? row.class.room_id))
                    throw fail('Chỉ Admin được đổi phòng cho buổi học bù.', 403);
                if (row.class.start_date && date! < row.class.start_date) throw fail('Ngày học bù không được trước ngày bắt đầu lớp.');
                slot = { date: date!, start_time: startTime!, end_time: endTime!, teacher_id: teacherId, room_id: roomId };
                const sameClass = await tx.schedule.findFirst({ where: { id: { not: id }, class_id: row.class_id,
                    date: date!, status: { not: 'cancelled' }, start_time: { lt: endTime! }, end_time: { gt: startTime! } }, select: { id: true } });
                if (sameClass) throw fail('Lớp đã có buổi học trùng ngày và giờ này.', 409);
                await tx.$queryRaw`SELECT s.id FROM students s JOIN class_enrollments e ON e.student_id = s.id
                    WHERE e.class_id = ${row.class_id} AND e.status = 'active' ORDER BY s.id FOR UPDATE OF s`;
                const students = await tx.classEnrollment.findMany({ where: { class_id: row.class_id, status: 'active' },
                    select: { student_id: true, student: { select: { full_name: true } } } });
                await assertClassScheduleAvailable(tx, [slot], [id], students);
            }

            const entry: SessionChange = { action, date: (date ?? row.date).toISOString().slice(0, 10),
                start_time: (startTime ?? row.start_time)?.toISOString().slice(11, 16) ?? null,
                end_time: (endTime ?? row.end_time)?.toISOString().slice(11, 16) ?? null,
                reason: values.reason, at: changedAt.toISOString(), by: actor.userId };
            const journal = sessionJournal(row.memo); journal.history.push(entry);
            const updated = await tx.schedule.update({ where: { id }, data: { ...(slot ?? {}),
                status: action === 'cancel' ? 'cancelled' : 'scheduled', memo: JSON.stringify(journal),
                is_attendance_unlocked: false, attendance_unlocked_at: null } });
            if (slot) {
                const end_date = row.class.end_date && slot.date > row.class.end_date ? slot.date : row.class.end_date;
                const status = effectiveClassStatus({ ...row.class, end_date,
                    status: row.class.status === 'completed' ? 'upcoming' : row.class.status }, changedAt);
                if (end_date?.getTime() !== row.class.end_date?.getTime() || status !== row.class.status)
                    await tx.class.update({ where: { id: row.class.id }, data: { end_date, status } });
            }
            await notifySessionChange(tx, updated, row.class.name, action, values.reason, actor.userId);
            return { id: updated.id, status: updated.status, date: updated.date,
                scheduleChange: sessionChangeInfo(updated.memo, updated.status) };
        }, { maxWait: 10000, timeout: 30000 });
    }
}

export const sessionChangeService = new SessionChangeService();

import { Prisma, type Class } from '../generated/prisma';
import { currentTenantId } from '../database/tenant-context';
import { sessionChangeInfo } from './sessionChanges';

export const scheduleMoment = (date: Date, time: Date | null) => new Date(
    `${date.toISOString().slice(0, 10)}T${time?.toISOString().slice(11, 19) || '00:00:00'}+07:00`);
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });

// Serialize timetable changes within a centre, including class creation.
export const lockClassScheduling = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(${currentTenantId()}::integer, 63106)`;

type Slot = { date: Date; start_time: Date | null; end_time: Date | null; room_id: number | null; teacher_id: number | null };
const day = (value: Date) => value.toISOString().slice(0, 10);
const overlaps = (a: Slot, b: { date: Date; start_time: Date | null; end_time: Date | null }) =>
    day(a.date) === day(b.date) && a.start_time && a.end_time && b.start_time && b.end_time
    && a.start_time < b.end_time && a.end_time > b.start_time;

export async function assertClassResources(tx: Prisma.TransactionClient, values: { room_id?: number | null; teacher_id?: number | null }[]) {
    if (values.some(item => [item.room_id, item.teacher_id].some(id => id != null && (!Number.isInteger(id) || id <= 0 || id > 2147483647))))
        throw fail('ID phòng học/giảng viên không hợp lệ.', 400);
    const roomIds = [...new Set(values.flatMap(item => item.room_id ? [item.room_id] : []))];
    const teacherIds = [...new Set(values.flatMap(item => item.teacher_id ? [item.teacher_id] : []))];
    if (roomIds.length && await tx.room.count({ where: { id: { in: roomIds } } }) !== roomIds.length)
        throw fail('Phòng học không thuộc trung tâm hoặc không còn tồn tại.', 400);
    if (teacherIds.length && await tx.teacher.count({ where: { id: { in: teacherIds } } }) !== teacherIds.length)
        throw fail('Giảng viên không thuộc trung tâm hoặc không còn tồn tại.', 400);
    return { roomIds, teacherIds };
}

export async function assertClassScheduleAvailable(tx: Prisma.TransactionClient, slots: Slot[], excludeIds: number[] = [],
    students: { student_id: number; student: { full_name: string } }[] = []) {
    if (!slots.length) return;
    const duplicated = slots.find((slot, index) => slots.slice(index + 1).some(other => overlaps(slot, other)));
    if (duplicated) throw fail(`Lịch mới có hai buổi trùng nhau ngày ${day(duplicated.date).split('-').reverse().join('/')}.`);
    const { roomIds, teacherIds } = await assertClassResources(tx, slots);
    if (!roomIds.length && !teacherIds.length && !students.length) return;
    if (slots.some(item => !item.start_time || !item.end_time))
        throw fail('Buổi học chưa có đủ giờ bắt đầu/kết thúc. Hãy bổ sung lịch trước khi phân công.', 400);
    const studentIds = students.map(item => item.student_id);
    const others = await tx.schedule.findMany({ where: {
        id: { notIn: excludeIds }, date: { in: slots.map(item => item.date) }, status: { notIn: ['cancelled', 'completed'] },
        OR: [ ...(roomIds.length ? [{ room_id: { in: roomIds } }] : []),
            ...(teacherIds.length ? [{ teacher_id: { in: teacherIds } }] : []),
            ...(studentIds.length ? [{ class: { classEnrollments: { some: { status: 'active' as const, student_id: { in: studentIds } } } } }] : []) ],
    }, include: { room: { select: { name: true } }, teacher: { select: { full_name: true } },
        class: { select: { name: true, status: true, classEnrollments: {
            where: { status: 'active', student_id: { in: studentIds } }, select: { student_id: true },
        } } } } });
    for (const slot of slots) for (const other of others) {
        if (['cancelled', 'completed'].includes(other.class?.status || '') || !overlaps(slot, other)) continue;
        const at = `${day(other.date).split('-').reverse().join('/')} (${other.start_time!.toISOString().slice(11, 16)}–${other.end_time!.toISOString().slice(11, 16)})`;
        const withClass = `lớp ${other.class?.name || 'chưa đặt tên'} ngày ${at}`;
        if (slot.room_id && slot.room_id === other.room_id) throw fail(`Phòng ${other.room?.name || slot.room_id} trùng lịch ${withClass}.`);
        if (slot.teacher_id && slot.teacher_id === other.teacher_id) throw fail(`Giảng viên ${other.teacher?.full_name || slot.teacher_id} trùng lịch ${withClass}.`);
        const student = students.find(item => other.class?.classEnrollments.some(enrollment => enrollment.student_id === item.student_id));
        if (student) throw fail(`Học viên ${student.student.full_name} trùng lịch ${withClass}.`);
    }
}

export async function synchronizeClassSchedule(tx: Prisma.TransactionClient, existing: Class, change: {
    reschedule: boolean; templateChanged: boolean; close: boolean; dates?: Date[]; startTime?: Date; endTime?: Date;
    room_id?: number | null; teacher_id?: number | null; endDate?: Date | null;
}, now = new Date()) {
    await tx.$queryRaw`SELECT id FROM schedules WHERE class_id = ${existing.id} ORDER BY id FOR UPDATE`;
    const rows = await tx.schedule.findMany({ where: { class_id: existing.id },
        include: { _count: { select: { attendances: true } } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
    const editable = rows.filter(item => item.status === 'scheduled' && !item._count.attendances && scheduleMoment(item.date, item.start_time) > now
        && !(change.reschedule && !change.close && sessionChangeInfo(item.memo, item.status).isMakeup));
    const fixed = rows.filter(item => !editable.includes(item));
    if (change.reschedule && !change.close && change.endDate && fixed.some(item => item.status !== 'cancelled'
        && sessionChangeInfo(item.memo, item.status).isMakeup && day(item.date) > day(change.endDate!)))
        throw fail('Ngày kết thúc không được trước buổi học bù đã xếp. Vui lòng kiểm tra lịch học bù.', 400);
    if (change.reschedule && !change.close && !change.dates && editable.length)
        throw fail('Nhập đủ ngày bắt đầu, kết thúc, thứ học và giờ học để đồng bộ các buổi sắp tới.', 400);
    const resources = (row?: typeof rows[number]) => ({
        room_id: change.room_id !== undefined ? change.room_id : row?.room_id ?? existing.room_id,
        teacher_id: change.teacher_id !== undefined ? change.teacher_id : row?.teacher_id ?? existing.teacher_id,
    });
    const planned: { id?: number; data: Slot }[] = [];
    if (!change.close && change.reschedule && change.dates && change.startTime && change.endTime) {
        const reservedDays = new Set(fixed.filter(item => !editable.some(row => day(row.date) === day(item.date))
            && (item.status !== 'cancelled' || !change.templateChanged)).map(item => day(item.date)));
        const individuallyChanged = rows.some(item => sessionChangeInfo(item.memo, item.status).history.length);
        for (const row of rows) for (const entry of sessionChangeInfo(row.memo, row.status).history) {
            if (entry.action === 'cancel' && !editable.some(item => day(item.date) === entry.date)) reservedDays.add(entry.date);
        }
        if (change.dates.some(date => editable.some(item => day(item.date) === day(date)) && !reservedDays.has(day(date))
            && scheduleMoment(date, change.startTime!) <= now))
            throw fail('Giờ mới của một buổi sắp tới đã qua. Vui lòng chọn ngày/giờ chưa bắt đầu.', 400);
        let dates = change.dates.filter(date => scheduleMoment(date, change.startTime!) > now && !reservedDays.has(day(date)));
        // An extended end date for makeup must not generate additional regular lessons.
        if (individuallyChanged) dates = dates.slice(0, editable.length);
        const sameDay = new Map(dates.map(date => [day(date), editable.find(item => day(item.date) === day(date))]));
        const spare = editable.filter(item => ![...sameDay.values()].includes(item));
        for (const date of dates) {
            const row = sameDay.get(day(date)) || spare.shift();
            planned.push({ id: row?.id, data: { date, start_time: change.startTime, end_time: change.endTime, ...resources(row) } });
        }
    } else if (!change.close) {
        for (const row of editable) planned.push({ id: row.id, data: { date: row.date, start_time: row.start_time, end_time: row.end_time, ...resources(row) } });
    }
    let students: { student_id: number; student: { full_name: string } }[] = [];
    if (change.reschedule && planned.length) {
        await tx.$queryRaw`SELECT s.id FROM students s JOIN class_enrollments e ON e.student_id = s.id
            WHERE e.class_id = ${existing.id} AND e.status = 'active' ORDER BY s.id FOR UPDATE OF s`;
        students = await tx.classEnrollment.findMany({ where: { class_id: existing.id, status: 'active' },
            select: { student_id: true, student: { select: { full_name: true } } } });
    }
    if (!planned.length) await assertClassResources(tx, [change]);
    await assertClassScheduleAvailable(tx, planned.map(item => item.data), editable.map(item => item.id), students);
    // Freeze inherited historical assignments before changing the class defaults.
    for (const row of fixed) {
        const snapshot = { ...(!row.room_id && existing.room_id ? { room_id: existing.room_id } : {}),
            ...(!row.teacher_id && existing.teacher_id ? { teacher_id: existing.teacher_id } : {}) };
        if (Object.keys(snapshot).length) await tx.schedule.update({ where: { id: row.id }, data: snapshot });
    }
    const cancelled = editable.filter(row => !planned.some(item => item.id === row.id));
    if (cancelled.length) await tx.schedule.updateMany({ where: { id: { in: cancelled.map(item => item.id) } }, data: { status: 'cancelled' } });
    let updated = 0, created = 0;
    for (const item of planned) {
        if (item.id) {
            const old = editable.find(row => row.id === item.id)!;
            const changed = day(old.date) !== day(item.data.date) || old.start_time?.getTime() !== item.data.start_time?.getTime()
                || old.end_time?.getTime() !== item.data.end_time?.getTime() || old.room_id !== item.data.room_id || old.teacher_id !== item.data.teacher_id;
            if (changed) { await tx.schedule.update({ where: { id: item.id }, data: item.data }); updated++; }
        } else { await tx.schedule.create({ data: { class_id: existing.id, ...item.data } }); created++; }
    }
    return { updated, created, cancelled: cancelled.length, kept: fixed.length,
        incomplete: change.reschedule && !change.close && !change.dates };
}

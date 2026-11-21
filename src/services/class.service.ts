import { Prisma, ClassStatus } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { classRepository } from '../repositories/class.repository';
import { createClassInvoice } from '../repositories/classInvoice';
import { classReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';
import { classDateDay, effectiveClassStatus, vietnamClassDay } from '../utils/classStatus';
import { enrollmentConflict, remainingSchedules, remainingScheduleWhere } from '../utils/enrollmentSchedule';
import { lockClassScheduling, scheduleMoment, synchronizeClassSchedule } from '../utils/classScheduling';
import { assertClassCourse, courseScheduleDates } from '../utils/courseSchedule';

export interface GetClassesQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: ClassStatus;
    course_id?: number;
    teacher_id?: number;
    unassigned_teacher?: boolean;
}

export interface CreateClassInput {
    name: string;
    course_id?: number;
    fee_plan_id?: number;
    teacher_id?: number;
    room_id?: number;
    status?: ClassStatus;
    start_date?: Date;
    end_date?: Date;
    schedule_days?: number[];
    schedule_time?: string[];
    max_students?: number;
}

export interface UpdateClassInput extends Partial<Omit<CreateClassInput, 'teacher_id' | 'room_id'>> {
    teacher_id?: number | null;
    room_id?: number | null;
}

export class ClassService {
    private validateClassDates(data: { start_date?: Date | null; end_date?: Date | null; status?: ClassStatus }) {
        if ((data.start_date && !classDateDay(data.start_date)) || (data.end_date && !classDateDay(data.end_date))) {
            throw this.createHttpError('Ngày bắt đầu hoặc ngày kết thúc không hợp lệ.', 400);
        }
        if (data.start_date && data.end_date && classDateDay(data.end_date)! < classDateDay(data.start_date)!) {
            throw this.createHttpError('Ngày kết thúc phải từ ngày bắt đầu trở đi.', 400);
        }
        if (data.status !== undefined && !Object.values(ClassStatus).includes(data.status)) {
            throw this.createHttpError('Trạng thái lớp học không hợp lệ.', 400);
        }
    }
    private createHttpError(message: string, statusCode: number) {
        const err = new Error(message);
        (err as any).statusCode = statusCode;
        return err;
    }

    async getClasses(query: GetClassesQuery, actor: AcademicActor) {
        const { page = 1, limit = 10, search, status, course_id, teacher_id, unassigned_teacher } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.ClassWhereInput = { AND: [classReadScope(actor)] };

        if (search) {
            where.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        if (status) {
            where.status = status;
        }

        if (course_id) {
            where.course_id = course_id;
        }

        if (unassigned_teacher) {
            where.teacher_id = null;
        } else if (teacher_id) {
            where.teacher_id = teacher_id;
        }

        const [total, classes] = await Promise.all([
            classRepository.count(where),
            classRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
            })
        ]);

        return {
            data: classes,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getClassById(id: number, actor: AcademicActor) {
        return classRepository.findById(id, actor);
    }

    async getClassFilterOptions(actor: AcademicActor) {
        return classRepository.getFilterOptions(actor);
    }

    // Helper function to parse HH:mm into Date object (1970-01-01)
    public parseTimeToDate(timeString: string): Date {
        const match = String(timeString).trim().match(/^(\d{1,2}):(\d{2})$/);

        if (!match) {
            throw this.createHttpError(`Giờ học không hợp lệ: ${timeString}`, 400);
        }

        const hours = Number(match[1]);
        const minutes = Number(match[2]);

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw this.createHttpError(`Giờ học không hợp lệ: ${timeString}`, 400);
        }

        return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
    }

    public generateScheduleDates(startDate: Date, endDate: Date, scheduleDays: number[]): Date[] {
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            throw this.createHttpError('Ngày bắt đầu hoặc ngày kết thúc không hợp lệ', 400);
        }

        if (!scheduleDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
            throw this.createHttpError('schedule_days không hợp lệ', 400);
        }

        const dates: Date[] = [];

        let y = startDate.getUTCFullYear();
        let m = startDate.getUTCMonth();
        let d = startDate.getUTCDate();

        const endY = endDate.getUTCFullYear();
        const endM = endDate.getUTCMonth();
        const endD = endDate.getUTCDate();

        while (true) {
            const current = new Date(Date.UTC(y, m, d));
            if (
                current.getUTCFullYear() > endY ||
                (current.getUTCFullYear() === endY && current.getUTCMonth() > endM) ||
                (current.getUTCFullYear() === endY && current.getUTCMonth() === endM && current.getUTCDate() > endD)
            ) break;

            if (scheduleDays.includes(current.getUTCDay())) {
                dates.push(current);
            }

            d++;
            const next = new Date(Date.UTC(y, m, d));
            y = next.getUTCFullYear();
            m = next.getUTCMonth();
            d = next.getUTCDate();
        }

        return dates;
    }

    async getMyClasses(user_id: number, role: string) {
        const actor = { userId: user_id, role: role as AcademicActor['role'] };
        return prisma.class.findMany({
            where: classReadScope(actor),
            include: { room: true, course: true, classEnrollments: { where: enrollmentReadScope(actor) },
                _count: { select: { classEnrollments: { where: { status: 'active' } } } } },
            orderBy: { id: 'desc' },
        });
    }

    async createClass(data: CreateClassInput) {
        let courseDates: Date[] | undefined;
        if (data.course_id !== undefined) {
            if (!Number.isInteger(data.course_id) || data.course_id <= 0 || data.course_id > 2147483647)
                throw this.createHttpError('ID khóa học không hợp lệ.', 400);
            const course = await prisma.course.findFirst({ where: { id: data.course_id, is_active: true },
                select: { total_sessions: true } });
            if (!course) throw this.createHttpError('Khóa học không tồn tại hoặc đã tạm dừng.', 400);
            if (course.total_sessions != null && data.start_date && data.schedule_days) {
                courseDates = courseScheduleDates(data.start_date, data.schedule_days, course.total_sessions);
                data = { ...data, end_date: courseDates[courseDates.length - 1] };
            }
        }
        this.validateClassDates(data);
        let generatedSchedules: Prisma.ScheduleCreateManyInput[] = [];

        if (data.start_date && data.end_date && data.schedule_days && data.schedule_time && data.schedule_time.length === 2) {
            const startTimeDb = this.parseTimeToDate(data.schedule_time[0]);
            const endTimeDb = this.parseTimeToDate(data.schedule_time[1]);
            if (endTimeDb <= startTimeDb) throw this.createHttpError('Giờ kết thúc phải sau giờ bắt đầu.', 400);

            // Sinh danh sách ngày học
            const datesToCheck = courseDates ?? this.generateScheduleDates(new Date(data.start_date), new Date(data.end_date), data.schedule_days);

            for (const d of datesToCheck) {
                generatedSchedules.push({
                    date: d,
                    start_time: startTimeDb,
                    end_time: endTimeDb,
                    room_id: data.room_id || null,
                    teacher_id: data.teacher_id || null,
                    status: 'scheduled'
                });
            }

            if (generatedSchedules.length === 0) {
                const err = new Error('Khoảng thời gian không sinh ra buổi học nào (kiểm tra start_date, end_date và schedule_days)');
                (err as any).statusCode = 400;
                throw err;
            }


        }

        // Chuyển mảng thành chuỗi để lưu vào DB (vì schema đang để là String)
        const classInput: Prisma.ClassUncheckedCreateInput = {
            ...data,
            status: effectiveClassStatus({ ...data, status: data.status ?? 'upcoming' }),
            schedule_days: data.schedule_days ? JSON.stringify(data.schedule_days) : undefined,
            schedule_time: data.schedule_time ? JSON.stringify(data.schedule_time) : undefined,
        };

        if (generatedSchedules.length > 0) {
            return await classRepository.createWithSchedules(classInput, generatedSchedules);
        } else {
            return await classRepository.create(classInput);
        }
    }

    async updateClass(id: number, data: UpdateClassInput) {
        if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw this.createHttpError('ID lớp không hợp lệ.', 400);
        for (const resource of [data.teacher_id, data.room_id]) if (resource !== undefined && resource !== null
            && (!Number.isInteger(resource) || resource <= 0 || resource > 2147483647)) throw this.createHttpError('ID giáo viên/phòng học không hợp lệ.', 400);
        return withTenantTx(async tx => {
            await lockClassScheduling(tx);
            await tx.$queryRaw`SELECT id FROM classes WHERE id = ${id} FOR UPDATE`;
            const existing = await tx.class.findUnique({ where: { id } });
            if (!existing) return null;
            if (data.course_id !== undefined && data.course_id !== existing.course_id) await assertClassCourse(tx, data.course_id);
            const { schedule_days, schedule_time, ...fields } = data;
            const classData: Prisma.ClassUncheckedUpdateInput = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
            const dates = { status: data.status ?? existing.status,
                start_date: data.start_date ?? existing.start_date, end_date: data.end_date ?? existing.end_date };
            this.validateClassDates(dates);
            if (data.start_date !== undefined || data.end_date !== undefined || data.status !== undefined) classData.status = effectiveClassStatus(dates);
            const list = (value: string | null) => {
                if (!value) return [];
                try { const result = JSON.parse(value); if (Array.isArray(result)) return result; } catch { /* Legacy comma-separated format. */ }
                return value.split(',').map(item => item.trim());
            };
            const oldDays = list(existing.schedule_days).map(value => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[value as string] ?? Number(value)));
            const reschedule = schedule_days !== undefined || schedule_time !== undefined || data.start_date !== undefined || data.end_date !== undefined;
            const days = schedule_days !== undefined ? schedule_days : oldDays;
            const times = schedule_time !== undefined ? schedule_time : list(existing.schedule_time).map(value => String(value).match(/(?:^|T)(\d{2}:\d{2})/)?.[1] || '');
            if (reschedule && (!Array.isArray(days) || days.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw this.createHttpError('Thứ học không hợp lệ.', 400);
            if (reschedule && (!Array.isArray(times) || (times.length && times.length !== 2))) throw this.createHttpError('Chọn đủ giờ bắt đầu và kết thúc.', 400);
            const startTime = reschedule && times.length ? this.parseTimeToDate(times[0]) : undefined;
            const endTime = reschedule && times.length ? this.parseTimeToDate(times[1]) : undefined;
            if (startTime && endTime && endTime <= startTime) throw this.createHttpError('Giờ kết thúc phải sau giờ bắt đầu.', 400);
            if (schedule_days !== undefined) classData.schedule_days = JSON.stringify(days);
            if (schedule_time !== undefined) classData.schedule_time = JSON.stringify(times);
            const templateChanged = JSON.stringify([...days].sort()) !== JSON.stringify([...oldDays].sort())
                || (schedule_time !== undefined && JSON.stringify(times) !== JSON.stringify(list(existing.schedule_time)))
                || (data.start_date !== undefined && classDateDay(data.start_date) !== classDateDay(existing.start_date))
                || (data.end_date !== undefined && classDateDay(data.end_date) !== classDateDay(existing.end_date));
            const close = ['cancelled', 'completed'].includes(effectiveClassStatus(dates));
            let schedule_sync;
            if (reschedule || data.room_id !== undefined || data.teacher_id !== undefined || data.status !== undefined) {
                const plannedDates = dates.start_date && dates.end_date && days.length && startTime && endTime
                    ? this.generateScheduleDates(dates.start_date, dates.end_date, days) : undefined;
                if (plannedDates && !plannedDates.length && !close) throw this.createHttpError('Khoảng ngày và thứ học không tạo ra buổi học nào.', 400);
                schedule_sync = await synchronizeClassSchedule(tx, existing, { reschedule, templateChanged, close,
                    dates: plannedDates, startTime, endTime, teacher_id: data.teacher_id, room_id: data.room_id, endDate: dates.end_date });
            }
            const updated = await tx.class.update({ where: { id }, data: classData });
            return { ...updated, ...(schedule_sync ? { schedule_sync } : {}) };
        }, { maxWait: 10000, timeout: 30000 });
    }

    private async availabilitySlots(startDate: Date, endDate: Date, days: number[], times: string[], classId?: number, actor?: AcademicActor) {
        const now = new Date();
        if (classId !== undefined) {
            if (!Number.isInteger(classId) || classId <= 0 || classId > 2147483647) throw this.createHttpError('ID lớp không hợp lệ.', 400);
            const cls = await prisma.class.findFirst({ where: { id: classId, ...(actor ? classReadScope(actor) : {}) }, select: { id: true } });
            if (!cls) throw this.createHttpError('Không tìm thấy lớp trong phạm vi được xem.', 404);
            const rows = await prisma.schedule.findMany({ where: { class_id: classId, status: 'scheduled',
                date: { gte: new Date(`${vietnamClassDay(now)}T00:00:00Z`) }, attendances: { none: {} } },
                select: { date: true, start_time: true, end_time: true } });
            return rows.filter(row => scheduleMoment(row.date, row.start_time) > now);
        }
        if (!Array.isArray(times) || times.length !== 2) throw this.createHttpError('Chọn đủ giờ bắt đầu/kết thúc.', 400);
        const start_time = this.parseTimeToDate(times[0]), end_time = this.parseTimeToDate(times[1]);
        if (end_time <= start_time) throw this.createHttpError('Giờ kết thúc phải sau giờ bắt đầu.', 400);
        return this.generateScheduleDates(startDate, endDate, days).map(date => ({ date, start_time, end_time }))
            .filter(row => scheduleMoment(row.date, row.start_time) > now);
    }

    async getAvailableRooms(startDate: Date, endDate: Date, scheduleDays: number[], scheduleTime: string[], excludeClassId?: number, actor?: AcademicActor) {
        const slots = await this.availabilitySlots(startDate, endDate, scheduleDays, scheduleTime, excludeClassId, actor);

        const allRooms = await prisma.room.findMany({
            where: { is_active: true },
            select: { id: true, name: true, capacity: true },
            orderBy: { name: 'asc' }
        });

        if (!slots.length) {
            return allRooms.map(room => ({ ...room, is_available: true }));
        }

        const { conflictingRooms } = await classRepository.findConflictingResources(slots, excludeClassId);

        return allRooms.map(room => ({
            ...room,
            is_available: !conflictingRooms.includes(room.id)
        }));
    }

    async getAvailableTeachers(startDate: Date, endDate: Date, scheduleDays: number[], scheduleTime: string[], excludeClassId?: number, actor?: AcademicActor) {
        const slots = await this.availabilitySlots(startDate, endDate, scheduleDays, scheduleTime, excludeClassId, actor);

        const allTeachers = await prisma.teacher.findMany({
            where: { is_active: true },
            select: { id: true, full_name: true, email: true },
            orderBy: { full_name: 'asc' }
        });

        if (!slots.length) {
            return allTeachers.map(teacher => ({ ...teacher, is_available: true }));
        }

        const { conflictingTeachers } = await classRepository.findConflictingResources(slots, excludeClassId);

        return allTeachers.map(teacher => ({
            ...teacher,
            is_available: !conflictingTeachers.includes(teacher.id)
        }));
    }

    // Kiểm tra trùng lịch cho học viên trước khi xếp lớp
    async checkStudentConflicts(class_id: number, student_ids: number[]) {
        student_ids = this.validateEnrollmentIds(class_id, student_ids);
        const now = new Date();
        const targetClass = await prisma.class.findUnique({
            where: { id: class_id },
            include: {
                classEnrollments: true,
                schedules: { where: remainingScheduleWhere(now) }
            }
        });
        if (!targetClass) {
            const err = new Error('Không tìm thấy Lớp học');
            (err as any).statusCode = 404;
            throw err;
        }
        if (!['upcoming', 'ongoing'].includes(effectiveClassStatus(targetClass))) {
            throw this.createHttpError('Chỉ có thể xếp vào lớp sắp mở hoặc đang học.', 400);
        }
        const studentEnrollments = await prisma.classEnrollment.findMany({
            where: {
                student_id: { in: student_ids },
                status: 'active'
            },
            include: {
                class: {
                    include: {
                        schedules: {
                            where: remainingScheduleWhere(now)
                        }
                    }
                }
            }
        });
        const targetSchedules = targetClass.schedules;
        const result: Record<number, { has_conflict: boolean; is_already_enrolled: boolean; reason?: string }> = {};
        for (const s_id of student_ids) {
            const previous = targetClass.classEnrollments.find(item => item.student_id === s_id);
            if (previous && previous.status !== 'dropped') {
                result[s_id] = {
                    has_conflict: false,
                    is_already_enrolled: true,
                    reason: previous.status === 'completed' ? 'Đã hoàn thành lớp học này' : 'Đang học trong lớp này'
                };
                continue;
            }
            const myEnrollments = studentEnrollments.filter((e: any) => e.student_id === s_id);
            const conflictReason = enrollmentConflict(class_id, targetSchedules, myEnrollments, now);
            const missingTimes = targetSchedules.some(item => !item.start_time || !item.end_time)
                || myEnrollments.some(item => !['cancelled', 'completed'].includes(item.class.status)
                    && item.class.schedules.some(session => !session.start_time || !session.end_time));
            result[s_id] = {
                has_conflict: !!conflictReason,
                is_already_enrolled: false,
                reason: conflictReason || (missingTimes ? 'Thiếu giờ học để đối chiếu'
                    : !remainingSchedules(targetSchedules, now).length ? 'Lớp chưa có lịch học còn lại để đối chiếu' : undefined)
            };
        }
        return result;
    }
    private validateEnrollmentIds(classId: number, studentIds: number[]) {
        if (!Number.isInteger(classId) || classId <= 0 || classId > 2147483647 || !Array.isArray(studentIds)
            || !studentIds.length || studentIds.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647))
            throw this.createHttpError('ID lớp hoặc danh sách học viên không hợp lệ.', 400);
        return [...new Set(studentIds)].sort((a, b) => a - b);
    }
    async enrollStudents(class_id: number, student_ids: number[], allow_conflicts: boolean = false) {
        student_ids = this.validateEnrollmentIds(class_id, student_ids);
        const now = new Date();
        return withTenantTx(async tx => {
            await tx.$queryRaw`SELECT id FROM classes WHERE id = ${class_id} FOR UPDATE`;
            const students = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM students WHERE id IN (${Prisma.join(student_ids)}) ORDER BY id FOR UPDATE`);
            const studentIds = new Set(students.map(item => item.id));
            // 1. Lấy thông tin lớp học, sĩ số và lịch học
            const targetClass = await tx.class.findUnique({
                where: { id: class_id },
                include: {
                    classEnrollments: true,
                    schedules: { where: remainingScheduleWhere(now) }
                }
            });

            if (!targetClass) {
                const err = new Error('Không tìm thấy Lớp học');
                (err as any).statusCode = 404;
                throw err;
            }

            if (!['upcoming', 'ongoing'].includes(effectiveClassStatus(targetClass))) {
                throw this.createHttpError('Chỉ có thể xếp vào lớp sắp mở hoặc đang học.', 400);
            }
            const successful_ids: number[] = [];
            const failed: { student_id: number, reason: string }[] = [];

            // Lấy tất cả lịch học tương lai của các học viên trong danh sách
            const studentEnrollments = await tx.classEnrollment.findMany({
                where: {
                    student_id: { in: student_ids },
                    status: 'active'
                },
                include: {
                    class: {
                        include: {
                            schedules: {
                                where: remainingScheduleWhere(now)
                            }
                        }
                    }
                }
            });

            const targetSchedules = targetClass.schedules;

            for (const s_id of student_ids) {
                if (!studentIds.has(s_id)) { failed.push({ student_id: s_id, reason: 'Không tìm thấy học viên trong trung tâm.' }); continue; }
                // Check Duplicate
                const previous = targetClass.classEnrollments.find(item => item.student_id === s_id);
                if (previous && previous.status !== 'dropped') {
                    failed.push({ student_id: s_id, reason: previous.status === 'completed' ? 'Đã hoàn thành lớp học này' : 'Đang học trong lớp này' });
                    continue;
                }

                // Check Conflict
                const myEnrollments = studentEnrollments.filter((e: any) => e.student_id === s_id);
                const conflict = enrollmentConflict(class_id, targetSchedules, myEnrollments, now);
                if (conflict && !allow_conflicts) failed.push({ student_id: s_id, reason: conflict });
                else successful_ids.push(s_id);
            }
            const currentCount = targetClass.classEnrollments.filter(item => item.status === 'active').length;
            const available = targetClass.max_students ? Math.max(0, targetClass.max_students - currentCount) : Infinity;
            if (successful_ids.length > available)
                throw this.createHttpError(`Lớp học sẽ vượt quá sĩ số. Chỉ còn trống ${available} chỗ.`, 400);

            if (successful_ids.length > 0) {
                const restoreIds = successful_ids.filter(id => targetClass.classEnrollments.some(item => item.student_id === id && item.status === 'dropped'));
                const newIds = successful_ids.filter(id => !restoreIds.includes(id));
                const dataToInsert = newIds.map(id => ({
                    class_id,
                    student_id: id
                    // status là active theo default trong DB
                }));
                if (dataToInsert.length) await tx.classEnrollment.createMany({
                    data: dataToInsert
                });
                if (restoreIds.length) await tx.classEnrollment.updateMany({
                    where: { class_id, student_id: { in: restoreIds }, status: 'dropped' }, data: { status: 'active' },
                });
                // Restoring an enrollment preserves its original billing; new enrollment may reuse a legacy invoice.
                for (const studentId of newIds) {
                    await createClassInvoice(tx, {
                        class_id,
                        student_id: studentId,
                        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        notes: 'Khoản thu được tạo tự động khi ghi danh vào lớp', allowEmpty: true, reuseExisting: true,
                    });
                }
            }

            return {
                successful: successful_ids,
                failed: failed
            };
        }, { timeout: 30_000 });
    }

    async unenrollStudent(class_id: number, student_id: number) {
        this.validateEnrollmentIds(class_id, [student_id]);
        return withTenantTx(async tx => {
            await tx.$queryRaw`SELECT id FROM classes WHERE id = ${class_id} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM students WHERE id = ${student_id} FOR UPDATE`;
            const enrollment = await tx.classEnrollment.findFirst({ where: { class_id, student_id } });
            if (!enrollment) throw this.createHttpError('Học viên không có trong lớp học này', 404);
            if (enrollment.status === 'completed') throw this.createHttpError('Học viên đã hoàn thành lớp này, không chuyển sang nghỉ lớp.', 400);
            if (enrollment.status === 'active') await tx.classEnrollment.updateMany({
                where: { id: enrollment.id, status: 'active' }, data: { status: 'dropped' },
            });
            return { success: true, message: 'Đã ghi nhận học viên nghỉ lớp. Học phí và dữ liệu học tập được giữ nguyên.' };
        });
    }

}

export const classService = new ClassService();

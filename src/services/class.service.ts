import { Prisma, ClassStatus } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { classRepository } from '../repositories/class.repository';
import { createClassInvoice } from '../repositories/classInvoice';
import { classReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';
import { classDateDay, effectiveClassStatus } from '../utils/classStatus';

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

export interface UpdateClassInput extends Partial<CreateClassInput> { }

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
            include: { room: true, course: true, classEnrollments: { where: enrollmentReadScope(actor) } },
            orderBy: { id: 'desc' },
        });
    }

    async createClass(data: CreateClassInput) {
        this.validateClassDates(data);
        let generatedSchedules: Prisma.ScheduleCreateManyInput[] = [];

        if (data.start_date && data.end_date && data.schedule_days && data.schedule_time && data.schedule_time.length === 2) {
            const startTimeDb = this.parseTimeToDate(data.schedule_time[0]);
            const endTimeDb = this.parseTimeToDate(data.schedule_time[1]);

            // Sinh danh sách ngày học
            const datesToCheck = this.generateScheduleDates(new Date(data.start_date), new Date(data.end_date), data.schedule_days);

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

            // 1. Kiểm tra trùng lịch Phòng học
            // Helper để format giờ từ DB ra chuỗi HH:mm
            const formatTime = (d: Date | null) => {
                if (!d) return 'Unknown';
                return d.toISOString().substring(11, 16);
            };

            // 1. Kiểm tra trùng lịch Phòng học
            if (data.room_id) {
                const roomConflict = await classRepository.checkScheduleConflict(
                    data.room_id,
                    null,
                    datesToCheck,
                    startTimeDb,
                    endTimeDb
                );

                if (roomConflict) {
                    const dateStr = roomConflict.date.toISOString().split('T')[0];
                    const timeStr = `${formatTime(roomConflict.start_time)} - ${formatTime(roomConflict.end_time)}`;
                    const err = new Error(`Trùng lịch Phòng học! Phòng này đã có lớp vào ngày ${dateStr} trong khung giờ ${timeStr}. Vui lòng chọn phòng khác.`);
                    (err as any).statusCode = 409;
                    throw err;
                }
            }

            // 2. Kiểm tra trùng lịch Giáo viên
            if (data.teacher_id) {
                const teacherConflict = await classRepository.checkScheduleConflict(
                    null,
                    data.teacher_id,
                    datesToCheck,
                    startTimeDb,
                    endTimeDb
                );

                if (teacherConflict) {
                    const dateStr = teacherConflict.date.toISOString().split('T')[0];
                    const timeStr = `${formatTime(teacherConflict.start_time)} - ${formatTime(teacherConflict.end_time)}`;
                    const err = new Error(`Trùng lịch Giáo viên! Giáo viên này đã có lịch dạy vào ngày ${dateStr} trong khung giờ ${timeStr}. Vui lòng xếp giáo viên khác.`);
                    (err as any).statusCode = 409;
                    throw err;
                }
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
        const existing = await classRepository.checkExistence(id);
        if (!existing) return null;

        const { schedule_days, schedule_time, ...fields } = data;
        const classData: Prisma.ClassUncheckedUpdateInput = { ...fields,
            ...(schedule_days !== undefined ? { schedule_days: JSON.stringify(schedule_days) } : {}),
            ...(schedule_time !== undefined ? { schedule_time: JSON.stringify(schedule_time) } : {}),
        };
        if (data.start_date !== undefined || data.end_date !== undefined || data.status !== undefined) {
            const dates = { status: data.status ?? existing.status,
                start_date: data.start_date ?? existing.start_date, end_date: data.end_date ?? existing.end_date };
            this.validateClassDates(dates);
            classData.status = effectiveClassStatus(dates);
        }
        const scheduleData: Prisma.ScheduleUncheckedUpdateManyInput = {};

        if (data.room_id !== undefined) {
            scheduleData.room_id = data.room_id;
        }

        if (data.teacher_id !== undefined) {
            scheduleData.teacher_id = data.teacher_id;
        }

        if (Object.keys(scheduleData).length > 0) {
            const schedules = await classRepository.findFutureSchedulesByClassId(id);

            for (const schedule of schedules) {
                if (!schedule.start_time || !schedule.end_time) continue;

                const conflict = await classRepository.findScheduleResourceConflict(
                    id,
                    data.room_id ?? null,
                    data.teacher_id ?? null,
                    schedule.date,
                    schedule.start_time,
                    schedule.end_time
                );

                if (conflict) {
                    const err = new Error('Phòng hoặc giảng viên đã có lịch trùng với lớp khác. Vui lòng chọn lại.');
                    (err as any).statusCode = 409;
                    throw err;
                }
            }

            return await classRepository.updateWithFutureSchedules(id, classData, scheduleData);
        }

        return await classRepository.update(id, classData);
    }

    async getAvailableRooms(startDate: Date, endDate: Date, scheduleDays: number[], scheduleTime: string[], excludeClassId?: number) {
        if (scheduleTime.length !== 2) throw new Error('Invalid schedule_time');

        const startTimeDb = this.parseTimeToDate(scheduleTime[0]);
        const endTimeDb = this.parseTimeToDate(scheduleTime[1]);
        const datesToCheck = this.generateScheduleDates(startDate, endDate, scheduleDays);

        const allRooms = await prisma.room.findMany({
            where: { is_active: true },
            select: { id: true, name: true, capacity: true },
            orderBy: { name: 'asc' }
        });

        if (datesToCheck.length === 0) {
            return allRooms.map(room => ({ ...room, is_available: true }));
        }

        const { conflictingRooms } = await classRepository.findConflictingResources(datesToCheck, startTimeDb, endTimeDb, excludeClassId);

        return allRooms.map(room => ({
            ...room,
            is_available: !conflictingRooms.includes(room.id)
        }));
    }

    async getAvailableTeachers(startDate: Date, endDate: Date, scheduleDays: number[], scheduleTime: string[], excludeClassId?: number) {
        if (scheduleTime.length !== 2) throw new Error('Invalid schedule_time');

        const startTimeDb = this.parseTimeToDate(scheduleTime[0]);
        const endTimeDb = this.parseTimeToDate(scheduleTime[1]);
        const datesToCheck = this.generateScheduleDates(startDate, endDate, scheduleDays);

        const allTeachers = await prisma.teacher.findMany({
            where: { is_active: true },
            select: { id: true, full_name: true, email: true },
            orderBy: { full_name: 'asc' }
        });

        if (datesToCheck.length === 0) {
            return allTeachers.map(teacher => ({ ...teacher, is_available: true }));
        }

        const { conflictingTeachers } = await classRepository.findConflictingResources(datesToCheck, startTimeDb, endTimeDb, excludeClassId);

        return allTeachers.map(teacher => ({
            ...teacher,
            is_available: !conflictingTeachers.includes(teacher.id)
        }));
    }

    // Kiểm tra trùng lịch cho học viên trước khi xếp lớp
    async checkStudentConflicts(class_id: number, student_ids: number[]) {
        const targetClass = await prisma.class.findUnique({
            where: { id: class_id },
            include: {
                classEnrollments: { where: { status: 'active' } },
                schedules: { where: { date: { gte: new Date() } } }
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
                            where: { date: { gte: new Date() } }
                        }
                    }
                }
            }
        });
        const targetSchedules = targetClass.schedules;
        const enrolledStudentIds = new Set(targetClass.classEnrollments.map((e: any) => e.student_id));
        const result: Record<number, { has_conflict: boolean; is_already_enrolled: boolean; reason?: string }> = {};
        for (const s_id of student_ids) {
            if (enrolledStudentIds.has(s_id)) {
                result[s_id] = {
                    has_conflict: false,
                    is_already_enrolled: true,
                    reason: 'Đã có trong lớp học này'
                };
                continue;
            }
            const myEnrollments = studentEnrollments.filter((e: any) => e.student_id === s_id);
            let hasConflict = false;
            let conflictReason = '';
            for (const enrollment of myEnrollments) {
                if (hasConflict) break;
                // Bỏ qua nếu chính là lớp hiện tại
                if (enrollment.class_id === class_id) continue;
                const existingSchedules = enrollment.class.schedules;
                for (const newSch of targetSchedules) {
                    if (hasConflict) break;
                    if (!newSch.start_time || !newSch.end_time) continue;
                    for (const exSch of existingSchedules) {
                        if (!exSch.start_time || !exSch.end_time) continue;
                        const dateA = new Date(newSch.date).toISOString().slice(0, 10);
                        const dateB = new Date(exSch.date).toISOString().slice(0, 10);
                        if (dateA === dateB) {
                            if (newSch.start_time < exSch.end_time && newSch.end_time > exSch.start_time) {
                                hasConflict = true;
                                conflictReason = `Trùng với ${enrollment.class.name} (${dateA})`;
                                break;
                            }
                        }
                    }
                }
            }
            result[s_id] = {
                has_conflict: hasConflict,
                is_already_enrolled: false,
                reason: hasConflict ? conflictReason : undefined
            };
        }
        return result;
    }
    async enrollStudents(class_id: number, student_ids: number[], allow_conflicts: boolean = false) {
        student_ids = [...new Set(student_ids)].sort((a, b) => a - b);
        if (!student_ids.length || student_ids.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
            throw this.createHttpError('Danh sách học viên không hợp lệ.', 400);
        }
        return withTenantTx(async tx => {
            await tx.$queryRaw`SELECT id FROM classes WHERE id = ${class_id} FOR UPDATE`;
            await tx.$queryRaw(Prisma.sql`SELECT id FROM students WHERE id IN (${Prisma.join(student_ids)}) ORDER BY id FOR UPDATE`);
            // 1. Lấy thông tin lớp học, sĩ số và lịch học
            const targetClass = await tx.class.findUnique({
                where: { id: class_id },
                include: {
                    classEnrollments: { where: { status: 'active' } },
                    schedules: { where: { date: { gte: new Date() } } } // Chỉ lấy lịch tương lai
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
            // 2. Rào chắn 1: Kiểm tra Sĩ số (Capacity)
            if (targetClass.max_students && (targetClass.classEnrollments.length + student_ids.length) > targetClass.max_students) {
                const available = targetClass.max_students - targetClass.classEnrollments.length;
                const err = new Error(`Lớp học sẽ vượt quá sĩ số. Chỉ còn trống ${available} chỗ.`);
                (err as any).statusCode = 400;
                throw err;
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
                                where: { date: { gte: new Date() } }
                            }
                        }
                    }
                }
            });

            const targetSchedules = targetClass.schedules;

            for (const s_id of student_ids) {
                // Check Duplicate
                const isDuplicate = targetClass.classEnrollments.some((e: any) => e.student_id === s_id);
                if (isDuplicate) {
                    failed.push({ student_id: s_id, reason: 'Đã tồn tại trong lớp' });
                    continue;
                }

                // Check Conflict
                const myEnrollments = studentEnrollments.filter((e: any) => e.student_id === s_id);
                let hasConflict = false;

                for (const enrollment of myEnrollments) {
                    if (hasConflict) break;
                    const existingSchedules = enrollment.class.schedules;

                    for (const newSch of targetSchedules) {
                        if (hasConflict) break;
                        if (!newSch.start_time || !newSch.end_time) continue;

                        for (const exSch of existingSchedules) {
                            if (!exSch.start_time || !exSch.end_time) continue;

                            // So sánh ngày
                            const dateA = new Date(newSch.date).toISOString().slice(0, 10);
                            const dateB = new Date(exSch.date).toISOString().slice(0, 10);
                            if (dateA === dateB) {
                                // So sánh giờ
                                if (newSch.start_time < exSch.end_time && newSch.end_time > exSch.start_time) {
                                    const dateStr = newSch.date.toISOString().split('T')[0];
                                    failed.push({ student_id: s_id, reason: `Trùng lịch lớp ${enrollment.class.name} ngày ${dateStr}` });
                                    hasConflict = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (!hasConflict || allow_conflicts) {
                    successful_ids.push(s_id);
                }
            }

            // 5. Database Action: Tạo bản ghi vào ClassEnrollment cho những ID hợp lệ
            if (successful_ids.length > 0) {
                const dataToInsert = successful_ids.map(id => ({
                    class_id,
                    student_id: id
                    // status là active theo default trong DB
                }));
                await tx.classEnrollment.createMany({
                    data: dataToInsert
                });

                for (const studentId of successful_ids) {
                    await createClassInvoice(tx, {
                        class_id,
                        student_id: studentId,
                        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        notes: 'Auto-created when student was enrolled into class', allowEmpty: true,
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
        const enrollment = await prisma.classEnrollment.findFirst({
            where: {
                class_id,
                student_id
            }
        });

        if (!enrollment) {
            const err = new Error('Học viên không có trong lớp học này');
            (err as any).statusCode = 404;
            throw err;
        }

        await prisma.classEnrollment.delete({
            where: { id: enrollment.id }
        });

        return {
            success: true,
            message: 'Đã hủy ghi danh học viên khỏi lớp'
        };
    }

}

export const classService = new ClassService();

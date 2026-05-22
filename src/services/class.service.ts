import { Prisma, ClassStatus } from '../generated/prisma';
import { prisma } from '../database/db';
import { classRepository } from '../repositories/class.repository';
import { invoiceService } from './invoice.service';

export interface GetClassesQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: ClassStatus;
    course_id?: number;
    teacher_id?: number;
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

export interface UpdateClassInput extends Partial<CreateClassInput> {}

export class ClassService {
    private createHttpError(message: string, statusCode: number) {
        const err = new Error(message);
        (err as any).statusCode = statusCode;
        return err;
    }

    async getClasses(query: GetClassesQuery) {
        const { page = 1, limit = 10, search, status, course_id, teacher_id } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.ClassWhereInput = {};

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

        if (teacher_id) {
            where.teacher_id = teacher_id;
        }

        const [total, classes] = await Promise.all([
            classRepository.count(where),
            classRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: { createdAt: 'desc' }
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

    async getClassById(id: number) {
        return await classRepository.findById(id);
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

        let currentDate = new Date(startDate);
        const endDt = new Date(endDate);
        const datesToCheck: Date[] = [];

        while (currentDate <= endDt) {
            if (scheduleDays.includes(currentDate.getDay())) {
                datesToCheck.push(new Date(currentDate));
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return datesToCheck;
    }

    async createClass(data: CreateClassInput) {
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

        const classData = data as Prisma.ClassUncheckedUpdateInput;
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

        if (datesToCheck.length === 0) return [];

        const { conflictingRooms } = await classRepository.findConflictingResources(datesToCheck, startTimeDb, endTimeDb, excludeClassId);

        const rooms = await prisma.room.findMany({
            where: {
                is_active: true,
                id: { notIn: conflictingRooms }
            },
            select: { id: true, name: true, capacity: true }
        });

        return rooms.map(room => ({
            ...room,
            is_available: true
        }));
    }

    async getAvailableTeachers(startDate: Date, endDate: Date, scheduleDays: number[], scheduleTime: string[], excludeClassId?: number) {
        if (scheduleTime.length !== 2) throw new Error('Invalid schedule_time');
        
        const startTimeDb = this.parseTimeToDate(scheduleTime[0]);
        const endTimeDb = this.parseTimeToDate(scheduleTime[1]);
        const datesToCheck = this.generateScheduleDates(startDate, endDate, scheduleDays);

        if (datesToCheck.length === 0) return [];

        const { conflictingTeachers } = await classRepository.findConflictingResources(datesToCheck, startTimeDb, endTimeDb, excludeClassId);

        const teachers = await prisma.teacher.findMany({
            where: {
                is_active: true,
                id: { notIn: conflictingTeachers }
            },
            select: { id: true, full_name: true, email: true }
        });

        return teachers.map(teacher => ({
            ...teacher,
            is_available: true
        }));
    }

    async enrollStudents(class_id: number, student_ids: number[]) {
        // 1. Lấy thông tin lớp học, sĩ số và lịch học
        const targetClass = await prisma.class.findUnique({
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
                        if (newSch.date.getTime() === exSch.date.getTime()) {
                            // So sánh giờ: (StartA < EndB) && (EndA > StartB)
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

            if (!hasConflict) {
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
            await prisma.classEnrollment.createMany({
                data: dataToInsert
            });

            for (const studentId of successful_ids) {
                invoiceService.createInvoiceFromClass({
                    class_id,
                    student_id: studentId,
                    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    notes: 'Auto-created when student was enrolled into class',
                }).catch((error) => {
                    console.error(`[ClassService] Auto invoice failed for student ${studentId} in class ${class_id}:`, error.message);
                });
            }
        }

        return {
            successful: successful_ids,
            failed: failed
        };
    }
}

export const classService = new ClassService();

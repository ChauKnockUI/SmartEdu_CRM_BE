import { Prisma, ClassStatus } from '../generated/prisma';
import { classRepository } from '../repositories/class.repository';

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
    private parseTimeToDate(timeString: string): Date {
        const [hours, minutes] = timeString.split(':').map(Number);
        return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
    }

    async createClass(data: CreateClassInput) {
        let generatedSchedules: Prisma.ScheduleCreateManyInput[] = [];

        if (data.start_date && data.end_date && data.schedule_days && data.schedule_time && data.schedule_time.length === 2) {
            const startTimeDb = this.parseTimeToDate(data.schedule_time[0]);
            const endTimeDb = this.parseTimeToDate(data.schedule_time[1]);

            let currentDate = new Date(data.start_date);
            const endDt = new Date(data.end_date);
            
            // Lấy tất cả các ngày (Date) được sinh ra
            const datesToCheck: Date[] = [];

            while (currentDate <= endDt) {
                if (data.schedule_days.includes(currentDate.getDay())) {
                    const clonedDate = new Date(currentDate);
                    datesToCheck.push(clonedDate);
                    generatedSchedules.push({
                        date: clonedDate,
                        start_time: startTimeDb,
                        end_time: endTimeDb,
                        room_id: data.room_id || null,
                        teacher_id: data.teacher_id || null,
                        status: 'scheduled'
                    });
                }
                currentDate.setDate(currentDate.getDate() + 1);
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

        return await classRepository.update(id, data as Prisma.ClassUncheckedUpdateInput);
    }
}

export const classService = new ClassService();

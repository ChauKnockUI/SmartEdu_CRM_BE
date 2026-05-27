import { AttendanceStatus } from '../generated/prisma';
import { attendanceRepository } from '../repositories/attendance.repository';
import { prisma } from '../database/db';

export interface AttendanceInput {
  student_id: number;
  status: AttendanceStatus;
  notes?: string;
}

export interface RecordAttendancePayload {
  lessonContent?: string;
  attendances: AttendanceInput[];
}

export class AttendanceService {
  async recordAttendance(
    schedule_id: number,
    user_id: number,
    user_role: string,
    payload: RecordAttendancePayload
  ) {
    const { lessonContent, attendances } = payload;

    const schedule = await prisma.schedule.findUnique({
      where: { id: schedule_id },
      include: {
        teacher: { select: { user_id: true } },
      },
    });

    if (!schedule) {
      const err = new Error('Không tìm thấy buổi học');
      (err as any).statusCode = 404;
      throw err;
    }

    if (user_role !== 'admin') {
      if (user_role !== 'teacher' || schedule.teacher?.user_id !== user_id) {
        const err = new Error('Bạn không có quyền điểm danh cho buổi học này');
        (err as any).statusCode = 403;
        throw err;
      }
    }

    let startDateTime = schedule.date;

    if (schedule.start_time) {
      startDateTime = new Date(schedule.date);
      startDateTime.setUTCHours(
        schedule.start_time.getUTCHours(),
        schedule.start_time.getUTCMinutes(),
        0,
        0
      );
    }

    const now = new Date();
    const diffHours =
      (now.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);

    if (diffHours > 48 && user_role !== 'admin') {
      const err = new Error(
        'Dữ liệu đã bị khóa sau 48h. Vui lòng liên hệ Admin để sửa đổi.'
      );
      (err as any).statusCode = 403;
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      await tx.schedule.update({
        where: { id: schedule_id },
        data: {
          notes: lessonContent || null,
        },
      });

      for (const att of attendances) {
        await tx.attendance.upsert({
          where: {
            schedule_id_student_id: {
              schedule_id,
              student_id: att.student_id,
            },
          },
          update: {
            status: att.status,
            notes: att.notes || null,
          },
          create: {
            schedule_id,
            student_id: att.student_id,
            status: att.status,
            notes: att.notes || null,
          },
        });
      }
    });

    return { success: true };
  }

  async getSessionAttendance(scheduleId: number, userId: number, userRole: string) {
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        class: { select: { id: true } },
        teacher: { select: { user_id: true } },
      },
    });

    if (!schedule) {
      const err = new Error('Không tìm thấy buổi học');
      (err as any).statusCode = 404;
      throw err;
    }

    if (userRole !== 'admin') {
      if (userRole === 'teacher' && schedule.teacher?.user_id !== userId) {
        const err = new Error('Bạn không có quyền xem buổi học này');
        (err as any).statusCode = 403;
        throw err;
      }

      if (userRole === 'student' && schedule.class?.id) {
        const student = await prisma.student.findUnique({
          where: { user_id: userId },
          select: { id: true },
        });

        const enrollment = await prisma.classEnrollment.findUnique({
          where: {
            class_id_student_id: {
              class_id: schedule.class.id,
              student_id: student?.id || 0,
            },
          },
        });

        if (!enrollment) {
          const err = new Error('Bạn không có quyền xem buổi học này');
          (err as any).statusCode = 403;
          throw err;
        }
      }
    }

    return await attendanceRepository.getSessionAttendanceWithMemo(scheduleId);
  }

  async getAbsenceList(scheduleId: number, userId: number, userRole: string) {
    return await attendanceRepository.getAbsenceList(scheduleId);
  }

  async getStudentAttendanceHistory(
    studentId: number,
    classId: number,
    userId: number,
    userRole: string
  ) {
    return await attendanceRepository.getStudentAttendanceHistory(studentId, classId);
  }
}

export const attendanceService = new AttendanceService();
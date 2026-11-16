import { AttendanceStatus } from '../generated/prisma';
import { attendanceRepository } from '../repositories/attendance.repository';
import { prisma, withTenantTx } from '../database/db';
import { dropoutRiskService } from './ai/dropoutRisk.service';
import { assertAttendanceStudents, scheduleReadScope, studentReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';

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
        class: {
          select: {
            id: true,
            teacher: { select: { user_id: true } }
          }
        }
      },
    });

    if (!schedule) {
      const err = new Error('Không tìm thấy buổi học');
      (err as any).statusCode = 404;
      throw err;
    }

    if (user_role !== 'admin') {
      const assignedTeacherUserId = schedule.teacher?.user_id || schedule.class?.teacher?.user_id;
      if (user_role !== 'teacher' || assignedTeacherUserId !== user_id) {
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

    if (diffHours > 48 && user_role !== 'admin' && !schedule.is_attendance_unlocked) {
      const err = new Error(
        'Dữ liệu đã bị khóa sau 48h. Vui lòng liên hệ Admin để sửa đổi.'
      );
      (err as any).statusCode = 403;
      throw err;
    }

    await withTenantTx(async (tx) => {
      await assertAttendanceStudents(tx, schedule.class_id, attendances.map(item => item.student_id));
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

    if (schedule.class_id && attendances.length > 0) {
      const affectedStudentIds = Array.from(new Set(attendances.map((att) => att.student_id)));
      void Promise.allSettled(
        affectedStudentIds.map((studentId) =>
          dropoutRiskService.scoreStudent(studentId, schedule.class_id as number)
        )
      ).catch((error) => {
        console.error('[AttendanceService] dropout risk scoring error:', error);
      });
    }

    return { success: true };
  }

  private async assertSessionRead(scheduleId: number, actor: AcademicActor) {
    const schedule = await prisma.schedule.findFirst({
      where: { id: scheduleId, AND: [scheduleReadScope(actor)] }, select: { id: true },
    });
    if (!schedule) throw Object.assign(new Error('Không tìm thấy buổi học trong phạm vi được xem.'), { statusCode: 404 });
  }

  async getSessionAttendance(scheduleId: number, userId: number, userRole: string) {
    const actor = { userId, role: userRole as AcademicActor['role'] };
    await this.assertSessionRead(scheduleId, actor);
    return attendanceRepository.getSessionAttendanceWithMemo(scheduleId,
      ['admin', 'teacher'].includes(userRole) ? undefined : studentReadScope(actor));
  }

  async getAbsenceList(scheduleId: number, userId: number, userRole: string) {
    const actor = { userId, role: userRole as AcademicActor['role'] };
    await this.assertSessionRead(scheduleId, actor);
    return attendanceRepository.getAbsenceList(scheduleId,
      ['admin', 'teacher'].includes(userRole) ? undefined : studentReadScope(actor));
  }

  async getStudentAttendanceHistory(
    studentId: number,
    classId: number,
    userId: number,
    userRole: string
  ) {
    const actor = { userId, role: userRole as AcademicActor['role'] };
    const enrollment = await prisma.classEnrollment.findFirst({ where: {
      student_id: studentId, class_id: classId, ...enrollmentReadScope(actor),
    }, select: { id: true } });
    if (!enrollment) throw Object.assign(new Error('Không có quyền xem lịch sử học viên trong lớp này.'), { statusCode: 403 });
    return await attendanceRepository.getStudentAttendanceHistory(studentId, classId);
  }
}

export const attendanceService = new AttendanceService();

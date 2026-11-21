import { AttendanceStatus } from '../generated/prisma';
import { z } from 'zod';
import { attendanceAccess } from '../utils/attendanceAccess';
import { attendanceRepository } from '../repositories/attendance.repository';
import { prisma, withTenantTx } from '../database/db';
import { dropoutRiskService } from './ai/dropoutRisk.service';
import { assertAttendanceStudents, scheduleReadScope, studentReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';
import { archiveAttendanceNotifications } from '../utils/scheduleNotifications';

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
    const parsed = z.object({
      lessonContent: z.string().max(2000).optional(),
      attendances: z.array(z.object({ student_id: z.number().int().positive().max(2147483647),
        status: z.enum(['present', 'absent', 'late', 'excused']), notes: z.string().max(1000).optional() })).min(1),
    }).safeParse(payload);
    if (!parsed.success) throw Object.assign(new Error('Chọn trạng thái hợp lệ cho từng học viên trước khi lưu.'), { statusCode: 400 });
    const { lessonContent, attendances } = parsed.data;
    if (new Set(attendances.map(item => item.student_id)).size !== attendances.length)
      throw Object.assign(new Error('Danh sách điểm danh bị trùng học viên.'), { statusCode: 400 });

    const schedule = await withTenantTx(async tx => {
      await tx.$queryRaw`SELECT id FROM schedules WHERE id = ${schedule_id} FOR UPDATE`;
      const schedule = await tx.schedule.findUnique({
        where: { id: schedule_id },
        include: {
          teacher: { select: { user_id: true } },
          class: {
            select: {
              id: true,
              status: true,
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

      const access = attendanceAccess(schedule, user_id, user_role);
      if (!access.canMark) throw Object.assign(new Error(access.blockReason), { statusCode: 403 });

      await assertAttendanceStudents(tx, schedule.class_id, attendances.map(item => item.student_id));
      if (lessonContent !== undefined) await tx.schedule.update({
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
      await archiveAttendanceNotifications(tx, schedule_id);
      return schedule;
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
    const detail = await attendanceRepository.getSessionAttendanceWithMemo(scheduleId,
      ['admin', 'teacher'].includes(userRole) ? undefined : studentReadScope(actor), actor);
    if (!detail) throw Object.assign(new Error('Không tìm thấy buổi học.'), { statusCode: 404 });
    return detail;
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

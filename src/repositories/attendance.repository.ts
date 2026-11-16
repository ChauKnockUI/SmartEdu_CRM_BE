import { prisma } from '../database/db';
import type { Prisma } from '../generated/prisma';

export interface SessionAttendanceDetail {
  scheduleId: number;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  className: string;
  lessonContent: string | null;
  notes: string | null;
  teacherName: string;
  is_attendance_unlocked?: boolean;
  enrolledStudents: {
    id: number;
    name: string;
    email: string;
    attendance: {
      status: string;
      notes: string | null;
    } | null;
  }[];
}

export interface AbsenceRecord {
  studentId: number;
  studentName: string;
  email: string;
  status: string;
  notes: string | null;
}

export class AttendanceRepository {
  async getSessionAttendanceWithMemo(
    scheduleId: number, studentScope?: Prisma.StudentWhereInput
  ): Promise<SessionAttendanceDetail | null> {
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            classEnrollments: {
              where: { status: 'active', ...(studentScope ? { student: studentScope } : {}) },
              select: {
                student: {
                  select: {
                    id: true,
                    full_name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        teacher: {
          select: {
            full_name: true
          }
        },
        attendances: {
          ...(studentScope ? { where: { student: studentScope } } : {}),
          select: {
            student_id: true,
            status: true,
            notes: true
          }
        }
      }
    });

    if (!schedule || !schedule.class) {
      return null;
    }

    const attendanceMap = new Map(
      schedule.attendances.map((att) => [att.student_id, att])
    );

    const enrolledStudents = schedule.class.classEnrollments.map((enrollment) => ({
      id: enrollment.student.id,
      name: enrollment.student.full_name,
      email: enrollment.student.email || '',
      attendance: attendanceMap.get(enrollment.student.id) || null
    }));

    return {
      scheduleId: schedule.id,
      date: schedule.date,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      className: schedule.class.name,
      teacherName: schedule.teacher?.full_name || 'Unknown',
      lessonContent: schedule.notes,
      notes: schedule.notes,
      is_attendance_unlocked: schedule.is_attendance_unlocked,
      enrolledStudents,
    };
  }

  async getAbsenceList(scheduleId: number, studentScope?: Prisma.StudentWhereInput): Promise<AbsenceRecord[]> {
    const absences = await prisma.attendance.findMany({
      where: {
        schedule_id: scheduleId,
          ...(studentScope ? { student: studentScope } : {}),
        status: {
          in: ['absent', 'late']
        }
      },
      include: {
        student: {
          select: {
            id: true,
            full_name: true,
            email: true
          }
        }
      }
    });

    return absences.map((att) => ({
      studentId: att.student.id,
      studentName: att.student.full_name,
      email: att.student.email || '',
      status: att.status,
      notes: att.notes
    }));
  }

  async getStudentAttendanceHistory(
    studentId: number,
    classId: number
  ): Promise<
    {
      scheduleId: number;
      date: Date;
      status: string;
      notes: string | null;
    }[]
  > {
    const attendances = await prisma.attendance.findMany({
      where: {
        student_id: studentId,
        schedule: {
          class_id: classId
        }
      },
      include: {
        schedule: {
          select: {
            id: true,
            date: true
          }
        }
      },
      orderBy: {
        schedule: {
          date: 'desc'
        }
      }
    });

    return attendances.map((att) => ({
      scheduleId: att.schedule.id,
      date: att.schedule.date,
      status: att.status,
      notes: att.notes
    }));
  }

}

export const attendanceRepository = new AttendanceRepository();

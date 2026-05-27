import { AttendanceStatus, DropoutRiskLevel, PredictionType, Prisma } from '../../generated/prisma';
import { prisma } from '../../database/db';
import { dropoutRiskApi, DropoutRiskFeatures } from './dropoutRisk.api';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round4 = (value: number) => Math.round(value * 10000) / 10000;

export class DropoutRiskService {
  private riskLevelFromScore(score: number): DropoutRiskLevel {
    if (score >= 70) return DropoutRiskLevel.high;
    if (score >= 40) return DropoutRiskLevel.medium;
    return DropoutRiskLevel.low;
  }

  private daysBetween(from: Date, to: Date = new Date()) {
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
  }

  private normalizeScore(score: number | null, maxScore: number | null | undefined) {
    if (score === null || score === undefined) return null;
    if (maxScore && maxScore > 0) return clamp((score / maxScore) * 10, 0, 10);
    return clamp(score, 0, 10);
  }

  async prepareDropoutFeatures(studentId: number, classId: number): Promise<DropoutRiskFeatures> {
    const now = new Date();
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        classEnrollments: {
          where: { student_id: studentId },
          select: { id: true, status: true },
        },
        schedules: {
          where: { status: { not: 'cancelled' } },
          include: {
            attendances: {
              where: { student_id: studentId },
              select: { status: true },
            },
          },
          orderBy: { date: 'asc' },
        },
        assignments: {
          include: {
            submissions: {
              where: { student_id: studentId },
              select: { status: true, submitted_at: true, score: true },
            },
          },
        },
        tests: {
          include: {
            testResults: {
              where: { student_id: studentId },
              select: { score: true },
            },
          },
          orderBy: { test_date: 'asc' },
        },
        invoices: {
          where: { student_id: studentId },
          select: { status: true, due_date: true },
        },
      },
    });

    if (!classData) {
      const err = new Error('Khong tim thay lop hoc');
      (err as any).statusCode = 404;
      throw err;
    }

    if (classData.classEnrollments.length === 0) {
      const err = new Error('Hoc vien chua duoc ghi danh vao lop nay');
      (err as any).statusCode = 400;
      throw err;
    }

    const heldSchedules = classData.schedules.filter((schedule) => schedule.date <= now);
    const totalHeld = heldSchedules.length;
    const attendanceStatuses = heldSchedules.map((schedule) => schedule.attendances[0]?.status || null);
    const attendedCount = attendanceStatuses.filter((status) => status === AttendanceStatus.present || status === AttendanceStatus.late).length;
    const unexcusedCount = attendanceStatuses.filter((status) => status === AttendanceStatus.absent).length;
    const lateCount = attendanceStatuses.filter((status) => status === AttendanceStatus.late).length;

    let consecutiveUnexcused = 0;
    for (const schedule of [...heldSchedules].reverse()) {
      const status = schedule.attendances[0]?.status || null;
      if (status === AttendanceStatus.absent) consecutiveUnexcused += 1;
      else break;
    }

    const lastAttended = [...heldSchedules]
      .reverse()
      .find((schedule) => {
        const status = schedule.attendances[0]?.status;
        return status === AttendanceStatus.present || status === AttendanceStatus.late;
      });

    const assignmentStats = classData.assignments.reduce(
      (acc, assignment) => {
        const submission = assignment.submissions[0];
        const status = submission?.status;
        const duePassed = assignment.due_date ? assignment.due_date < now : true;

        if (status === 'excused') return acc;

        acc.total += 1;
        if (status === 'late') acc.late += 1;
        if (status === 'missing' || (!submission && duePassed)) acc.missing += 1;
        return acc;
      },
      { total: 0, missing: 0, late: 0 }
    );

    const scores = classData.tests
      .map((test) => this.normalizeScore(test.testResults[0]?.score ?? null, test.max_score))
      .filter((score): score is number => score !== null);

    const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 7;
    const splitIndex = Math.max(1, Math.floor(scores.length / 2));
    const earlyScores = scores.slice(0, splitIndex);
    const recentScores = scores.slice(splitIndex);
    const earlyAvg = earlyScores.length ? earlyScores.reduce((sum, score) => sum + score, 0) / earlyScores.length : averageScore;
    const recentAvg = recentScores.length ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length : averageScore;

    const overdueInvoices = classData.invoices.filter((invoice) => {
      if (invoice.status === 'overdue') return true;
      return !!invoice.due_date && invoice.due_date < now && ['pending', 'partial'].includes(invoice.status);
    });
    const daysOverdue = overdueInvoices.reduce((max, invoice) => {
      if (!invoice.due_date) return max;
      return Math.max(max, this.daysBetween(invoice.due_date, now));
    }, 0);

    const totalSchedules = classData.schedules.length;

    return {
      Attendance_Rate: totalHeld ? round4(attendedCount / totalHeld) : 1,
      Unexcused_Absence_Count: unexcusedCount,
      Unexcused_Absence_Rate: totalHeld ? round4(unexcusedCount / totalHeld) : 0,
      Late_Count: lateCount,
      Consecutive_Unexcused_Absences: consecutiveUnexcused,
      Days_Since_Last_Attended: lastAttended ? this.daysBetween(lastAttended.date, now) : (totalHeld ? this.daysBetween(heldSchedules[0].date, now) : 0),
      Assignment_Missing_Rate: assignmentStats.total ? round4(assignmentStats.missing / assignmentStats.total) : 0,
      Assignment_Late_Count: assignmentStats.late,
      Average_Score: Math.round(averageScore * 100) / 100,
      Score_Trend: Math.round((recentAvg - earlyAvg) * 100) / 100,
      Has_Overdue_Invoice: overdueInvoices.length > 0 ? 1 : 0,
      Days_Overdue: daysOverdue,
      Class_Progress_Ratio: totalSchedules ? round4(totalHeld / totalSchedules) : 0,
    };
  }

  async scoreStudent(studentId: number, classId: number) {
    const features = await this.prepareDropoutFeatures(studentId, classId);
    const aiResponse = await dropoutRiskApi.fetchPrediction(features);

    if (!aiResponse) {
      return { success: false, skipped: true, features };
    }

    const score = clamp(aiResponse.dropout_probability, 0, 100);
    const level = this.riskLevelFromScore(score);

    const updatedStudent = await prisma.student.update({
      where: { id: studentId },
      data: {
        dropout_risk: score,
        dropout_risk_level: level,
        dropout_risk_reasons: aiResponse.top_reasons,
        dropout_risk_updated_at: new Date(),
      },
    });

    await prisma.aIPrediction.create({
      data: {
        prediction_type: PredictionType.dropout_risk,
        reference_id: studentId,
        input_data: features as unknown as Prisma.InputJsonValue,
        result_data: {
          ...aiResponse,
          class_id: classId,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      data: {
        student_id: studentId,
        class_id: classId,
        dropout_risk: updatedStudent.dropout_risk,
        dropout_risk_level: updatedStudent.dropout_risk_level,
        top_reasons: aiResponse.top_reasons,
        action: aiResponse.action,
      },
      features,
    };
  }

  async scoreClass(classId: number) {
    const enrollments = await prisma.classEnrollment.findMany({
      where: { class_id: classId, status: 'active' },
      select: { student_id: true },
    });

    const results = [];
    for (const enrollment of enrollments) {
      results.push(await this.scoreStudent(enrollment.student_id, classId));
    }

    return results;
  }
}

export const dropoutRiskService = new DropoutRiskService();

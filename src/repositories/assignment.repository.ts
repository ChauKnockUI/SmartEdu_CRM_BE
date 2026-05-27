import { AssignmentSubmissionStatus, Prisma } from '../generated/prisma';
import { prisma } from '../database/db';

export class AssignmentRepository {
  async findClassForAccess(classId: number) {
    return prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        teacher: { select: { user_id: true } },
        classEnrollments: { select: { student_id: true } },
      },
    });
  }

  async findAssignmentWithClass(id: number) {
    return prisma.assignment.findUnique({
      where: { id },
      include: {
        class: {
          select: {
            id: true,
            teacher: { select: { user_id: true } },
          },
        },
      },
    });
  }

  async findByClass(classId: number) {
    return prisma.assignment.findMany({
      where: { class_id: classId },
      include: {
        creator: { select: { id: true, full_name: true, email: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: [{ due_date: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(data: Prisma.AssignmentUncheckedCreateInput) {
    return prisma.assignment.create({ data });
  }

  async update(id: number, data: Prisma.AssignmentUncheckedUpdateInput) {
    return prisma.assignment.update({
      where: { id },
      data,
    });
  }

  async delete(id: number) {
    return prisma.assignment.delete({ where: { id } });
  }

  async findSubmissions(assignmentId: number) {
    return prisma.assignmentSubmission.findMany({
      where: { assignment_id: assignmentId },
      include: {
        student: {
          select: { id: true, full_name: true, email: true, phone: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertSubmission(
    assignmentId: number,
    studentId: number,
    data: {
      status: AssignmentSubmissionStatus;
      submitted_at?: Date | null;
      score?: number | null;
      feedback?: string | null;
    }
  ) {
    return prisma.assignmentSubmission.upsert({
      where: {
        assignment_id_student_id: {
          assignment_id: assignmentId,
          student_id: studentId,
        },
      },
      create: {
        assignment_id: assignmentId,
        student_id: studentId,
        ...data,
      },
      update: data,
    });
  }
}

export const assignmentRepository = new AssignmentRepository();

import { AssignmentSubmissionStatus, UserRole } from '../generated/prisma';
import { assignmentRepository } from '../repositories/assignment.repository';

export interface CreateAssignmentInput {
  title: string;
  description?: string;
  due_date?: Date;
  max_score?: number;
}

export interface UpdateAssignmentInput {
  title?: string;
  description?: string | null;
  due_date?: Date | null;
  max_score?: number | null;
}

export interface UpdateSubmissionInput {
  status: AssignmentSubmissionStatus;
  submitted_at?: Date | null;
  score?: number | null;
  feedback?: string | null;
}

export class AssignmentService {
  private async assertClassAccess(classId: number, userId: number, role: UserRole) {
    const classData = await assignmentRepository.findClassForAccess(classId);
    if (!classData) {
      const err = new Error('Khong tim thay lop hoc');
      (err as any).statusCode = 404;
      throw err;
    }

    if (role === 'admin') return classData;

    if (role === 'teacher' && classData.teacher?.user_id === userId) {
      return classData;
    }

    const err = new Error('Ban khong co quyen thao tac voi bai tap cua lop nay');
    (err as any).statusCode = 403;
    throw err;
  }

  private async assertAssignmentAccess(assignmentId: number, userId: number, role: UserRole) {
    const assignment = await assignmentRepository.findAssignmentWithClass(assignmentId);
    if (!assignment) {
      const err = new Error('Khong tim thay bai tap');
      (err as any).statusCode = 404;
      throw err;
    }

    await this.assertClassAccess(assignment.class_id, userId, role);
    return assignment;
  }

  async getClassAssignments(classId: number, userId: number, role: UserRole) {
    await this.assertClassAccess(classId, userId, role);
    return assignmentRepository.findByClass(classId);
  }

  async createAssignment(classId: number, userId: number, role: UserRole, input: CreateAssignmentInput) {
    await this.assertClassAccess(classId, userId, role);

    if (!input.title?.trim()) {
      const err = new Error('Tieu de bai tap la bat buoc');
      (err as any).statusCode = 400;
      throw err;
    }

    return assignmentRepository.create({
      class_id: classId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      due_date: input.due_date || null,
      max_score: input.max_score ?? null,
      created_by: userId,
    });
  }

  async updateAssignment(assignmentId: number, userId: number, role: UserRole, input: UpdateAssignmentInput) {
    await this.assertAssignmentAccess(assignmentId, userId, role);

    return assignmentRepository.update(assignmentId, {
      title: input.title?.trim(),
      description: input.description,
      due_date: input.due_date,
      max_score: input.max_score,
    });
  }

  async deleteAssignment(assignmentId: number, userId: number, role: UserRole) {
    await this.assertAssignmentAccess(assignmentId, userId, role);
    return assignmentRepository.delete(assignmentId);
  }

  async getSubmissions(assignmentId: number, userId: number, role: UserRole) {
    await this.assertAssignmentAccess(assignmentId, userId, role);
    return assignmentRepository.findSubmissions(assignmentId);
  }

  async updateSubmission(
    assignmentId: number,
    studentId: number,
    userId: number,
    role: UserRole,
    input: UpdateSubmissionInput
  ) {
    const assignment = await this.assertAssignmentAccess(assignmentId, userId, role);
    const classData = await assignmentRepository.findClassForAccess(assignment.class_id);
    const enrolled = classData?.classEnrollments.some((item) => item.student_id === studentId);

    if (!enrolled) {
      const err = new Error('Hoc vien chua duoc ghi danh vao lop cua bai tap nay');
      (err as any).statusCode = 400;
      throw err;
    }

    return assignmentRepository.upsertSubmission(assignmentId, studentId, {
      status: input.status,
      submitted_at: input.submitted_at ?? (input.status === 'submitted' || input.status === 'late' ? new Date() : null),
      score: input.score ?? null,
      feedback: input.feedback ?? null,
    });
  }
}

export const assignmentService = new AssignmentService();

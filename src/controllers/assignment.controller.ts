import { Request, Response } from 'express';
import { AssignmentSubmissionStatus, UserRole } from '../generated/prisma';
import { assignmentService } from '../services/assignment.service';

const getAuth = (req: Request) => ({
  userId: req.user?.userId || 0,
  role: req.user?.role as UserRole,
});

export class AssignmentController {
  async getClassAssignments(req: Request, res: Response) {
    try {
      const classId = Number(req.params.classId);
      const { userId, role } = getAuth(req);
      const data = await assignmentService.getClassAssignments(classId, userId, role);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async createAssignment(req: Request, res: Response) {
    try {
      const classId = Number(req.params.classId);
      const { userId, role } = getAuth(req);
      const data = await assignmentService.createAssignment(classId, userId, role, {
        title: req.body.title,
        description: req.body.description,
        due_date: req.body.due_date ? new Date(req.body.due_date) : undefined,
        max_score: req.body.max_score !== undefined ? Number(req.body.max_score) : undefined,
      });

      return res.status(201).json({ success: true, message: 'Tao bai tap thanh cong', data });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async updateAssignment(req: Request, res: Response) {
    try {
      const assignmentId = Number(req.params.id);
      const { userId, role } = getAuth(req);
      const data = await assignmentService.updateAssignment(assignmentId, userId, role, {
        title: req.body.title,
        description: req.body.description,
        due_date: req.body.due_date !== undefined ? (req.body.due_date ? new Date(req.body.due_date) : null) : undefined,
        max_score: req.body.max_score !== undefined ? (req.body.max_score === null ? null : Number(req.body.max_score)) : undefined,
      });

      return res.status(200).json({ success: true, message: 'Cap nhat bai tap thanh cong', data });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async deleteAssignment(req: Request, res: Response) {
    try {
      const assignmentId = Number(req.params.id);
      const { userId, role } = getAuth(req);
      await assignmentService.deleteAssignment(assignmentId, userId, role);
      return res.status(200).json({ success: true, message: 'Xoa bai tap thanh cong' });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async getSubmissions(req: Request, res: Response) {
    try {
      const assignmentId = Number(req.params.id);
      const { userId, role } = getAuth(req);
      const data = await assignmentService.getSubmissions(assignmentId, userId, role);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async updateSubmission(req: Request, res: Response) {
    try {
      const assignmentId = Number(req.params.id);
      const studentId = Number(req.params.studentId);
      const { userId, role } = getAuth(req);
      const status = req.body.status as AssignmentSubmissionStatus;

      if (!Object.values(AssignmentSubmissionStatus).includes(status)) {
        return res.status(400).json({ success: false, message: 'Trang thai nop bai khong hop le' });
      }

      const data = await assignmentService.updateSubmission(assignmentId, studentId, userId, role, {
        status,
        submitted_at: req.body.submitted_at ? new Date(req.body.submitted_at) : undefined,
        score: req.body.score !== undefined ? Number(req.body.score) : undefined,
        feedback: req.body.feedback,
      });

      return res.status(200).json({ success: true, message: 'Cap nhat bai nop thanh cong', data });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
}

export const assignmentController = new AssignmentController();

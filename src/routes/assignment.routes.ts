import { Router } from 'express';
import { assignmentController } from '../controllers/assignment.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.patch('/:id', authorize('admin', 'teacher'), assignmentController.updateAssignment);
router.delete('/:id', authorize('admin', 'teacher'), assignmentController.deleteAssignment);
router.get('/:id/submissions', authorize('admin', 'teacher'), assignmentController.getSubmissions);
router.patch(
  '/:id/submissions/:studentId',
  authorize('admin', 'teacher'),
  assignmentController.updateSubmission
);

export default router;

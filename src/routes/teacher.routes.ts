import { Router } from 'express';
import { teacherController } from '../controllers/teacher.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', teacherController.getTeachers);
router.get('/available', teacherController.getAvailableTeachers);
router.get('/:id/schedule', teacherController.getTeacherSchedule);
router.get('/:id', teacherController.getTeacherById);

router.post('/', authorize('admin'), teacherController.createTeacher);
router.put('/:id', authorize('admin'), teacherController.updateTeacher);
router.post('/:id/reset-password', authorize('admin'), teacherController.resetPassword);
router.delete('/:id', authorize('admin'), teacherController.deleteTeacher);

export default router;

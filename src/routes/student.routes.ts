import { Router, Request, Response, NextFunction } from 'express';
import { studentController } from '../controllers/student.controller';
import { invoiceController } from '../controllers/invoice.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { prisma } from '../database/db';

const router = Router();

router.use(authenticate);

const authorizeStudentSelfOrStaff = async (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role;

  if (role === 'admin' || role === 'sale') {
    next();
    return;
  }

  if (role === 'student') {
    const student = await prisma.student.findUnique({
      where: { id: Number(req.params.id) },
      select: { user_id: true },
    });

    if (student?.user_id === req.user?.userId) {
      next();
      return;
    }
  }

  res.status(403).json({
    success: false,
    message: 'You do not have permission to access this student resource',
  });
};

router.get('/', authorize('admin', 'sale', 'teacher'), studentController.getStudents);
router.get('/:id/invoices', authorizeStudentSelfOrStaff, invoiceController.getStudentInvoices);
router.get('/:id', authorizeStudentSelfOrStaff, studentController.getStudentById);
router.post('/', authorize('admin', 'sale'), studentController.createStudent);
router.put('/:id', authorize('admin', 'sale'), studentController.updateStudent);
router.post('/:id/reset-password', authorize('admin', 'sale'), studentController.resetPassword);

export default router;

import { Router } from 'express';
import authRouter from './auth.routes';
import leadRouter from './lead.routes';
import courseRouter from './course.routes';
import roomRouter from './room.routes';
import classRouter from './class.routes';
import teacherRouter from './teacher.routes';
import studentRouter from './student.routes';
import scheduleRouter from './schedule.routes';
import attendanceRouter from './attendance.routes';
import invoiceRouter from './invoice.routes';
import financeRouter from './finance.routes';
import assignmentRouter from './assignment.routes';
import dashboardRouter from './dashboard.routes';
import userRouter from './user.routes';
import notificationRouter from './notification.routes';
import { authenticate } from '../middlewares/auth.middleware';
import { synchronizeClassStatuses } from '../middlewares/classStatus.middleware';

const router = Router();

// ─── Health check ─────────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({ message: 'SmartEdu CRM API v1.0' });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
router.use('/auth', authRouter);
// Verify the JWT/tenant before maintenance. Each router retains its own role checks.
router.use(['/dashboard', '/leads', '/courses', '/rooms', '/classes', '/teachers', '/students',
  '/schedules', '/attendance', '/invoices', '/finance', '/assignments'], authenticate, synchronizeClassStatuses);
router.use('/dashboard', dashboardRouter);
router.use('/users', userRouter);
router.use('/notifications', notificationRouter);

// ─── Leads ────────────────────────────────────────────────────────────────────
router.use('/leads', leadRouter);

// ─── Courses ──────────────────────────────────────────────────────────────────
router.use('/courses', courseRouter);

// ─── Rooms ────────────────────────────────────────────────────────────────────
router.use('/rooms', roomRouter);

// ─── Classes ──────────────────────────────────────────────────────────────────
router.use('/classes', classRouter);

// ─── Teachers ─────────────────────────────────────────────────────────────────
router.use('/teachers', teacherRouter);

// ─── Students ─────────────────────────────────────────────────────────────────
router.use('/students', studentRouter);

// ─── Schedules ────────────────────────────────────────────────────────────────
router.use('/schedules', scheduleRouter);

// ─── Attendance ────────────────────────────────────────────────────────────────
router.use('/attendance', attendanceRouter);

router.use('/invoices', invoiceRouter);
router.use('/finance', financeRouter);
router.use('/assignments', assignmentRouter);

export { router };

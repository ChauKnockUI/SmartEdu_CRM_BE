import { Router } from 'express';
import authRouter from './auth.routes';
import leadRouter from './lead.routes';
import courseRouter from './course.routes';
import roomRouter from './room.routes';
import classRouter from './class.routes';
import teacherRouter from './teacher.routes';
import studentRouter from './student.routes';

const router = Router();

// ─── Health check ─────────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({ message: 'SmartEdu CRM API v1.0' });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
router.use('/auth', authRouter);

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

export { router };
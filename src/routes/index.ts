import { Router } from 'express';
import authRouter from './auth.routes';
import leadRouter from './lead.routes';
import courseRouter from './course.routes';

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

export { router };
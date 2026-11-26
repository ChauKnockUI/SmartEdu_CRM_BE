import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { createRateLimiter } from '../middlewares/rateLimit.middleware';
import { emailSettingsController } from '../controllers/emailSettings.controller';

const router = Router();
router.use(authenticate, authorize('admin'));
router.get('/email', emailSettingsController.get);
router.put('/email', createRateLimiter({ windowMs: 60_000, max: 10 }), emailSettingsController.save);
export default router;

import { Router } from 'express';
import { register, login, getMe } from '../controllers/auth.controller';
import { validate } from '../middlewares/validate.middleware';
import { authenticate } from '../middlewares/auth.middleware';
import { createRateLimiter } from '../middlewares/rateLimit.middleware';
import { registerSchema, loginSchema } from '../schemas/auth.schema';

const router = Router();
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.get('/me', authenticate, getMe);

export default router;

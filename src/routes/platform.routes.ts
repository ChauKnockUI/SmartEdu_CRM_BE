import { Router } from 'express';
import { platformController as c } from '../controllers/platform.controller';
import { authenticatePlatform } from '../middlewares/platformAuth.middleware';
import { createRateLimiter } from '../middlewares/rateLimit.middleware';
import { asyncHandler } from '../utils/asyncHandler';

// Router nền tảng: KHÔNG qua resolveTenant, dùng client app_admin.
const router = Router();
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const publicLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

router.post('/auth/login', loginLimiter, asyncHandler(c.login));
router.get('/tenants/check-subdomain', publicLimiter, asyncHandler(c.checkSubdomain));

router.use(asyncHandler(async (req, res, next) => authenticatePlatform(req, res, next)));

router.get('/stats', asyncHandler(c.stats));
router.get('/tenants', asyncHandler(c.listTenants));
router.post('/tenants', asyncHandler(c.createTenant));
router.put('/tenants/:id/status', asyncHandler(c.updateTenantStatus));
router.get('/plans', asyncHandler(c.listPlans));
router.post('/plans', asyncHandler(c.createPlan));
router.put('/plans/:id', asyncHandler(c.updatePlan));

export default router;

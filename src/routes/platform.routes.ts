import { Router } from 'express';
import { platformController as c } from '../controllers/platform.controller';
import { authenticatePlatform } from '../middlewares/platformAuth.middleware';
import { createRateLimiter } from '../middlewares/rateLimit.middleware';
import { asyncHandler } from '../utils/asyncHandler';

// Router nền tảng: KHÔNG qua resolveTenant, dùng client app_admin.
const router = Router();
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const publicLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const apiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 300 });
const sensitiveLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

// ─── Công khai ──────────────────────────────────────────────────────────────
router.post('/auth/login', loginLimiter, asyncHandler(c.login));
router.get('/tenants/check-subdomain', publicLimiter, asyncHandler(c.checkSubdomain));

// ─── Cần đăng nhập Super Admin ──────────────────────────────────────────────
router.use(apiLimiter, asyncHandler(async (req, res, next) => authenticatePlatform(req, res, next)));

// Tài khoản của chính mình
router.get('/auth/me', asyncHandler(c.me));
router.post('/auth/change-password', sensitiveLimiter, asyncHandler(c.changePassword));

// Dashboard
router.get('/stats', asyncHandler(c.stats));

// Trung tâm
router.get('/tenants', asyncHandler(c.listTenants));
router.post('/tenants', asyncHandler(c.createTenant));
router.get('/tenants/:id', asyncHandler(c.getTenant));
router.put('/tenants/:id', asyncHandler(c.updateTenant));
router.put('/tenants/:id/status', asyncHandler(c.updateTenantStatus));

// Đăng ký / gói của trung tâm
router.get('/tenants/:id/subscriptions', asyncHandler(c.listSubscriptions));
router.post('/tenants/:id/subscription', asyncHandler(c.changePlan));
router.post('/tenants/:id/extend', asyncHandler(c.extend));

// Người dùng của trung tâm (hỗ trợ khách hàng)
router.get('/tenants/:id/users', asyncHandler(c.listTenantUsers));
router.put('/tenants/:id/users/:userId', asyncHandler(c.setTenantUserActive));
router.post('/tenants/:id/users/:userId/reset-password', sensitiveLimiter, asyncHandler(c.resetTenantUserPassword));

// Gói dịch vụ
router.get('/plans', asyncHandler(c.listPlans));
router.post('/plans', asyncHandler(c.createPlan));
router.put('/plans/:id', asyncHandler(c.updatePlan));

// Quản trị viên nền tảng
router.get('/admins', asyncHandler(c.listAdmins));
router.post('/admins', sensitiveLimiter, asyncHandler(c.createAdmin));
router.put('/admins/:id', asyncHandler(c.updateAdmin));

export default router;

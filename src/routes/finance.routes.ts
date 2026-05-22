import { Router } from 'express';
import { financeController } from '../controllers/finance.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/debts', authorize('admin', 'sale'), financeController.getDebts);
router.get('/revenue-summary', authorize('admin', 'sale'), financeController.getRevenueSummary);

export default router;

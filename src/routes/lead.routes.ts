import { Router } from 'express';
import { leadController } from '../controllers/lead.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware'; // ✅ import vào

const router = Router();

router.get('/', authenticate, leadController.getLeads);
router.get('/:id', authenticate, leadController.getLeadById);
router.get('/:id/activities', authenticate, leadController.getLeadActivities);
router.post('/:id/activities', authenticate, leadController.createLeadActivity);
router.post('/:id/convert', authenticate, leadController.convertLead);
router.post('/', authenticate, leadController.createLead);
router.put('/:id', authenticate, leadController.updateLead);
router.delete('/:id', authenticate, authorize('admin', 'sale'), leadController.deleteLead); // ✅ thêm authorize luôn
router.post('/:id/score', authenticate, leadController.scoreLeadManually);

export default router;
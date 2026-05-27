import { Router } from 'express';
import { leadController } from '../controllers/lead.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate, authorize('admin', 'sale'));

router.get('/', leadController.getLeads);
router.get('/:id', leadController.getLeadById);
router.get('/:id/activities', leadController.getLeadActivities);
router.post('/:id/activities', leadController.createLeadActivity);
router.post('/:id/convert', leadController.convertLead);
router.post('/', leadController.createLead);
router.put('/:id', leadController.updateLead);
router.delete('/:id', leadController.deleteLead);
router.post('/:id/score', leadController.scoreLeadManually);

export default router;

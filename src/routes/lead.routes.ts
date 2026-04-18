import { Router } from 'express';
import { leadController } from '../controllers/lead.controller';

const router = Router();

// Định tuyến API kết nối sang Controller
router.get('/', leadController.getLeads);
router.get('/:id', leadController.getLeadById);
router.get('/:id/activities', leadController.getLeadActivities);
router.post('/:id/activities', leadController.createLeadActivity);
router.post('/', leadController.createLead);
router.put('/:id', leadController.updateLead);
router.delete('/:id', leadController.deleteLead);
router.post('/:id/score', leadController.scoreLeadManually);

export default router;

import { Router } from 'express';
import { leadController } from '../controllers/lead.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate, authorize('admin', 'sale'));

router.get('/', leadController.getLeads);
router.get('/funnel', leadController.getLeadFunnel);
router.get('/sources', leadController.getLeadSources);
router.get('/email-config', leadController.getEmailConfiguration);
router.get('/scoring-dataset', authorize('admin'), leadController.exportScoringDataset);
router.get('/:id', leadController.getLeadById);
router.get('/:id/activities', leadController.getLeadActivities);
router.post('/:id/activities', leadController.createLeadActivity);
router.post('/:id/emails', leadController.sendEmail);
router.post('/:id/convert', leadController.convertLead);
router.post('/', leadController.createLead);
router.put('/:id', leadController.updateLead);
router.delete('/:id', authorize('admin'), leadController.deleteLead);
router.post('/:id/score', leadController.scoreLeadManually);

export default router;

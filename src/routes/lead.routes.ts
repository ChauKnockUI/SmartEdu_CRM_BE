import { Router } from 'express';
import { leadController } from '../controllers/lead.controller';

const router = Router();

// Định tuyến API kết nối sang Controller
router.get('/', leadController.getLeads);
router.get('/:id', leadController.getLeadById);
router.post('/', leadController.createLead);
router.put('/:id', leadController.updateLead);
router.delete('/:id', leadController.deleteLead);

export default router;

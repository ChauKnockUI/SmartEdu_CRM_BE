import { Router } from 'express';
import { leadController } from '../controllers/lead.controller';

const router = Router();

// Định tuyến API kết nối sang Controller
router.get('/', leadController.getLeads);
router.get('/:id', leadController.getLeadById);

export default router;

import { Router } from 'express';
import { invoiceController } from '../controllers/invoice.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', authorize('admin', 'sale'), invoiceController.getInvoices);
router.post('/', authorize('admin', 'sale'), invoiceController.createInvoice);
router.get('/:id', authorize('admin', 'sale'), invoiceController.getInvoiceById);
router.post('/:id/payments', authorize('admin', 'sale'), invoiceController.recordPayment);
router.post('/:id/cancel', authorize('admin'), invoiceController.cancelInvoice);

export default router;

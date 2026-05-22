import { Router } from 'express';
import { invoiceController } from '../controllers/invoice.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', authorize('admin', 'sale'), invoiceController.getInvoices);
router.post('/', authorize('admin', 'sale'), invoiceController.createInvoice);
router.post('/from-class', authorize('admin', 'sale'), invoiceController.createInvoiceFromClass);
router.post('/bulk-class', authorize('admin', 'sale'), invoiceController.createInvoicesForClass);
router.post('/:id/payments', authorize('admin', 'sale'), invoiceController.recordPayment);

export default router;

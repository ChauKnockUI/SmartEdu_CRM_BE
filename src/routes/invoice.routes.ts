import { Router } from 'express';
import { invoiceController } from '../controllers/invoice.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', authorize('admin', 'sale'), invoiceController.getInvoices);
router.post('/', authorize('admin', 'sale'), invoiceController.createInvoice);
router.post('/from-class', authorize('admin', 'sale'), invoiceController.createInvoiceFromClass);
router.post('/bulk-class', authorize('admin', 'sale'), invoiceController.createInvoicesForClass);
router.get('/:id', authorize('admin', 'sale', 'student'), invoiceController.getInvoiceById);
router.get('/:id/receipts/:receiptId', authorize('admin', 'sale', 'student'), invoiceController.getReceipt);
router.post('/:id/cancel', authorize('admin'), invoiceController.cancelInvoice);
router.post('/:id/payments', authorize('admin', 'sale'), invoiceController.recordPayment);

export default router;

import { Request, Response } from 'express';
import { InvoiceStatus, PaymentMethod } from '../generated/prisma';
import { invoiceService } from '../services/invoice.service';
import { asyncHandler } from '../utils/asyncHandler';

const parseDate = (value: unknown) => value ? new Date(String(value)) : undefined;
const parseNumber = (value: unknown) => value ? Number(value) : undefined;

export const invoiceController = {
  getInvoices: asyncHandler(async (req: Request, res: Response) => {
    const result = await invoiceService.getInvoices({
      page: parseNumber(req.query.page) || 1,
      limit: parseNumber(req.query.limit) || 10,
      student_id: parseNumber(req.query.student_id),
      class_id: parseNumber(req.query.class_id),
      status: req.query.status as InvoiceStatus | undefined,
      from_date: parseDate(req.query.from_date),
      to_date: parseDate(req.query.to_date),
    });

    res.json({ success: true, ...result });
  }),

  getInvoiceById: asyncHandler(async (req: Request, res: Response) => {
    const data = await invoiceService.getInvoiceById(Number(req.params.id));
    res.json({ success: true, data });
  }),

  createInvoice: asyncHandler(async (req: Request, res: Response) => {
    const data = await invoiceService.createInvoice({
      student_id: Number(req.body.student_id),
      class_id: req.body.class_id ? Number(req.body.class_id) : undefined,
      total_amount: req.body.total_amount ? Number(req.body.total_amount) : undefined,
      discount_amount: req.body.discount_amount ? Number(req.body.discount_amount) : undefined,
      due_date: parseDate(req.body.due_date),
      notes: req.body.notes,
      items: req.body.items || [],
    });

    res.status(201).json({ success: true, data });
  }),

  recordPayment: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const data = await invoiceService.recordPayment(Number(req.params.id), {
      amount: Number(req.body.amount),
      method: req.body.method as PaymentMethod | undefined,
      paid_at: parseDate(req.body.paid_at),
      reference_code: req.body.reference_code,
      received_by: userId,
      notes: req.body.notes,
    });

    res.status(201).json({ success: true, data });
  }),

  cancelInvoice: asyncHandler(async (req: Request, res: Response) => {
    const data = await invoiceService.cancelInvoice(Number(req.params.id), req.body.notes);
    res.json({ success: true, data });
  }),

  getStudentInvoices: asyncHandler(async (req: Request, res: Response) => {
    const result = await invoiceService.getStudentInvoices(Number(req.params.id));
    res.json({ success: true, ...result });
  }),
};

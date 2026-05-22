import { Request, Response } from 'express';
import { InvoiceStatus, PaymentMethod } from '../generated/prisma';
import { invoiceService } from '../services/invoice.service';

const parseDate = (value: unknown) => value ? new Date(String(value)) : undefined;
const parseNumber = (value: unknown) => value !== undefined && value !== null && value !== '' ? Number(value) : undefined;

const sendError = (res: Response, error: any) => {
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : 'Internal Server Error',
    error: error.message,
  });
};

export const invoiceController = {
  async getInvoices(req: Request, res: Response) {
    try {
      const result = await invoiceService.getInvoices({
        page: parseNumber(req.query.page) || 1,
        limit: parseNumber(req.query.limit) || 10,
        student_id: parseNumber(req.query.student_id),
        class_id: parseNumber(req.query.class_id),
        status: req.query.status as InvoiceStatus | undefined,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  },

  async createInvoice(req: Request, res: Response) {
    try {
      const data = await invoiceService.createInvoice({
        student_id: Number(req.body.student_id),
        class_id: parseNumber(req.body.class_id),
        total_amount: parseNumber(req.body.total_amount),
        discount_amount: parseNumber(req.body.discount_amount),
        due_date: parseDate(req.body.due_date),
        notes: req.body.notes,
        items: req.body.items || [],
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  async createInvoiceFromClass(req: Request, res: Response) {
    try {
      const data = await invoiceService.createInvoiceFromClass({
        class_id: Number(req.body.class_id),
        student_id: Number(req.body.student_id),
        due_date: parseDate(req.body.due_date),
        discount_amount: parseNumber(req.body.discount_amount),
        notes: req.body.notes,
        extra_items: req.body.extra_items || [],
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  async createInvoicesForClass(req: Request, res: Response) {
    try {
      const data = await invoiceService.createInvoicesForClass({
        class_id: Number(req.body.class_id),
        student_ids: Array.isArray(req.body.student_ids) ? req.body.student_ids.map(Number) : undefined,
        due_date: parseDate(req.body.due_date),
        discount_amount: parseNumber(req.body.discount_amount),
        notes: req.body.notes,
        extra_items: req.body.extra_items || [],
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  async recordPayment(req: Request, res: Response) {
    try {
      const data = await invoiceService.recordPayment(Number(req.params.id), {
        amount: Number(req.body.amount),
        method: req.body.method as PaymentMethod | undefined,
        paid_at: parseDate(req.body.paid_at),
        reference_code: req.body.reference_code,
        received_by: req.user?.userId,
        notes: req.body.notes,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  async getStudentInvoices(req: Request, res: Response) {
    try {
      const result = await invoiceService.getInvoices({ student_id: Number(req.params.id), page: 1, limit: 100 });
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  },
};

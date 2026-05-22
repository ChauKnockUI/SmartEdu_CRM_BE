import { Request, Response } from 'express';
import { invoiceService } from '../services/invoice.service';

const parseDate = (value: unknown) => value ? new Date(String(value)) : undefined;

const sendError = (res: Response, error: any) => {
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : 'Internal Server Error',
    error: error.message,
  });
};

export const financeController = {
  async getDebts(_req: Request, res: Response) {
    try {
      const data = await invoiceService.getDebts();
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  async getRevenueSummary(req: Request, res: Response) {
    try {
      const data = await invoiceService.getRevenueSummary({
        from_date: parseDate(req.query.from_date),
        to_date: parseDate(req.query.to_date),
      });
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  async getClassFeeTemplate(req: Request, res: Response) {
    try {
      const data = await invoiceService.getClassFeeTemplate(Number(req.params.classId));
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },
};

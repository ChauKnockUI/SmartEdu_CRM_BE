import { Request, Response } from 'express';
import { invoiceService } from '../services/invoice.service';
import { asyncHandler } from '../utils/asyncHandler';

const parseDate = (value: unknown) => value ? new Date(String(value)) : undefined;

export const financeController = {
  getDebts: asyncHandler(async (_req: Request, res: Response) => {
    const data = await invoiceService.getDebts();
    res.json({ success: true, data });
  }),

  getRevenueSummary: asyncHandler(async (req: Request, res: Response) => {
    const data = await invoiceService.getRevenueSummary({
      from_date: parseDate(req.query.from_date),
      to_date: parseDate(req.query.to_date),
    });

    res.json({ success: true, data });
  }),
};

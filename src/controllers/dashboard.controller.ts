import { Request, Response } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { dashboardWorkService } from '../services/dashboardWork.service';
import { z } from 'zod';

export const dashboardController = {
  async getWork(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
      const query = z.object({ category: z.string().min(1).max(40).optional(),
        view: z.enum(['summary', 'list']).optional(),
        page: z.coerce.number().int().positive().max(2147483647).optional(), limit: z.coerce.number().int().min(1).max(20).optional(),
      }).safeParse(req.query);
      if (!query.success) return res.status(400).json({ success: false, message: 'Bộ lọc công việc không hợp lệ.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, data: await dashboardWorkService.getWork(req.user, query.data) });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không tải được công việc cần xử lý.' });
    }
  },
  async getOverview(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để tiếp tục' });
      }

      const data = await dashboardService.getOverview(req.user.userId, req.user.role);
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('[DashboardController] getOverview error:', error);
      return res.status(500).json({
        success: false,
        message: 'Lỗi Internal Server khi lấy dữ liệu dashboard',
        error: error.message,
      });
    }
  },
};

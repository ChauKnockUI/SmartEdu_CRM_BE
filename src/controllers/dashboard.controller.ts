import { Request, Response } from 'express';
import { dashboardService } from '../services/dashboard.service';

export const dashboardController = {
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

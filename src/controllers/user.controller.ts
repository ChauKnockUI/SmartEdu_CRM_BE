import { Request, Response } from 'express';
import { userService } from '../services/user.service';

export const userController = {
  async getSales(_req: Request, res: Response) {
    try {
      const data = await userService.getSales();
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error('[UserController] getSales error:', error);
      return res.status(500).json({
        success: false,
        message: 'Không tải được danh sách sale',
        error: error.message,
      });
    }
  },
};

import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.util';
import { adminPrisma } from '../database/admin-db';

declare global {
  namespace Express {
    interface Request {
      platformAdmin?: { id: number; email: string };
    }
  }
}

/** Xác thực Super Admin: JWT scope 'platform' + tài khoản còn active trong platform_admins. */
export const authenticatePlatform = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập' });
      return;
    }

    const decoded = verifyToken(header.split(' ')[1]);
    if (decoded.scope !== 'platform') {
      res.status(401).json({ status: 'error', message: 'Token không hợp lệ' });
      return;
    }

    const admin = await adminPrisma.platformAdmin.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, is_active: true },
    });
    if (!admin || !admin.is_active) {
      res.status(401).json({ status: 'error', message: 'Tài khoản không hợp lệ' });
      return;
    }

    req.platformAdmin = { id: admin.id, email: admin.email };
    next();
  } catch {
    res.status(401).json({ status: 'error', message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt.util';

// Extend Express Request để thêm field user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware xác thực JWT token.
 * Lấy token từ header: Authorization: Bearer <token>
 */
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        status: 'error',
        message: 'Vui lòng đăng nhập để tiếp tục',
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    // Token cũ (chưa có tenantId) hoặc token nền tảng: bắt đăng nhập lại
    if (decoded.scope !== 'tenant' || typeof decoded.tenantId !== 'number') {
      res.status(401).json({
        status: 'error',
        message: 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại',
      });
      return;
    }

    // Token của tenant khác với tenant suy ra từ Host
    if (!req.tenant || decoded.tenantId !== req.tenant.id) {
      res.status(403).json({
        status: 'error',
        message: 'Token không thuộc trung tâm này',
      });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      status: 'error',
      message: 'Token không hợp lệ hoặc đã hết hạn',
    });
  }
};

/**
 * Middleware phân quyền theo role.
 * Dùng sau authenticate middleware.
 * Ví dụ: authorize('admin', 'sale')
 */
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        status: 'error',
        message: 'Vui lòng đăng nhập để tiếp tục',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        status: 'error',
        message: 'Bạn không có quyền thực hiện hành động này',
      });
      return;
    }

    next();
  };
};

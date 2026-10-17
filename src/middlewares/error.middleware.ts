import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import { Prisma } from '../generated/prisma';

// Lỗi Prisma thường gặp → HTTP status + thông điệp an toàn (không lộ tên bảng/cột)
const mapPrismaError = (error: unknown): { status: number; message: string } | null => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (error.code) {
    case 'P2002':
      return { status: 409, message: 'Dữ liệu đã tồn tại (trùng giá trị duy nhất)' };
    case 'P2003':
      return { status: 409, message: 'Dữ liệu tham chiếu không hợp lệ' };
    case 'P2025':
      return { status: 404, message: 'Không tìm thấy dữ liệu' };
    default:
      return null;
  }
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

export const errorHandler = (
  error: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const mapped = mapPrismaError(error);
  const statusCode = mapped
    ? mapped.status
    : error instanceof ApiError
      ? error.statusCode
      : error.statusCode || 500;

  if (statusCode >= 500) {
    console.error('[API Error]', error);
  }

  res.status(statusCode).json({
    success: false,
    message: mapped ? mapped.message : statusCode >= 500 ? 'Internal Server Error' : error.message,
    ...(process.env.NODE_ENV !== 'production' && { error: error.message }),
  });
};

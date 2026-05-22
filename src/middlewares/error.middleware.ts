import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';

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
  const statusCode = error instanceof ApiError ? error.statusCode : error.statusCode || 500;

  if (statusCode >= 500) {
    console.error('[API Error]', error);
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Internal Server Error' : error.message,
    ...(process.env.NODE_ENV !== 'production' && { error: error.message }),
  });
};

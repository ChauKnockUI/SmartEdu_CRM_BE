import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';

/**
 * Middleware validate request body/params/query bằng Zod schema.
 * Trả về lỗi 400 với danh sách lỗi chi tiết nếu không hợp lệ.
 */
export const validate =
  (schema: ZodTypeAny) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((issue) => ({
          field: issue.path.slice(1).join('.'), // bỏ phần 'body'
          message: issue.message,
        }));
        res.status(400).json({
          status: 'error',
          message: 'Dữ liệu không hợp lệ',
          errors,
        });
        return;
      }
      next(error);
    }
  };

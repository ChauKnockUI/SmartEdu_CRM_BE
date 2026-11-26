import type { Request, Response, NextFunction } from 'express';
import { ensureClassStatusesCurrent } from '../services/classStatus.service';

export async function synchronizeClassStatuses(_req: Request, res: Response, next: NextFunction) {
    try {
        await ensureClassStatusesCurrent();
        next();
    } catch {
        res.status(503).json({ success: false, message: 'Chưa đồng bộ được trạng thái lớp học. Vui lòng thử lại.' });
    }
}

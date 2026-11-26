import { Request, Response } from 'express';
import { emailSettingsService } from '../services/emailSettings.service';

async function respond(res: Response, operation: () => Promise<unknown>) {
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json({ success: true, data: await operation() }); }
    catch (error: any) {
        const status = error.code === 'P2002' ? 409 : error.statusCode || 500;
        const message = error.code === 'P2002' ? 'Cấu hình vừa thay đổi. Vui lòng tải lại trước khi lưu.'
            : error.statusCode ? error.message : 'Chưa đọc hoặc lưu được cấu hình email. Vui lòng liên hệ người triển khai nếu lỗi tiếp diễn.';
        return res.status(status).json({ success: false, message });
    }
}

export const emailSettingsController = {
    get: (_req: Request, res: Response) => respond(res, () => emailSettingsService.get()),
    save: (req: Request, res: Response) => respond(res, () => emailSettingsService.save(req.body)),
};

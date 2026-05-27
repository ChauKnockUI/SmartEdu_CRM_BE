import { Request, Response } from 'express';
import { materialService } from '../services/material.service';

export const materialController = {
    getByClass: async (req: Request, res: Response) => {
        try {
            const classId = Number(req.params.classId);
            const userId = (req as any).user?.userId;
            const role = (req as any).user?.role;

            const data = await materialService.getByClass(classId, userId, role);

            return res.json({
                success: true,
                data,
            });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Lỗi tải tài liệu',
            });
        }
    },

    upload: async (req: Request, res: Response) => {
        try {
            const classId = Number(req.params.classId);
            const userId = (req as any).user?.userId;
            const role = (req as any).user?.role;
            console.log('=== UPLOAD ===', { userId, role });

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng chọn file',
                });
            }

            const data = await materialService.upload({
                classId,
                userId,
                role,
                title: req.body.title,
                file: req.file,
            });

            return res.json({
                success: true,
                data,
                message: 'Tải tài liệu thành công',
            });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Lỗi tải tài liệu',
            });
        }
    },

    update: async (req: Request, res: Response) => {
        try {
            const id = Number(req.params.id);
            const userId = (req as any).user?.userId;
            const role = (req as any).user?.role;

            const data = await materialService.update(id, userId, role, {
                title: req.body.title,
                file: req.file,
            });

            return res.json({
                success: true,
                data,
                message: 'Cập nhật tài liệu thành công',
            });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Lỗi cập nhật tài liệu',
            });
        }
    },

    remove: async (req: Request, res: Response) => {
        try {
            const id = Number(req.params.id);
            const userId = (req as any).user?.userId;
            const role = (req as any).user?.role;

            await materialService.remove(id, userId, role);

            return res.json({
                success: true,
                message: 'Đã xóa tài liệu',
            });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Lỗi xóa tài liệu',
            });
        }
    },
};
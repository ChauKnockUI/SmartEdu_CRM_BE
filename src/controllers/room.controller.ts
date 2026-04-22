import { Request, Response } from 'express';
import { roomService } from '../services/room.service';

export class RoomController {
    async getRooms(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const search = req.query.search as string;
            
            const min_capacity = req.query.min_capacity ? parseInt(req.query.min_capacity as string) : undefined;
            let is_active: boolean | undefined = undefined;
            
            if (req.query.is_active === 'true') is_active = true;
            if (req.query.is_active === 'false') is_active = false;

            const result = await roomService.getRooms({ page, limit, search, min_capacity, is_active });

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            console.error('[RoomController] getRooms error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async getRoomById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Phòng học không hợp lệ'
                });
            }

            const room = await roomService.getRoomById(Number(id));

            if (!room) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Phòng học'
                });
            }

            return res.status(200).json({
                success: true,
                data: room
            });
        } catch (error: any) {
            console.error('[RoomController] getRoomById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async createRoom(req: Request, res: Response) {
        try {
            const { name, capacity, equipment, is_active } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Tên phòng là bắt buộc'
                });
            }

            const newRoom = await roomService.createRoom({
                name,
                capacity: capacity ? Number(capacity) : undefined,
                equipment,
                is_active: is_active !== undefined ? Boolean(is_active) : undefined
            });

            return res.status(201).json({
                success: true,
                message: 'Tạo Phòng học thành công',
                data: newRoom
            });
        } catch (error: any) {
            console.error('[RoomController] createRoom error:', error);
            
            // Xử lý lỗi trùng tên phòng từ Service
            if (error.statusCode) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async updateRoom(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { name, capacity, equipment, is_active } = req.body;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Phòng học không hợp lệ'
                });
            }

            const updatedRoom = await roomService.updateRoom(Number(id), {
                name,
                capacity: capacity !== undefined ? Number(capacity) : undefined,
                equipment,
                is_active: is_active !== undefined ? Boolean(is_active) : undefined
            });

            if (!updatedRoom) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Phòng học để cập nhật'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Cập nhật Phòng học thành công',
                data: updatedRoom
            });
        } catch (error: any) {
            console.error('[RoomController] updateRoom error:', error);
            
            if (error.statusCode) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }

    async deleteRoom(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID Phòng học không hợp lệ'
                });
            }

            const isDeleted = await roomService.deleteRoom(Number(id));

            if (!isDeleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Phòng học để xóa'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Đã xóa (ẩn) Phòng học thành công'
            });
        } catch (error: any) {
            console.error('[RoomController] deleteRoom error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal Server Error',
                error: error.message
            });
        }
    }
}

export const roomController = new RoomController();

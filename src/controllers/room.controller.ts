import { Request, Response } from 'express';
import { roomService } from '../services/room.service';
import { classService } from '../services/class.service';

const parseScheduleDays = (value: unknown): number[] | null => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const days = parsed.map(Number);
            return days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) ? days : null;
        }
    } catch {
        // Fallback to comma-separated values below.
    }

    const days = raw.split(',').map(day => Number(day.trim()));
    return days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) ? days : null;
};

const parseScheduleTime = (value: unknown): string[] | null => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const times = parsed.map(String);
            return times.length === 2 ? times : null;
        }
    } catch {
        // Fallback to extracting HH:mm values below.
    }

    const matches = raw.match(/\d{1,2}:\d{2}/g);
    return matches && matches.length >= 2 ? matches.slice(0, 2) : null;
};

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

    async getAvailableRooms(req: Request, res: Response) {
        try {
            const { start_date, end_date, schedule_days, schedule_time, class_id } = req.query;

            if (!start_date || !end_date || !schedule_days || !schedule_time) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu các tham số bắt buộc: start_date, end_date, schedule_days, schedule_time'
                });
            }

            // Parse schedule_days: "1,3,5" -> [1, 3, 5]
            const daysArray = parseScheduleDays(schedule_days);
            if (!daysArray) {
                return res.status(400).json({ success: false, message: 'schedule_days không hợp lệ' });
            }

            // Parse schedule_time: "18:00,20:00" -> ["18:00", "20:00"]
            const timeArray = parseScheduleTime(schedule_time);
            if (!timeArray) {
                return res.status(400).json({ success: false, message: 'schedule_time không hợp lệ (cần 2 giờ)' });
            }

            const excludeClassId = class_id ? Number(class_id) : undefined;
            if (excludeClassId !== undefined && isNaN(excludeClassId)) {
                return res.status(400).json({ success: false, message: 'class_id khÃ´ng há»£p lá»‡' });
            }

            const availableRooms = await classService.getAvailableRooms(
                new Date(start_date as string),
                new Date(end_date as string),
                daysArray,
                timeArray,
                excludeClassId
            );

            return res.status(200).json({
                success: true,
                data: availableRooms
            });
        } catch (error: any) {
            console.error('[RoomController] getAvailableRooms error:', error);

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

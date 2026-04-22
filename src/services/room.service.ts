import { Prisma } from '../generated/prisma';
import { roomRepository } from '../repositories/room.repository';

export interface GetRoomsQuery {
    page?: number;
    limit?: number;
    search?: string;
    min_capacity?: number;
    is_active?: boolean;
}

export interface CreateRoomInput {
    name: string;
    capacity?: number;
    equipment?: string;
    is_active?: boolean;
}

export interface UpdateRoomInput {
    name?: string;
    capacity?: number;
    equipment?: string;
    is_active?: boolean;
}

export class RoomService {
    async getRooms(query: GetRoomsQuery) {
        const { page = 1, limit = 10, search, min_capacity, is_active } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.RoomWhereInput = {};

        // Mặc định chỉ lấy phòng active nếu không truyền is_active
        if (is_active !== undefined) {
            where.is_active = is_active;
        } else {
            where.is_active = true;
        }

        if (search) {
            where.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        if (min_capacity !== undefined) {
            where.capacity = {
                gte: min_capacity
            };
        }

        const [total, rooms] = await Promise.all([
            roomRepository.count(where),
            roomRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: { name: 'asc' }
            })
        ]);

        return {
            data: rooms,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getRoomById(id: number) {
        return await roomRepository.findById(id);
    }

    async createRoom(data: CreateRoomInput) {
        // Kiểm tra trùng tên phòng
        const existingName = await roomRepository.findByName(data.name);
        if (existingName) {
            const err = new Error('Tên phòng đã tồn tại.');
            (err as any).statusCode = 409;
            throw err;
        }

        return await roomRepository.create(data as Prisma.RoomCreateInput);
    }

    async updateRoom(id: number, data: UpdateRoomInput) {
        const existing = await roomRepository.checkExistence(id);
        if (!existing) return null;

        // Nếu có cập nhật tên, kiểm tra trùng lặp với phòng khác
        if (data.name && data.name !== existing.id.toString()) { // Note: we compare with existing object later if needed
            const nameCheck = await roomRepository.findByName(data.name);
            if (nameCheck && nameCheck.id !== id) {
                const err = new Error('Tên phòng đã tồn tại cho một phòng khác.');
                (err as any).statusCode = 409;
                throw err;
            }
        }

        return await roomRepository.update(id, data);
    }

    async deleteRoom(id: number) {
        const existing = await roomRepository.checkExistence(id);
        if (!existing) return false;

        // Chuyển is_active thành false (Soft Delete)
        await roomRepository.softDelete(id);
        return true;
    }
}

export const roomService = new RoomService();

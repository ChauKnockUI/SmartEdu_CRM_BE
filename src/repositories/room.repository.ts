import { Prisma } from '../generated/prisma';
import { prisma } from '../database/db';
import { currentTenantId } from '../database/tenant-context';

export class RoomRepository {
    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.RoomWhereInput;
        orderBy?: Prisma.RoomOrderByWithRelationInput;
    }) {
        return await prisma.room.findMany(params);
    }

    async count(where?: Prisma.RoomWhereInput) {
        return await prisma.room.count({ where });
    }

    async findById(id: number) {
        return await prisma.room.findUnique({
            where: { id }
        });
    }

    async findByName(name: string) {
        return await prisma.room.findUnique({
            where: { tenant_id_name: { tenant_id: currentTenantId(), name } }
        });
    }

    async create(data: Prisma.RoomCreateInput) {
        return await prisma.room.create({ data });
    }

    async update(id: number, data: Prisma.RoomUpdateInput) {
        return await prisma.room.update({
            where: { id },
            data
        });
    }

    async softDelete(id: number) {
        return await prisma.room.update({
            where: { id },
            data: { is_active: false }
        });
    }

    async checkExistence(id: number) {
        return await prisma.room.findUnique({
            where: { id },
            select: { id: true, is_active: true }
        });
    }
}

export const roomRepository = new RoomRepository();

import { Prisma, LeadStatus, UserRole } from '../generated/prisma';
import { prisma } from '../database/db';

export class LeadRepository {
    async count(where: Prisma.LeadWhereInput) {
        return await prisma.lead.count({ where });
    }

    async findMany(where: Prisma.LeadWhereInput, skip: number, take: number, orderBy: any) {
        return await prisma.lead.findMany({
            where,
            skip,
            take,
            orderBy,
            include: {
                assignedUser: {
                    select: {
                        id: true,
                        full_name: true,
                        email: true,
                        avatar_url: true,
                        role: true,
                    }
                },
                aiScore: true
            }
        });
    }

    async findById(id: number) {
        return await prisma.lead.findUnique({
            where: { id },
            include: {
                assignedUser: {
                    select: {
                        id: true,
                        full_name: true,
                        email: true,
                        avatar_url: true,
                        role: true
                    }
                },
                course: true,
                activities: {
                    orderBy: { createdAt: 'desc' },
                    take: 20
                },
                aiScore: {
                    select: {
                        probability_score: true,
                        recommendation: true,
                        positive_factors: true,
                        negative_factors: true
                    }
                }
            }
        });
    }

    async getActivitiesByLeadId(leadId: number, skip?: number, take?: number) {
        return await prisma.leadActivity.findMany({
            where: { lead_id: leadId },
            skip,
            take,
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        id: true,
                        full_name: true,
                        avatar_url: true,
                    }
                }
            }
        });
    }

    async countActivities(leadId: number) {
        return await prisma.leadActivity.count({
            where: { lead_id: leadId }
        });
    }

    async createActivity(data: Prisma.LeadActivityUncheckedCreateInput) {
        return await prisma.leadActivity.create({
            data,
            include: {
                user: {
                    select: {
                        id: true,
                        full_name: true,
                        avatar_url: true,
                    }
                }
            }
        });
    }

    async updateLastContacted(leadId: number) {
        return await prisma.lead.update({
            where: { id: leadId },
            data: { last_contacted: new Date() }
        });
    }

    /**
     * Lấy thông tin Lead đầy đủ để chuẩn bị Convert (có email, status, student)
     */
    async findLeadForConvert(id: number) {
        return await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                full_name: true,
                phone: true,
                email: true,
                status: true,
                student: { select: { id: true } } // Kiểm tra đã convert trước đó chưa
            }
        });
    }

    /**
     * Thực thi Convert Lead → Student trong một Atomic Transaction.
     * Nếu bất kỳ bước nào thất bại → Prisma tự động ROLLBACK toàn bộ.
     *
     * Các bước bên trong Transaction:
     *   1. Tạo User account với role student
     *   2. Tạo Student record (link user_id + lead_id)
     *   3. Update Lead status → enrolled
     */
    async convertLeadToStudent(params: {
        lead_id: number;
        full_name: string;
        phone?: string | null;
        email: string;
        password_hash: string;
    }) {
        return await prisma.$transaction(async (tx) => {
            // BƯỚC 1: Tạo User account với role student
            const newUser = await tx.user.create({
                data: {
                    email: params.email,
                    password_hash: params.password_hash,
                    full_name: params.full_name,
                    phone: params.phone ?? undefined,
                    role: UserRole.student,
                    is_active: true,
                }
            });

            // BƯỚC 2: Tạo Student record (link user_id + lead_id)
            const newStudent = await tx.student.create({
                data: {
                    user_id: newUser.id,
                    lead_id: params.lead_id,
                    full_name: params.full_name,
                    phone: params.phone ?? undefined,
                    email: params.email,
                    enrollment_date: new Date(),
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            role: true,
                        }
                    }
                }
            });

            // BƯỚC 3: Update Lead status → enrolled
            await tx.lead.update({
                where: { id: params.lead_id },
                data: { status: LeadStatus.enrolled }
            });

            return newStudent;
        });
    }

    async checkExistence(id: number) {
        return await prisma.lead.findUnique({
            where: { id },
            select: { id: true }
        });
    }

    async create(data: Prisma.LeadUncheckedCreateInput) {
        return await prisma.lead.create({
            data
        });
    }

    async update(id: number, data: Prisma.LeadUncheckedUpdateInput) {
        return await prisma.lead.update({
            where: { id },
            data
        });
    }

    async delete(id: number) {
        return await prisma.lead.delete({
            where: { id }
        });
    }
}

export const leadRepository = new LeadRepository();

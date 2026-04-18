import { PrismaClient, Prisma, LeadStatus } from '../generated/prisma';

const prisma = new PrismaClient();

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

import { randomInt } from 'crypto';
import { Prisma, LeadStatus, UserRole } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { currentTenantId } from '../database/tenant-context';

export interface FunnelAggregateRow {
    status: string;
    source: string | null;
    count: number;
    feeSum: number;
    weightedSum: number;
    scoreSum: number;
    staleCount: number;
    unassignedCount?: number;
}

export class LeadRepository {
    async getSourceValues(assignedTo?: number) {
        return prisma.lead.findMany({
            where: { lead_source: { not: null }, ...(assignedTo !== undefined ? { assigned_to: assignedTo } : {}) },
            select: { lead_source: true },
            distinct: ['lead_source'],
            orderBy: { lead_source: 'asc' },
        });
    }

    private buildInvoiceNo() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const random = randomInt(0, 100_000_000).toString().padStart(8, '0');
        return `INV-${yyyy}${mm}${dd}-${random}`;
    }

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
                course: {
                    select: {
                        id: true,
                        name: true,
                        fee: true,
                    }
                },
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
                        negative_factors: true,
                        scored_at: true
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
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

    async findLeadForConvert(id: number) {
        return await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                full_name: true,
                phone: true,
                email: true,
                course_id: true,
                course: { select: { id: true, name: true, fee: true } },
                status: true,
                student: { select: { id: true } }
            }
        });
    }

    async convertLeadToStudent(params: {
        lead_id: number;
        full_name: string;
        phone?: string | null;
        email: string;
        password_hash: string;
        course_id?: number | null;
        course?: { id: number; name: string; fee: Prisma.Decimal | null } | null;
    }) {
        // Account, student, lead status and invoice must commit together.
        return await withTenantTx(async (tx) => {
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

            await tx.lead.update({
                where: { id: params.lead_id },
                data: { status: LeadStatus.enrolled }
            });

            if (params.course?.fee) {
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 7);

                await tx.invoice.create({
                    data: {
                        invoice_no: this.buildInvoiceNo(),
                        student_id: newStudent.id,
                        total_amount: params.course.fee,
                        discount_amount: 0,
                        due_date: dueDate,
                        notes: `Auto-created from Lead #${params.lead_id}`,
                        items: {
                            create: [{
                                type: 'tuition',
                                description: `Tuition fee - ${params.course.name}`,
                                amount: params.course.fee,
                            }],
                        },
                    },
                });
            }

            return newStudent;
        });
    }

    async getFunnelAggregates(filters: {
        assigned_to?: number;
        source?: string;
        course_id?: number;
        date_from?: Date;
        date_to?: Date;
        staleBefore: Date;
        status?: LeadStatus;
        search?: string;
        needs_care?: boolean;
    }): Promise<FunnelAggregateRow[]> {
        const tenantId = currentTenantId();
        const conds: Prisma.Sql[] = [Prisma.sql`l.tenant_id = ${tenantId}`];
        if (filters.assigned_to) conds.push(Prisma.sql`l.assigned_to = ${filters.assigned_to}`);
        if (filters.source) conds.push(Prisma.sql`l.lead_source = ${filters.source}`);
        if (filters.course_id) conds.push(Prisma.sql`l.course_id = ${filters.course_id}`);
        if (filters.date_from) conds.push(Prisma.sql`l."createdAt" >= ${filters.date_from}`);
        if (filters.date_to) conds.push(Prisma.sql`l."createdAt" <= ${filters.date_to}`);
        if (filters.status) conds.push(Prisma.sql`l.status::text = ${filters.status}`);
        if (filters.search) {
            const pattern = `%${filters.search}%`;
            conds.push(Prisma.sql`(l.full_name ILIKE ${pattern} OR l.phone ILIKE ${pattern} OR l.email ILIKE ${pattern})`);
        }
        if (filters.needs_care) conds.push(Prisma.sql`(l.status IN ('new', 'contacted', 'interested', 'trial') AND (l.last_contacted IS NULL OR l.last_contacted < ${filters.staleBefore}))`);

        // Scores are percentages on 0..100, including sub-one-percent values.
        const rows = await withTenantTx((tx) =>
            tx.$queryRaw<
                {
                    status: string;
                    source: string | null;
                    cnt: bigint;
                    fee_sum: Prisma.Decimal | null;
                    weighted_sum: number | null;
                    score_sum: number | null;
                    stale_cnt: bigint;
                    unassigned_cnt: bigint;
                }[]
            >(Prisma.sql`
                SELECT l.status::text AS status,
                       l.lead_source AS source,
                       count(*) AS cnt,
                       COALESCE(sum(c.fee), 0) AS fee_sum,
                       COALESCE(sum(COALESCE(c.fee, 0)::float8 * COALESCE(a.probability_score, 0) / 100), 0) AS weighted_sum,
                       COALESCE(sum(a.probability_score), 0) AS score_sum,
                       count(*) FILTER (WHERE l.status IN ('new', 'contacted', 'interested', 'trial')
                                          AND (l.last_contacted IS NULL OR l.last_contacted < ${filters.staleBefore})) AS stale_cnt,
                       count(*) FILTER (WHERE l.assigned_to IS NULL AND l.status IN ('new', 'contacted', 'interested', 'trial')) AS unassigned_cnt
                FROM leads l
                LEFT JOIN courses c ON c.id = l.course_id
                LEFT JOIN lead_ai_scores a ON a.lead_id = l.id
                WHERE ${Prisma.join(conds, ' AND ')}
                GROUP BY l.status, l.lead_source
            `)
        );

        return rows.map((r) => ({
            status: r.status,
            source: r.source,
            count: Number(r.cnt),
            feeSum: Number(r.fee_sum ?? 0),
            weightedSum: Number(r.weighted_sum ?? 0),
            scoreSum: Number(r.score_sum ?? 0),
            staleCount: Number(r.stale_cnt),
            unassignedCount: Number(r.unassigned_cnt ?? 0),
        }));
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

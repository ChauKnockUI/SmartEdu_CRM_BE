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
}

export class LeadRepository {
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
                course_id: true,
                course: { select: { id: true, name: true, fee: true } },
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
        course_id?: number | null;
        course?: { id: number; name: string; fee: Prisma.Decimal | null } | null;
    }) {
        return await withTenantTx(async (tx) => {
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

    /**
     * Gom phễu bán hàng ngay trong DB: mỗi dòng = một cặp (status, nguồn).
     * Thay cho việc tải toàn bộ lead của tenant vào Node.
     */
    async getFunnelAggregates(filters: {
        assigned_to?: number;
        source?: string;
        course_id?: number;
        date_from?: Date;
        date_to?: Date;
        staleBefore: Date;
    }): Promise<FunnelAggregateRow[]> {
        const tenantId = currentTenantId();
        const conds: Prisma.Sql[] = [Prisma.sql`l.tenant_id = ${tenantId}`];
        if (filters.assigned_to) conds.push(Prisma.sql`l.assigned_to = ${filters.assigned_to}`);
        if (filters.source) conds.push(Prisma.sql`l.lead_source = ${filters.source}`);
        if (filters.course_id) conds.push(Prisma.sql`l.course_id = ${filters.course_id}`);
        if (filters.date_from) conds.push(Prisma.sql`l."createdAt" >= ${filters.date_from}`);
        if (filters.date_to) conds.push(Prisma.sql`l."createdAt" <= ${filters.date_to}`);

        // Quy đổi điểm AI: giá trị > 1 là phần trăm, <= 1 là xác suất (giữ nguyên quy ước cũ)
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
                }[]
            >(Prisma.sql`
                SELECT l.status::text AS status,
                       l.lead_source AS source,
                       count(*) AS cnt,
                       COALESCE(sum(c.fee), 0) AS fee_sum,
                       COALESCE(sum(COALESCE(c.fee, 0)::float8 * (CASE WHEN COALESCE(a.probability_score, 0) > 1 THEN a.probability_score / 100 ELSE COALESCE(a.probability_score, 0) END)), 0) AS weighted_sum,
                       COALESCE(sum(CASE WHEN COALESCE(a.probability_score, 0) <= 1 THEN COALESCE(a.probability_score, 0) * 100 ELSE a.probability_score END), 0) AS score_sum,
                       count(*) FILTER (WHERE l.status IN ('new', 'contacted', 'interested', 'trial')
                                          AND (l.last_contacted IS NULL OR l.last_contacted < ${filters.staleBefore})) AS stale_cnt
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

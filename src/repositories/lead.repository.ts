import { Prisma, LeadStatus, UserRole } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { currentTenantId } from '../database/tenant-context';
import { LEAD_PHONE_SEPARATORS, LEAD_PHONE_COUNTRY_PREFIX, normalizeLeadPhone, normalizeLeadEmail } from '../utils/leadContact';
import { LEAD_CHANGED, LEAD_ACTIVE_STATUSES } from '../constants/leadWorkflow';
import { createClassInvoice } from './classInvoice';
import { leadEmailRequestPrefix } from '../utils/leadEmail';
import { effectiveClassStatus } from '../utils/classStatus';
import type { LeadCareFilter } from '../constants/leadWorkflow';

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
    async findAssignableSale(id: number) {
        return prisma.user.findFirst({
            where: { id, role: UserRole.sale, is_active: true },
            select: { id: true, full_name: true },
        });
    }

    async getSourceValues(assignedTo?: number) {
        return prisma.lead.findMany({
            where: { lead_source: { not: null }, ...(assignedTo !== undefined ? { assigned_to: assignedTo } : {}) },
            select: { lead_source: true },
            distinct: ['lead_source'],
            orderBy: { lead_source: 'asc' },
        });
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
                        is_active: true,
                    }
                },
                aiScore: true,
                student: { select: { id: true } },
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
                        role: true,
                        is_active: true,
                    }
                },
                course: true,
                student: { select: { id: true, classEnrollments: { where: { status: 'active' },
                    select: { class_id: true, class: { select: { name: true, status: true } } } } } },
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

    async createContactActivity(lead: { id: number; status: LeadStatus; assigned_to: number | null }, data: Prisma.LeadActivityUncheckedCreateInput) {
        return withTenantTx(async tx => {
            const now = new Date();
            const updated = await tx.lead.updateMany({
                where: { id: lead.id, status: lead.status, assigned_to: lead.assigned_to,
                    assignedUser: { role: UserRole.sale, is_active: true } },
                data: { status: lead.status === LeadStatus.new ? LeadStatus.contacted : lead.status, last_contacted: now },
            });
            if (!updated.count) throw Object.assign(new Error(LEAD_CHANGED), { statusCode: 409 });
            return tx.leadActivity.create({ data: { ...data, createdAt: now },
                include: { user: { select: { id: true, full_name: true, avatar_url: true } } } });
        });
    }

    async findSentEmail(leadId: number, requestId: string) {
        return prisma.leadActivity.findFirst({ where: { lead_id: leadId, type: 'email',
            content: { startsWith: leadEmailRequestPrefix(requestId) } } });
    }

    async recordSentEmail(lead: { id: number; status: LeadStatus; assigned_to: number | null; email: string | null },
        requestId: string, content: string, userId: number) {
        return withTenantTx(async tx => {
            await tx.$queryRaw`SELECT id FROM leads WHERE id = ${lead.id} FOR UPDATE`;
            const existing = await tx.leadActivity.findFirst({ where: { lead_id: lead.id, type: 'email',
                content: { startsWith: leadEmailRequestPrefix(requestId) } } });
            if (existing) return { activity: existing, leadUpdated: true };
            const now = new Date();
            // The provider already accepted the email. Always retain its history, even if
            // another tab closed/reassigned the lead while the HTTP request was running.
            const updated = await tx.lead.updateMany({
                where: { id: lead.id, status: lead.status, assigned_to: lead.assigned_to, email: lead.email,
                    assignedUser: { role: UserRole.sale, is_active: true } },
                data: { status: lead.status === LeadStatus.new ? LeadStatus.contacted : lead.status, last_contacted: now },
            });
            const activity = await tx.leadActivity.create({ data: { lead_id: lead.id, user_id: userId,
                type: 'email', content, engagement_status: 'unknown', createdAt: now } });
            return { activity, leadUpdated: updated.count > 0 };
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
                assigned_to: true,
                student: { select: { id: true } }
            }
        });
    }

    async convertLeadToStudent(params: {
        lead_id: number;
        assigned_to: number;
        status: LeadStatus;
        full_name: string;
        phone?: string | null;
        email: string;
        password_hash: string;
        course_id?: number | null;
        class_id?: number;
        user_id?: number;
    }) {
        // Account, student, lead status and invoice must commit together.
        return await withTenantTx(async (tx) => {
            if (params.class_id) {
                await tx.$queryRaw`SELECT id FROM classes WHERE id = ${params.class_id} FOR UPDATE`;
                const target = await tx.class.findUnique({ where: { id: params.class_id },
                    include: { _count: { select: { classEnrollments: { where: { status: 'active' } } } } } });
                if (!target) throw Object.assign(new Error('Không tìm thấy lớp học.'), { statusCode: 404 });
                if (!params.course_id || target.course_id !== params.course_id) {
                    throw Object.assign(new Error('Chọn lớp thuộc khóa quan tâm của Lead.'), { statusCode: 400 });
                }
                if (!['upcoming', 'ongoing'].includes(effectiveClassStatus(target))) {
                    throw Object.assign(new Error('Chỉ có thể xếp vào lớp sắp mở hoặc đang học.'), { statusCode: 400 });
                }
                if (target.max_students && target._count.classEnrollments >= target.max_students) {
                    throw Object.assign(new Error('Lớp đã đủ sĩ số. Vui lòng chọn lớp khác.'), { statusCode: 409 });
                }
            }
            const updated = await tx.lead.updateMany({
                where: { id: params.lead_id, status: params.status, assigned_to: params.assigned_to,
                    course_id: params.course_id,
                    assignedUser: { role: UserRole.sale, is_active: true } },
                data: { status: LeadStatus.enrolled },
            });
            if (!updated.count) throw Object.assign(new Error(LEAD_CHANGED), { statusCode: 409 });
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

            if (params.class_id) {
                await tx.classEnrollment.create({ data: { class_id: params.class_id, student_id: newStudent.id } });
                await createClassInvoice(tx, {
                    class_id: params.class_id, student_id: newStudent.id, allowEmpty: true,
                    due_date: new Date(Date.now() + 7 * 86_400_000), notes: `Tạo khi chuyển Lead #${params.lead_id} và xếp lớp`,
                });
            }
            await tx.leadActivity.create({ data: { lead_id: params.lead_id, type: 'status_change', user_id: params.user_id,
                content: `Đã chuyển thành học viên #${newStudent.id}${params.class_id ? ` và xếp vào lớp #${params.class_id}` : '. Chưa xếp lớp'}.`,
            } });
            return newStudent;
        }, { timeout: 15_000 });
    }

    async getFunnelAggregates(filters: {
        assigned_to?: number | null;
        source?: string;
        course_id?: number;
        date_from?: Date;
        date_to?: Date;
        staleBefore: Date;
        status?: LeadStatus;
        search?: string;
        needs_care?: boolean;
        care?: LeadCareFilter;
    }): Promise<FunnelAggregateRow[]> {
        const tenantId = currentTenantId();
        const conds: Prisma.Sql[] = [Prisma.sql`l.tenant_id = ${tenantId}`];
        if (filters.assigned_to === null) conds.push(Prisma.sql`l.assigned_to IS NULL`);
        else if (filters.assigned_to !== undefined) conds.push(Prisma.sql`l.assigned_to = ${filters.assigned_to}`);
        if (filters.source) conds.push(Prisma.sql`l.lead_source = ${filters.source}`);
        if (filters.course_id) conds.push(Prisma.sql`l.course_id = ${filters.course_id}`);
        if (filters.date_from) conds.push(Prisma.sql`l."createdAt" >= ${filters.date_from}`);
        if (filters.date_to) conds.push(Prisma.sql`l."createdAt" <= ${filters.date_to}`);
        if (filters.status) conds.push(Prisma.sql`l.status::text = ${filters.status}`);
        if (filters.search) {
            const pattern = `%${filters.search}%`;
            conds.push(Prisma.sql`(l.full_name ILIKE ${pattern} OR l.phone ILIKE ${pattern} OR l.email ILIKE ${pattern})`);
        }
        if (filters.care) {
            conds.push(Prisma.sql`l.status::text IN (${Prisma.join(LEAD_ACTIVE_STATUSES)})`);
            conds.push(filters.care === 'unassigned' ? Prisma.sql`l.assigned_to IS NULL`
                : filters.care === 'never_contacted' ? Prisma.sql`l.last_contacted IS NULL`
                    : Prisma.sql`l.last_contacted < ${filters.staleBefore}`);
        } else if (filters.needs_care) conds.push(Prisma.sql`(l.status::text IN (${Prisma.join(LEAD_ACTIVE_STATUSES)}) AND (l.last_contacted IS NULL OR l.last_contacted < ${filters.staleBefore}))`);

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
                       count(*) FILTER (WHERE l.status::text IN (${Prisma.join(LEAD_ACTIVE_STATUSES)})
                                          AND (l.last_contacted IS NULL OR l.last_contacted < ${filters.staleBefore})) AS stale_cnt,
                       count(*) FILTER (WHERE l.assigned_to IS NULL AND l.status::text IN (${Prisma.join(LEAD_ACTIVE_STATUSES)})) AS unassigned_cnt
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
        const tenantId = currentTenantId();
        const phone = normalizeLeadPhone(data.phone);
        const email = normalizeLeadEmail(data.email);
        return await withTenantTx(async tx => {
            // Lock contacts in a fixed order so concurrent creates cannot both pass the check.
            const keys = [phone ? `lead:phone:${phone}` : '', email ? `lead:email:${email}` : ''].filter(Boolean).sort();
            for (const key of keys) {
                await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${tenantId}::int, hashtext(${key}))`);
            }
            if (keys.length) {
                const [duplicate] = await tx.$queryRaw<{ phone_exists: boolean; email_exists: boolean }[]>(Prisma.sql`
                    SELECT COALESCE(bool_or(${Boolean(phone)} AND
                        regexp_replace(regexp_replace(COALESCE(phone, ''), ${LEAD_PHONE_SEPARATORS}, '', 'g'),
                            ${LEAD_PHONE_COUNTRY_PREFIX}, '0') = ${phone}), false) AS phone_exists,
                        COALESCE(bool_or(${Boolean(email)} AND
                            regexp_replace(COALESCE(email, ''), '^\\s+|\\s+$', '', 'g') COLLATE "C" = ${email}), false) AS email_exists
                    FROM leads WHERE tenant_id = ${tenantId}
                `);
                const duplicateFields = [
                    ...(duplicate.phone_exists ? ['phone'] : []),
                    ...(duplicate.email_exists ? ['email'] : []),
                ];
                if (duplicateFields.length) {
                    const label = duplicateFields.length === 2 ? 'Số điện thoại và email'
                        : duplicate.phone_exists ? 'Số điện thoại' : 'Email';
                    throw Object.assign(new Error(`${label} đã tồn tại trong danh sách lead. Không thể tạo lead trùng.`), {
                        statusCode: 409, duplicateFields,
                    });
                }
            }
            return tx.lead.create({ data });
        });
    }

    async update(id: number, data: Prisma.LeadUncheckedUpdateInput, expected?: { status: LeadStatus; assigned_to: number | null }) {
        try {
            return await prisma.lead.update({ where: { id, ...expected }, data });
        } catch (error: any) {
            if (expected && error.code === 'P2025') throw Object.assign(new Error(LEAD_CHANGED), { statusCode: 409 });
            throw error;
        }
    }

    async delete(id: number) {
        return await prisma.lead.delete({
            where: { id }
        });
    }
}

export const leadRepository = new LeadRepository();

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, LeadStatus, LeadActivityType } from '../generated/prisma';
import { leadScoringService } from './ai/leadScoring.service';
import { leadRepository } from '../repositories/lead.repository';
import { leadScoringRepository } from './ai/leadScoring.repository';
import { LEAD_SOURCES, isLeadSource, validateLeadSource } from '../constants/leadSources';
import { LEAD_CARE_STATUSES, LEAD_ASSIGNMENT_REQUIRED, leadNeedsCareWhere, leadCareCutoff, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '../constants/leadWorkflow';
import { leadEmailService } from './leadEmail.service';
import { leadEmailContentPrefix, presentLeadActivity } from '../utils/leadEmail';
import { currentTenantId } from '../database/tenant-context';
import { leadCareWhere, type LeadCareFilter } from '../constants/leadWorkflow';
export interface GetLeadsQuery {
    page?: number;
    limit?: number;
    status?: LeadStatus;
    source?: string;
    assigned_to?: number | null;
    course_id?: number;
    needs_care?: boolean;
    care?: LeadCareFilter;
    date_from?: string; // Định dạng ISO Date
    date_to?: string;   // Định dạng ISO Date
    search?: string;
    sort_by?: 'createdAt' | 'probability_score';
    sort_dir?: 'asc' | 'desc';
}

export interface CreateLeadInput {
    full_name: string;
    phone: string;
    email: string;
    source?: string;
    occupation?: string;
    study_purpose?: string;
    course_id?: number;
}

export interface UpdateLeadInput {
    full_name?: string;
    phone?: string;
    email?: string;
    status?: LeadStatus;
    assigned_to?: number | null;
    notes?: string;
    occupation?: string;
    study_purpose?: string;
    source?: string;
    course_id?: number;
    lost_reason?: string;
}

export interface GetFunnelQuery {
    assigned_to?: number | null;
    source?: string;
    course_id?: number;
    date_from?: string;
    date_to?: string;
    status?: LeadStatus;
    search?: string;
    needs_care?: boolean;
    care?: LeadCareFilter;
}

export interface CreateLeadActivityInput {
    type: LeadActivityType;
    content?: string;
    engagement_status?: string;
    user_id?: number;
}

export interface ConvertLeadInput {
    email?: string;
    class_id?: number;
    user_id?: number;
    user_role?: string;
}

const leadContactSchema = z.object({
    full_name: z.string().trim().min(1, 'Nhập họ tên').max(255, 'Họ tên tối đa 255 ký tự'),
    phone: z.string().trim().regex(/^[0-9]{10}$/, 'Số điện thoại phải có đúng 10 chữ số'),
    email: z.string().trim().min(1, 'Nhập email').max(255, 'Email tối đa 255 ký tự').email('Email không hợp lệ'),
});

export class LeadService {
    private async assertAssignedSale(assignedTo: number | null) {
        if (!assignedTo) throw Object.assign(new Error(LEAD_ASSIGNMENT_REQUIRED), { statusCode: 400 });
        const sale = await leadRepository.findAssignableSale(assignedTo);
        if (!sale) throw Object.assign(new Error('Sale phụ trách không còn hoạt động. Vui lòng phân công Sale khác.'), { statusCode: 400 });
    }

    async getLeadSources(assignedTo?: number) {
        const stored = await leadRepository.getSourceValues(assignedTo);
        const legacy = stored.flatMap(({ lead_source }) =>
            lead_source && !isLeadSource(lead_source)
                ? [{ value: lead_source, label: lead_source, legacy: true }]
                : []);
        return [...LEAD_SOURCES.map(source => ({ ...source, legacy: false })), ...legacy];
    }

    async getLeads(query: GetLeadsQuery) {
        const {
            page = 1,
            limit = 10,
            status,
            source,
            assigned_to,
            course_id,
            needs_care,
            care,
            date_from,
            date_to,
            search,
            sort_by = 'createdAt',
            sort_dir = 'desc'
        } = query;

        const skip = (page - 1) * limit;

        const where: Prisma.LeadWhereInput = {};

        if (status) {
            where.status = status;
        }

        if (source) {
            where.lead_source = source;
        }

        if (assigned_to !== undefined) {
            where.assigned_to = assigned_to;
        }
        if (course_id) where.course_id = course_id;
        if (care || needs_care) {
            where.AND = [care ? leadCareWhere(care) : leadNeedsCareWhere()];
        }

        if (date_from || date_to) {
            where.createdAt = {};
            if (date_from) where.createdAt.gte = new Date(date_from);
            if (date_to) where.createdAt.lte = new Date(date_to);
        }

        if (search) {
            where.OR = [
                { full_name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ];
        }

        let orderBy: any;

        if (sort_by === 'probability_score') {
            orderBy = [
                { aiScore: { probability_score: sort_dir } },
                { createdAt: 'desc' }
            ];
        } else {
            orderBy = { createdAt: sort_dir };
        }

        const [total, data] = await Promise.all([
            leadRepository.count(where),
            leadRepository.findMany(where, skip, limit, orderBy)
        ]);

        const normalizedData = await leadScoringRepository.decorateLeads(data);

        return {
            data: normalizedData,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getLeadById(id: number) {
        const lead = await leadRepository.findById(id);

        if (!lead) return null;

        const result = (await leadScoringRepository.decorateLeads([lead]))[0];
        return { ...result, activities: result.activities?.map(presentLeadActivity) };
    }

    async getLeadActivities(leadId: number, query: { page?: number; limit?: number }) {
        const lead = await leadRepository.checkExistence(leadId);
        if (!lead) return null;

        const page = query.page && query.page > 0 ? query.page : 1;
        const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 100;
        const skip = (page - 1) * limit;

        const [total, activities] = await Promise.all([
            leadRepository.countActivities(leadId),
            leadRepository.getActivitiesByLeadId(leadId, skip, limit)
        ]);

        return {
            data: activities.map(presentLeadActivity),
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async sendLeadEmail(leadId: number, input: unknown, actor: { userId: number; role: string }) {
        const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
        if (!['admin', 'sale'].includes(actor.role)) throw fail('Không có quyền gửi email cho Lead.', 403);
        if (!Number.isInteger(leadId) || leadId <= 0 || leadId > 2147483647) throw fail('ID Lead không hợp lệ.', 400);
        const parsed = z.object({
            to: z.string().trim().max(255).email('Email người nhận không hợp lệ.'),
            subject: z.string().trim().min(1, 'Nhập tiêu đề email.').max(200, 'Tiêu đề tối đa 200 ký tự.').regex(/^[^\r\n]+$/, 'Tiêu đề chỉ gồm một dòng.'),
            text: z.string().trim().min(1, 'Nhập nội dung email.').max(10000, 'Nội dung tối đa 10.000 ký tự.'),
            request_id: z.string().uuid('Mã yêu cầu gửi không hợp lệ.'),
        }).safeParse(input);
        if (!parsed.success) throw fail(parsed.error.issues[0].message, 400);
        const { to, subject, text, request_id } = parsed.data;
        const lead = await leadRepository.findLeadForConvert(leadId);
        if (!lead) throw fail('Không tìm thấy Lead.', 404);
        if (actor.role === 'sale' && lead.assigned_to !== actor.userId) throw fail('Bạn chỉ được gửi email cho Lead đang phụ trách.', 403);
        const prefix = leadEmailContentPrefix(request_id, to, subject, text);
        const existing = await leadRepository.findSentEmail(leadId, request_id);
        if (existing) {
            if (!existing.content?.startsWith(prefix)) throw fail('Yêu cầu này đã gửi với nội dung khác. Vui lòng tạo email mới.', 409);
            return { delivery: 'accepted', history_saved: true, activity: presentLeadActivity(existing) };
        }
        if (['enrolled', 'lost'].includes(lead.status)) throw fail('Lead đã kết thúc quy trình. Bạn vẫn có thể thêm ghi chú nội bộ.', 400);
        await this.assertAssignedSale(lead.assigned_to);
        if (to !== lead.email?.trim()) throw fail('Email Lead đã thay đổi. Vui lòng tải lại thông tin trước khi gửi.', 409);
        await leadEmailService.send({ to, subject, text,
            idempotencyKey: `lead-email/${currentTenantId()}/${leadId}/${request_id}` });
        const content = `${prefix}Người nhận: ${to}\nTiêu đề: ${subject}\n\n${text}`;
        try {
            const saved = await leadRepository.recordSentEmail(lead, request_id, content, actor.userId);
            if (saved.leadUpdated) leadScoringService.scoreLead(leadId).catch(() => {});
            return { delivery: 'accepted', history_saved: true, lead_updated: saved.leadUpdated,
                activity: presentLeadActivity(saved.activity) };
        } catch {
            // The send cannot be rolled back. Report acceptance accurately instead of inviting a new send.
            return { delivery: 'accepted', history_saved: false };
        }
    }

    async createLeadActivity(leadId: number, data: CreateLeadActivityInput) {
        const lead = await leadRepository.findLeadForConvert(leadId);
        if (!lead) return null;

        const isRealInteraction = ['call', 'email', 'sms', 'meeting'].includes(data.type);
        if (isRealInteraction && (lead.status === LeadStatus.enrolled || lead.status === LeadStatus.lost)) {
            throw Object.assign(new Error('Lead đã kết thúc quy trình. Bạn vẫn có thể thêm ghi chú nội bộ.'), { statusCode: 400 });
        }
        if (isRealInteraction) await this.assertAssignedSale(lead.assigned_to);
        const activityData = {
            lead_id: leadId,
            type: data.type,
            content: data.content,
            engagement_status: data.engagement_status,
            user_id: data.user_id,
        };
        const activity = isRealInteraction
            ? await leadRepository.createContactActivity(lead, activityData)
            : await leadRepository.createActivity(activityData);

        if (isRealInteraction) leadScoringService.scoreLead(leadId).catch(err => {
            console.error(`[AI Trigger Error] Lỗi khi re-score Lead sau Activity (Lead ID: ${leadId}):`, err.message);
        });

        return activity;

    }

    async createLead(data: CreateLeadInput) {
        if (data.source !== undefined) validateLeadSource(data.source);
        const contact = leadContactSchema.safeParse(data);
        if (!contact.success) {
            throw Object.assign(new Error(contact.error.issues[0].message), { statusCode: 400 });
        }
        const lead = await leadRepository.create({
            full_name: contact.data.full_name,
            phone: contact.data.phone,
            email: contact.data.email,
            lead_source: data.source,
            occupation: data.occupation,
            study_purpose: data.study_purpose,
            course_id: data.course_id,
        });

        leadScoringService.scoreLead(lead.id).catch(err => {
            console.error(`[AI Trigger Error] Lỗi khi tự động chấm điểm Lead (ID: ${lead.id}):`, err.message);
        });

        return lead;
    }

    async updateLead(id: number, data: UpdateLeadInput, userId?: number) {
        const lead = await leadRepository.findById(id);
        if (!lead) return null;
        if (data.status !== undefined && !Object.values(LeadStatus).includes(data.status)) {
            throw Object.assign(new Error('Giai đoạn không hợp lệ.'), { statusCode: 400 });
        }
        if (lead.status === LeadStatus.enrolled && data.status && data.status !== lead.status) {
            throw Object.assign(new Error('Lead đã đăng ký, không thể thay đổi giai đoạn.'), { statusCode: 400 });
        }
        const contact = leadContactSchema.partial().safeParse(data);
        if (!contact.success) {
            throw Object.assign(new Error(contact.error.issues[0].message), { statusCode: 400 });
        }
        if (data.source !== undefined) validateLeadSource(data.source, lead.lead_source);

        const assignment = z.number().int().positive().max(2147483647).nullable().optional().safeParse(data.assigned_to);
        if (!assignment.success) {
            throw Object.assign(new Error('Người phụ trách không hợp lệ.'), { statusCode: 400 });
        }
        const assignmentChanged = data.assigned_to !== undefined && data.assigned_to !== lead.assigned_to;
        if (data.assigned_to === null && LEAD_CARE_STATUSES.includes(lead.status)) {
            throw Object.assign(new Error('Lead đang được chăm sóc. Vui lòng chuyển sang Sale khác thay vì bỏ phân công.'), { statusCode: 400 });
        }
        let assignedName = 'Chưa phân công';
        if (assignmentChanged && data.assigned_to !== null) {
            const sale = await leadRepository.findAssignableSale(data.assigned_to!);
            if (!sale) {
                throw Object.assign(new Error('Chọn sale đang hoạt động trong trung tâm để phân công.'), { statusCode: 400 });
            }
            assignedName = sale.full_name;
        }

        const oldStatus = lead.status;
        const isStatusChanged = Boolean(data.status && data.status !== oldStatus);
        if (data.status && (LEAD_CARE_STATUSES.includes(data.status) || data.status === LeadStatus.enrolled)) {
            const assignedTo = data.assigned_to !== undefined ? data.assigned_to : lead.assigned_to;
            if (!assignmentChanged) await this.assertAssignedSale(assignedTo);
            else if (!assignedTo) throw Object.assign(new Error(LEAD_ASSIGNMENT_REQUIRED), { statusCode: 400 });
        }
        if (data.status === LeadStatus.enrolled && isStatusChanged) {
            throw Object.assign(new Error('Vui lòng dùng chức năng Chuyển thành học viên để hoàn tất đăng ký.'), { statusCode: 400 });
        }
        if (data.status === LeadStatus.lost && isStatusChanged && (typeof data.lost_reason !== 'string' || !data.lost_reason.trim())) {
            throw Object.assign(new Error('Vui lòng nhập lý do thất bại.'), { statusCode: 400 });
        }

        let notesToSave = data.notes !== undefined ? data.notes : lead.notes;
        if (data.lost_reason) {
            const reasonPrefix = `[Lý do mất lead: ${data.lost_reason}]`;
            notesToSave = notesToSave ? `${reasonPrefix} ${notesToSave}` : reasonPrefix;
        }

        const updateData: Prisma.LeadUncheckedUpdateInput = {
            ...contact.data,
            status: data.status,
            assigned_to: data.assigned_to,
            notes: notesToSave,
            occupation: data.occupation,
            study_purpose: data.study_purpose,
            lead_source: data.source,
            course_id: data.course_id,
            ...(assignmentChanged ? { activities: { create: {
                type: 'note',
                content: `Người phụ trách: ${lead.assignedUser?.full_name || (lead.assigned_to ? `Sale #${lead.assigned_to}` : 'Chưa phân công')} → ${assignedName}`,
                user_id: userId,
            } } } : {}),
        };
        const updatedLead = assignmentChanged || data.status !== undefined
            ? await leadRepository.update(id, updateData, { status: lead.status, assigned_to: lead.assigned_to })
            : await leadRepository.update(id, updateData);

        if (isStatusChanged) {
            const oldLabel = LEAD_STATUS_LABELS[oldStatus];
            const newLabel = LEAD_STATUS_LABELS[data.status!];
            let activityContent = `Chuyển giai đoạn: "${oldLabel}" ➔ "${newLabel}"`;
            if (data.lost_reason) {
                activityContent += `. Lý do: ${data.lost_reason}`;
            }
            if (data.notes) {
                activityContent += ` (Ghi chú: ${data.notes})`;
            }

            leadRepository.createActivity({
                lead_id: id,
                type: 'status_change',
                content: activityContent,
                user_id: userId,
            }).catch(err => {
                console.error('[LeadService] Ghi log status_change activity lỗi:', err.message);
            });
        }

        const aiFeatureTriggers: (keyof UpdateLeadInput)[] = [
            'status', 'occupation', 'study_purpose', 'source', 'course_id'
        ];

        const shouldScore = aiFeatureTriggers.some(field => data[field] !== undefined);

        if (shouldScore) {
            leadScoringService.scoreLead(id).catch(err => {
                console.error(`[AI Trigger Error] Lỗi khi cập nhật điểm AI cho Lead (ID: ${id}):`, err.message);
            });
        }

        return updatedLead;
    }

    async getLeadFunnel(query: GetFunnelQuery) {
        const { assigned_to, source, course_id, date_from, date_to, status, search, needs_care, care } = query;
        const now = new Date();
        const threeDaysAgo = leadCareCutoff(now);

        const rows = await leadRepository.getFunnelAggregates({
            assigned_to,
            source,
            course_id,
            status, search, needs_care, care,
            date_from: date_from ? new Date(date_from) : undefined,
            date_to: date_to ? new Date(date_to) : undefined,
            staleBefore: threeDaysAgo,
        });

        const ACTIVE = ['new', 'contacted', 'interested', 'trial'];
        const sumBy = (statuses: string[] | null, f: (r: typeof rows[number]) => number) =>
            rows.filter(r => !statuses || statuses.includes(r.status)).reduce((acc, r) => acc + f(r), 0);
        const countOf = (statuses: string[] | null) => sumBy(statuses, r => r.count);

        const STAGES: { key: LeadStatus; label: string; description: string; color: string }[] = [
            { key: 'new', label: LEAD_STATUS_LABELS.new, description: 'Lead mới từ marketing / website', color: LEAD_STATUS_COLORS.new },
            { key: 'contacted', label: LEAD_STATUS_LABELS.contacted, description: 'Sale đã tương tác cuộc gọi / tin nhắn đầu tiên', color: LEAD_STATUS_COLORS.contacted },
            { key: 'interested', label: LEAD_STATUS_LABELS.interested, description: 'Khách hàng có nhu cầu học rõ ràng', color: LEAD_STATUS_COLORS.interested },
            { key: 'trial', label: LEAD_STATUS_LABELS.trial, description: 'Đang xếp lịch hoặc đang tham gia học thử', color: LEAD_STATUS_COLORS.trial },
            { key: 'enrolled', label: LEAD_STATUS_LABELS.enrolled, description: 'Chốt thành công, nhập học', color: LEAD_STATUS_COLORS.enrolled },
            { key: 'lost', label: LEAD_STATUS_LABELS.lost, description: 'Khách hàng từ chối hoặc mất liên lạc', color: LEAD_STATUS_COLORS.lost }
        ];

        const totalLeads = countOf(null);
        const stageStats = STAGES.map(s => {
            const only = [s.key as string];
            const count = countOf(only);
            return {
                stage: s.key,
                label: s.label,
                description: s.description,
                color: s.color,
                count,
                percentage: totalLeads > 0 ? Number(((count / totalLeads) * 100).toFixed(1)) : 0,
                totalValue: sumBy(only, r => r.feeSum),
                weightedValue: Math.round(sumBy(only, r => r.weightedSum)),
                avgScore: count > 0 ? Math.round(sumBy(only, r => r.scoreSum) / count) : 0,
                staleCount: sumBy(only, r => r.staleCount)
            };
        });

        const activeCount = countOf(ACTIVE);
        const activePipelineValue = sumBy(ACTIVE, r => r.feeSum);
        const weightedPipelineValue = sumBy(ACTIVE, r => r.weightedSum);
        const enrolledCount = countOf(['enrolled']);
        const lostCount = countOf(['lost']);
        const closedCount = enrolledCount + lostCount;
        const winRate = closedCount > 0
            ? Number(((enrolledCount / closedCount) * 100).toFixed(1))
            : (totalLeads > 0 ? Number(((enrolledCount / totalLeads) * 100).toFixed(1)) : 0);

        const progressedContacted = countOf(['contacted', 'interested', 'trial', 'enrolled']);
        const progressedInterested = countOf(['interested', 'trial', 'enrolled']);
        const progressedTrial = countOf(['trial', 'enrolled']);
        const progressedEnrolled = enrolledCount;

        // Legacy aggregate of current statuses, not measured transition history.
        const progressionFunnel = [
            {
                step: '1. Đầu phễu (Tổng Lead)',
                stage: 'new',
                count: totalLeads,
                percentOfTotal: 100,
                conversionFromPrevious: 100,
                color: '#1677ff'
            },
            {
                step: '2. Đã tiếp cận (Contacted)',
                stage: 'contacted',
                count: progressedContacted,
                percentOfTotal: totalLeads > 0 ? Number(((progressedContacted / totalLeads) * 100).toFixed(1)) : 0,
                conversionFromPrevious: totalLeads > 0 ? Number(((progressedContacted / totalLeads) * 100).toFixed(1)) : 0,
                color: '#13c2c2'
            },
            {
                step: '3. Quan tâm cao (Interested)',
                stage: 'interested',
                count: progressedInterested,
                percentOfTotal: totalLeads > 0 ? Number(((progressedInterested / totalLeads) * 100).toFixed(1)) : 0,
                conversionFromPrevious: progressedContacted > 0 ? Number(((progressedInterested / progressedContacted) * 100).toFixed(1)) : 0,
                color: '#faad14'
            },
            {
                step: '4. Vào học thử (Trial)',
                stage: 'trial',
                count: progressedTrial,
                percentOfTotal: totalLeads > 0 ? Number(((progressedTrial / totalLeads) * 100).toFixed(1)) : 0,
                conversionFromPrevious: progressedInterested > 0 ? Number(((progressedTrial / progressedInterested) * 100).toFixed(1)) : 0,
                color: '#722ed1'
            },
            {
                step: '5. Chốt đăng ký (Enrolled)',
                stage: 'enrolled',
                count: progressedEnrolled,
                percentOfTotal: totalLeads > 0 ? Number(((progressedEnrolled / totalLeads) * 100).toFixed(1)) : 0,
                conversionFromPrevious: progressedTrial > 0 ? Number(((progressedEnrolled / progressedTrial) * 100).toFixed(1)) : 0,
                color: '#52c41a'
            }
        ];

        const sourceMap = new Map<string, { total: number; enrolled: number; value: number }>();
        rows.forEach(r => {
            const src = r.source || 'other';
            const curr = sourceMap.get(src) || { total: 0, enrolled: 0, value: 0 };
            curr.total += r.count;
            if (r.status === 'enrolled') {
                curr.enrolled += r.count;
                curr.value += r.feeSum;
            }
            sourceMap.set(src, curr);
        });

        const sourcePerformance = Array.from(sourceMap.entries()).map(([source, stats]) => ({
            source,
            total: stats.total,
            enrolled: stats.enrolled,
            conversionRate: stats.total > 0 ? Number(((stats.enrolled / stats.total) * 100).toFixed(1)) : 0,
            revenue: stats.value
        })).sort((a, b) => b.enrolled - a.enrolled);

        return {
            summary: {
                totalLeads,
                activePipelineCount: activeCount,
                activePipelineValue,
                weightedPipelineValue: Math.round(weightedPipelineValue),
                enrolledCount,
                enrolledValue: sumBy(['enrolled'], r => r.feeSum),
                lostCount,
                winRate,
                staleLeadsCount: sumBy(ACTIVE, r => r.staleCount),
                unassignedCount: sumBy(ACTIVE, r => r.unassignedCount ?? 0)
            },
            stages: stageStats,
            progressionFunnel,
            sourcePerformance
        };
    }

    async deleteLead(id: number): Promise<boolean> {
        const existingLead = await leadRepository.checkExistence(id);

        if (!existingLead) {
            return false;
        }

        await leadRepository.delete(id);

        return true;
    }

    async convertLeadToStudent(leadId: number, input: ConvertLeadInput) {
        if (input.class_id !== undefined && input.user_role !== 'admin') {
            throw Object.assign(new Error('Chỉ Admin được xếp lớp. Sale có thể chuyển Lead thành học viên để chờ xếp lớp.'), { statusCode: 403 });
        }
        const classId = z.number().int().positive().max(2147483647).optional().safeParse(input.class_id);
        if (!classId.success) throw Object.assign(new Error('Lớp học không hợp lệ.'), { statusCode: 400 });
        const lead = await leadRepository.findLeadForConvert(leadId);

        if (!lead) {
            const err = new Error('Lead không tồn tại.');
            (err as any).statusCode = 404;
            throw err;
        }

        if (lead.status === LeadStatus.enrolled) {
            const err = new Error('Lead đã được chuyển thành học viên.');
            (err as any).statusCode = 400;
            throw err;
        }

        if (lead.student) {
            const err = new Error('Dữ liệu bất đồng bộ: Lead này đã có bản ghi Student liên kết.');
            (err as any).statusCode = 409;
            throw err;
        }

        if (lead.status === LeadStatus.lost) {
            throw Object.assign(new Error('Lead đã thất bại. Hãy mở lại Lead trước khi chuyển thành học viên.'), { statusCode: 400 });
        }

        await this.assertAssignedSale(lead.assigned_to);

        const resolvedEmail = input.email?.trim() || lead.email?.trim();
        if (!resolvedEmail) {
            const err = new Error('Vui lòng bổ sung email trước khi chuyển thành học viên.');
            (err as any).statusCode = 400;
            throw err;
        }

        // Persist only the bcrypt hash; the random password is never returned.
        const rawTempPassword = crypto.randomBytes(16).toString('hex');
        const password_hash = await bcrypt.hash(rawTempPassword, 12);

        const newStudent = await leadRepository.convertLeadToStudent({
            lead_id: leadId,
            assigned_to: lead.assigned_to!,
            status: lead.status,
            full_name: lead.full_name,
            phone: lead.phone,
            email: resolvedEmail,
            password_hash,
            course_id: lead.course_id,
            class_id: classId.data,
            user_id: input.user_id,
        });

        return newStudent;
    }
}

export const leadService = new LeadService();

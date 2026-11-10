import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma, LeadStatus, LeadActivityType } from '../generated/prisma';
import { leadScoringService } from './ai/leadScoring.service';
import { leadRepository } from '../repositories/lead.repository';
import { leadScoringRepository } from './ai/leadScoring.repository';
import { LEAD_SOURCES, isLeadSource, validateLeadSource } from '../constants/leadSources';
export interface GetLeadsQuery {
    page?: number;
    limit?: number;
    status?: LeadStatus;
    source?: string;
    assigned_to?: number;
    course_id?: number;
    needs_care?: boolean;
    date_from?: string; // Định dạng ISO Date
    date_to?: string;   // Định dạng ISO Date
    search?: string;
    sort_by?: 'createdAt' | 'probability_score';
    sort_dir?: 'asc' | 'desc';
}

export interface CreateLeadInput {
    full_name: string;
    phone?: string;
    email?: string;
    source?: string;
    occupation?: string;
    study_purpose?: string;
    course_id?: number;
}

export interface UpdateLeadInput {
    status?: LeadStatus;
    assigned_to?: number;
    notes?: string;
    occupation?: string;
    study_purpose?: string;
    source?: string;
    course_id?: number;
    lost_reason?: string;
}

export interface GetFunnelQuery {
    assigned_to?: number;
    source?: string;
    course_id?: number;
    date_from?: string;
    date_to?: string;
    status?: LeadStatus;
    search?: string;
    needs_care?: boolean;
}

export interface CreateLeadActivityInput {
    type: LeadActivityType;
    content?: string;
    engagement_status?: string;
    user_id?: number;
}

export interface ConvertLeadInput {
    email?: string;
}

export class LeadService {
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

        if (assigned_to) {
            where.assigned_to = assigned_to;
        }
        if (course_id) where.course_id = course_id;
        if (needs_care) {
            where.AND = [
                { status: { in: ['new', 'contacted', 'interested', 'trial'] } },
                { OR: [{ last_contacted: null }, { last_contacted: { lt: new Date(Date.now() - 3 * 86_400_000) } }] },
            ];
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

        return (await leadScoringRepository.decorateLeads([lead]))[0];
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
            data: activities,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async createLeadActivity(leadId: number, data: CreateLeadActivityInput) {
        const lead = await leadRepository.findLeadForConvert(leadId);
        if (!lead) return null;

        const activity = await leadRepository.createActivity({
            lead_id: leadId,
            type: data.type,
            content: data.content,
            engagement_status: data.engagement_status,
            user_id: data.user_id,
        });

        const isRealInteraction = ['call', 'email', 'sms', 'meeting'].includes(data.type);
        const isStillNew = lead.status === LeadStatus.new;

        if (isRealInteraction) {
            // Update contact state before capturing the AI snapshot.
            await leadRepository.update(leadId, {
                ...(isStillNew ? { status: LeadStatus.contacted } : {}), last_contacted: activity.createdAt,
            });
        }

        if (isRealInteraction) leadScoringService.scoreLead(leadId).catch(err => {
            console.error(`[AI Trigger Error] Lỗi khi re-score Lead sau Activity (Lead ID: ${leadId}):`, err.message);
        });

        return activity;

    }

    async createLead(data: CreateLeadInput) {
        if (data.source !== undefined) validateLeadSource(data.source);
        const lead = await leadRepository.create({
            full_name: data.full_name,
            phone: data.phone,
            email: data.email,
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
        if (data.source !== undefined) validateLeadSource(data.source, lead.lead_source);

        const oldStatus = lead.status;
        const isStatusChanged = Boolean(data.status && data.status !== oldStatus);

        let notesToSave = data.notes !== undefined ? data.notes : lead.notes;
        if (data.lost_reason) {
            const reasonPrefix = `[Lý do mất lead: ${data.lost_reason}]`;
            notesToSave = notesToSave ? `${reasonPrefix} ${notesToSave}` : reasonPrefix;
        }

        const updatedLead = await leadRepository.update(id, {
            status: data.status,
            assigned_to: data.assigned_to,
            notes: notesToSave,
            occupation: data.occupation,
            study_purpose: data.study_purpose,
            lead_source: data.source,
            course_id: data.course_id,
        });

        if (isStatusChanged) {
            const statusLabelsMap: Record<string, string> = {
                new: 'Mới',
                contacted: 'Đã liên hệ',
                interested: 'Quan tâm',
                trial: 'Học thử',
                enrolled: 'Đã đăng ký',
                lost: 'Thất bại (Lost)'
            };
            const oldLabel = statusLabelsMap[oldStatus] || oldStatus;
            const newLabel = statusLabelsMap[data.status!] || data.status!;
            let activityContent = `Chuyển giai đoạn phễu: "${oldLabel}" ➔ "${newLabel}"`;
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
        const { assigned_to, source, course_id, date_from, date_to, status, search, needs_care } = query;
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const rows = await leadRepository.getFunnelAggregates({
            assigned_to,
            source,
            course_id,
            status, search, needs_care,
            date_from: date_from ? new Date(date_from) : undefined,
            date_to: date_to ? new Date(date_to) : undefined,
            staleBefore: threeDaysAgo,
        });

        const ACTIVE = ['new', 'contacted', 'interested', 'trial'];
        const sumBy = (statuses: string[] | null, f: (r: typeof rows[number]) => number) =>
            rows.filter(r => !statuses || statuses.includes(r.status)).reduce((acc, r) => acc + f(r), 0);
        const countOf = (statuses: string[] | null) => sumBy(statuses, r => r.count);

        const STAGES: { key: LeadStatus; label: string; description: string; color: string }[] = [
            { key: 'new', label: 'Mới tiếp nhận', description: 'Lead mới từ marketing / website', color: '#1677ff' },
            { key: 'contacted', label: 'Đã liên hệ', description: 'Sale đã tương tác cuộc gọi / tin nhắn đầu tiên', color: '#13c2c2' },
            { key: 'interested', label: 'Quan tâm', description: 'Khách hàng có nhu cầu học rõ ràng', color: '#faad14' },
            { key: 'trial', label: 'Học thử', description: 'Đang xếp lịch hoặc đang tham gia học thử', color: '#722ed1' },
            { key: 'enrolled', label: 'Đã đăng ký (Won)', description: 'Chốt thành công, nhập học', color: '#52c41a' },
            { key: 'lost', label: 'Thất bại (Lost)', description: 'Khách hàng từ chối hoặc mất liên lạc', color: '#f5222d' }
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
        const lead = await leadRepository.findLeadForConvert(leadId);

        if (!lead) {
            const err = new Error('Lead không tồn tại.');
            (err as any).statusCode = 404;
            throw err;
        }

        if (lead.status === LeadStatus.enrolled) {
            const err = new Error('Lead này đã được chuyển đổi thành Học viên trước đó rồi.');
            (err as any).statusCode = 400;
            throw err;
        }

        if (lead.student) {
            const err = new Error('Dữ liệu bất đồng bộ: Lead này đã có bản ghi Student liên kết.');
            (err as any).statusCode = 409;
            throw err;
        }

        const resolvedEmail = input.email?.trim() || lead.email?.trim();
        if (!resolvedEmail) {
            const err = new Error('Validation Error: Lead này chưa có email. Vui lòng truyền email trong body request.');
            (err as any).statusCode = 400;
            throw err;
        }

        // Persist only the bcrypt hash; the random password is never returned.
        const rawTempPassword = crypto.randomBytes(16).toString('hex');
        const password_hash = await bcrypt.hash(rawTempPassword, 12);

        const newStudent = await leadRepository.convertLeadToStudent({
            lead_id: leadId,
            full_name: lead.full_name,
            phone: lead.phone,
            email: resolvedEmail,
            password_hash,
            course_id: lead.course_id,
            course: lead.course,
        });

        return newStudent;
    }
}

export const leadService = new LeadService();

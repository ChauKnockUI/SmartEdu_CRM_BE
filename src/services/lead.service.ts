import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma, LeadStatus, LeadActivityType } from '../generated/prisma';
import { leadScoringService } from './ai/leadScoring.service';
import { leadRepository } from '../repositories/lead.repository';
export interface GetLeadsQuery {
    page?: number;
    limit?: number;
    status?: LeadStatus;
    source?: string;
    assigned_to?: number;
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
}

export interface CreateLeadActivityInput {
    type: LeadActivityType;
    content?: string;
    engagement_status?: string;
    user_id?: number;
}

export interface ConvertLeadInput {
    // Email có thể được truyền từ body hoặc đấy từ bản ghi Lead hiện tại
    email?: string;
}

export class LeadService {
    /**
     * Lấy danh sách Leads có phân trang, lọc, tìm kiếm và sắp xếp.
     */
    async getLeads(query: GetLeadsQuery) {
        const {
            page = 1,
            limit = 10,
            status,
            source,
            assigned_to,
            date_from,
            date_to,
            search,
            sort_by = 'createdAt',
            sort_dir = 'desc'
        } = query;

        const skip = (page - 1) * limit;

        // 1. Build Query Where Conditions
        const where: Prisma.LeadWhereInput = {};

        if (status) {
            where.status = status;
        }

        if (source) {
            // Note: Api gọi là "source" nhưng field DB tương ứng là "lead_source"
            where.lead_source = source;
        }

        if (assigned_to) {
            where.assigned_to = assigned_to;
        }

        // Lọc khoảng thời gian (Date filters)
        if (date_from || date_to) {
            where.createdAt = {};
            if (date_from) where.createdAt.gte = new Date(date_from);
            if (date_to) where.createdAt.lte = new Date(date_to);
        }

        // Search: Full-text trên FullName, Phone, Email (Case Insensitive)
        if (search) {
            where.OR = [
                { full_name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ];
        }

        // 2. Xây dựng Sắp xếp (Order By)
        let orderBy: any;

        if (sort_by === 'probability_score') {
            // Safe sort: Mặc định fallback thêm createdAt phòng khi aiScore null/gặp lỗi version Prisma
            orderBy = [
                { aiScore: { probability_score: sort_dir } },
                { createdAt: 'desc' }
            ];
        } else {
            // Sắp xếp default theo thời gian tạo
            orderBy = { createdAt: sort_dir };
        }

        // 3. Thực thi Query song song để đạt tốc độ tải Database cao
        // Promise.all giúp truy vấn count() và findMany() mượt mà cùng lúc.
        const [total, data] = await Promise.all([
            leadRepository.count(where),
            leadRepository.findMany(where, skip, limit, orderBy)
        ]);

        // 4. Normalize Data: Xử lý fallback cho Frontend nếu Lead chưa được chấm điểm AI
        const normalizedData = data.map(lead => ({
            ...lead,
            aiScore: lead.aiScore || {
                probability_score: 0,
                recommendation: "COLD_LEAD",
                positive_factors: [],
                negative_factors: []
            }
        }));

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

    /**
     * Lấy thông tin chi tiết đầy đủ của một Lead theo ID
     */
    async getLeadById(id: number) {
        const lead = await leadRepository.findById(id);

        if (!lead) return null;

        // Trả format phẳng đồng nhất với API Get Details để Component FrontEnd được Optimize tái sử dụng logic UI cho cả List & Item.
        return {
            ...lead,
            aiScore: lead.aiScore || null
        };
    }

    /**
     * Lấy lịch sử tương tác của Lead, sắp xếp theo createdAt giảm dần
     */
    async getLeadActivities(leadId: number, query: { page?: number; limit?: number }) {
        // Kiểm tra Lead tồn tại
        const lead = await leadRepository.checkExistence(leadId);
        if (!lead) return null;

        const page = query.page && query.page > 0 ? query.page : 1;
        const limit = query.limit && query.limit > 0 ? query.limit : 10;
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

    /**
     * Tạo Activity cho Lead + Fire-and-forget AI Scoring + Cập nhật last_contacted
     * [Automation HubSpot-style]: Nếu Lead vẫn còn status "new" và Activity là
     * một tương tác thực sự (call/email/sms/meeting) → tự động đẩy status → "contacted"
     * Type "note" KHÔNG kích hoạt automation (ghi chú nội bộ, không phải liên lạc thật)
     */
    async createLeadActivity(leadId: number, data: CreateLeadActivityInput) {
        // Lấy thông tin đầy đủ Lead (cần status để quyết định automation)
        const lead = await leadRepository.findLeadForConvert(leadId);
        if (!lead) return null;

        // Insert Activity vào Database
        const activity = await leadRepository.createActivity({
            lead_id: leadId,
            type: data.type,
            content: data.content,
            engagement_status: data.engagement_status,
            user_id: data.user_id,
        });

        // ===== AUTOMATION: Tự động cập nhật status =====
        // Chỉ kích hoạt khi:
        //   1. Activity là tương tác với khách (KHÔNG phải "note" nội bộ)
        //   2. Lead vẫn đang ở status "new" (chưa Sale nào xử lý thủ công)
        const isRealInteraction = data.type !== 'note';
        const isStillNew = lead.status === LeadStatus.new;

        if (isRealInteraction && isStillNew) {
            leadRepository.update(leadId, { status: LeadStatus.contacted }).catch(err => {
                console.error(`[LeadService] Lỗi khi auto-update status → contacted (Lead ID: ${leadId}):`, err.message);
            });
            console.log(`[LeadService] 🤖 Auto-status: Lead ID ${leadId}: new → contacted (trigger: ${data.type})`);
        }

        // Cập nhật mốc thời gian liên hệ cuối cùng trên bảng Lead
        leadRepository.updateLastContacted(leadId).catch(err => {
            console.error(`[LeadService] Lỗi khi cập nhật last_contacted cho Lead (ID: ${leadId}):`, err.message);
        });

        // ===== CỐT LÕI: Fire-and-forget AI Scoring =====
        // Trigger XGBoost AI cập nhật lại điểm số sau mỗi tương tác mới
        leadScoringService.scoreLead(leadId).catch(err => {
            console.error(`[AI Trigger Error] Lỗi khi re-score Lead sau Activity (Lead ID: ${leadId}):`, err.message);
        });

        return activity;

    }

    /**
     * Tạo một Lead mới và trigger AI Scoring
     */
    async createLead(data: CreateLeadInput) {
        const lead = await leadRepository.create({
            full_name: data.full_name,
            phone: data.phone,
            email: data.email,
            lead_source: data.source,
            occupation: data.occupation,
            study_purpose: data.study_purpose,
            course_id: data.course_id,
        });

        // Trigger AI Điểm Tự Động (Fire and forget - không dùng await chặn request)
        leadScoringService.scoreLead(lead.id).catch(err => {
            console.error(`[AI Trigger Error] Lỗi khi tự động chấm điểm Lead (ID: ${lead.id}):`, err.message);
        });

        return lead;
    }

    /**
     * Cập nhật thông tin Lead (Không thay đổi createdAt), Trigger AI nếu cần
     * Tự động ghi lại Activity khi chuyển giai đoạn (Pipeline Stage Change)
     */
    async updateLead(id: number, data: UpdateLeadInput, userId?: number) {
        const lead = await leadRepository.findById(id);
        if (!lead) return null;

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

        // Tự động ghi nhận Activity lịch sử khi chuyển trạng thái / giai đoạn phễu
        if (isStatusChanged) {
            const statusLabelsMap: Record<string, string> = {
                new: 'Mới',
                contacted: 'Đã liên hệ',
                interested: 'Quan tâm',
                trial: 'Học thử',
                enrolled: 'Đã đăng ký (Won)',
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

        // Chỉ trigger AI khi Sale thay đổi các thông số lõi (Core Features) làm ảnh hưởng trọng số AI
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

    /**
     * Báo cáo Phễu bán hàng (Sales Funnel & Pipeline Analytics)
     */
    async getLeadFunnel(query: GetFunnelQuery) {
        const { assigned_to, source, course_id, date_from, date_to } = query;
        const where: Prisma.LeadWhereInput = {};

        if (assigned_to) where.assigned_to = assigned_to;
        if (source) where.lead_source = source;
        if (course_id) where.course_id = course_id;
        if (date_from || date_to) {
            where.createdAt = {};
            if (date_from) where.createdAt.gte = new Date(date_from);
            if (date_to) where.createdAt.lte = new Date(date_to);
        }

        const rawLeads = await leadRepository.getFunnelData(where);
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const STAGES: { key: LeadStatus; label: string; description: string; color: string }[] = [
            { key: 'new', label: 'Mới tiếp nhận', description: 'Lead mới từ marketing / website', color: '#1677ff' },
            { key: 'contacted', label: 'Đã liên hệ', description: 'Sale đã tương tác cuộc gọi / tin nhắn đầu tiên', color: '#13c2c2' },
            { key: 'interested', label: 'Quan tâm', description: 'Khách hàng có nhu cầu học rõ ràng', color: '#faad14' },
            { key: 'trial', label: 'Học thử', description: 'Đang xếp lịch hoặc đang tham gia học thử', color: '#722ed1' },
            { key: 'enrolled', label: 'Đã đăng ký (Won)', description: 'Chốt thành công, nhập học', color: '#52c41a' },
            { key: 'lost', label: 'Thất bại (Lost)', description: 'Khách hàng từ chối hoặc mất liên lạc', color: '#f5222d' }
        ];

        // Khởi tạo nhóm thống kê theo từng tầng phễu
        const stageStats = STAGES.map(s => {
            const leadsInStage = rawLeads.filter(l => l.status === s.key);
            const count = leadsInStage.length;
            const totalValue = leadsInStage.reduce((sum, l) => sum + (l.course?.fee ? Number(l.course.fee) : 0), 0);
            const weightedValue = leadsInStage.reduce((sum, l) => {
                const fee = l.course?.fee ? Number(l.course.fee) : 0;
                const rawScore = l.aiScore?.probability_score ? Number(l.aiScore.probability_score) : 0;
                const probability = rawScore > 1 ? rawScore / 100 : rawScore;
                return sum + fee * probability;
            }, 0);
            const totalScore = leadsInStage.reduce((sum, l) => {
                const rawScore = l.aiScore?.probability_score ? Number(l.aiScore.probability_score) : 0;
                const scorePercent = rawScore <= 1 ? rawScore * 100 : rawScore;
                return sum + scorePercent;
            }, 0);
            const avgScore = count > 0 ? Math.round(totalScore / count) : 0;
            const staleCount = leadsInStage.filter(l => {
                if (['new', 'contacted', 'interested', 'trial'].includes(l.status)) {
                    return !l.last_contacted || new Date(l.last_contacted) < threeDaysAgo;
                }
                return false;
            }).length;

            return {
                stage: s.key,
                label: s.label,
                description: s.description,
                color: s.color,
                count,
                percentage: rawLeads.length > 0 ? Number(((count / rawLeads.length) * 100).toFixed(1)) : 0,
                totalValue,
                weightedValue: Math.round(weightedValue),
                avgScore,
                staleCount
            };
        });

        const totalLeads = rawLeads.length;
        const activeLeads = rawLeads.filter(l => ['new', 'contacted', 'interested', 'trial'].includes(l.status));
        const activePipelineValue = activeLeads.reduce((sum, l) => sum + (l.course?.fee ? Number(l.course.fee) : 0), 0);
        const weightedPipelineValue = activeLeads.reduce((sum, l) => {
            const fee = l.course?.fee ? Number(l.course.fee) : 0;
            const rawScore = l.aiScore?.probability_score ? Number(l.aiScore.probability_score) : 0;
            const probability = rawScore > 1 ? rawScore / 100 : rawScore;
            return sum + fee * probability;
        }, 0);

        const enrolledLeads = rawLeads.filter(l => l.status === 'enrolled');
        const lostLeads = rawLeads.filter(l => l.status === 'lost');
        const closedCount = enrolledLeads.length + lostLeads.length;
        const winRate = closedCount > 0
            ? Number(((enrolledLeads.length / closedCount) * 100).toFixed(1))
            : (totalLeads > 0 ? Number(((enrolledLeads.length / totalLeads) * 100).toFixed(1)) : 0);

        // Chuỗi dịch chuyển phễu từ trên xuống dưới (Step-by-Step Conversion Progression)
        const progressedContacted = rawLeads.filter(l => ['contacted', 'interested', 'trial', 'enrolled'].includes(l.status)).length;
        const progressedInterested = rawLeads.filter(l => ['interested', 'trial', 'enrolled'].includes(l.status)).length;
        const progressedTrial = rawLeads.filter(l => ['trial', 'enrolled'].includes(l.status)).length;
        const progressedEnrolled = enrolledLeads.length;

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

        // Phân tích hiệu quả theo nguồn Lead (Lead Source ROI)
        const sourceMap = new Map<string, { total: number; enrolled: number; value: number }>();
        rawLeads.forEach(l => {
            const src = l.lead_source || 'other';
            const curr = sourceMap.get(src) || { total: 0, enrolled: 0, value: 0 };
            curr.total += 1;
            if (l.status === 'enrolled') {
                curr.enrolled += 1;
                curr.value += (l.course?.fee ? Number(l.course.fee) : 0);
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
                activePipelineCount: activeLeads.length,
                activePipelineValue,
                weightedPipelineValue: Math.round(weightedPipelineValue),
                enrolledCount: enrolledLeads.length,
                enrolledValue: enrolledLeads.reduce((sum, l) => sum + (l.course?.fee ? Number(l.course.fee) : 0), 0),
                lostCount: lostLeads.length,
                winRate,
                staleLeadsCount: rawLeads.filter(l => ['new', 'contacted', 'interested', 'trial'].includes(l.status) && (!l.last_contacted || new Date(l.last_contacted) < threeDaysAgo)).length
            },
            stages: stageStats,
            progressionFunnel,
            sourcePerformance
        };
    }

    /**
     * Xóa Lead
     * @param id
     * Prisma sẽ tự động cascade xóa bảng `LeadActivity` và `LeadAiScore`
     */
    async deleteLead(id: number): Promise<boolean> {
        // Kiểm tra tồn tại
        const existingLead = await leadRepository.checkExistence(id);

        if (!existingLead) {
            return false;
        }

        // Xóa cứng
        await leadRepository.delete(id);

        return true;
    }

    /**
     * Convert Lead → Student:
     * - Validate email bắt buộc nếu Lead chưa có
     * - Kiểm tra Lead chưa ở trạng thái enrolled
     * - Kiểm tra Lead chưa có Student record
     * - Sinh password_hash rác (an toàn hơn plain text)
     * - Ủy quyền transaction cho Repository
     */
    async convertLeadToStudent(leadId: number, input: ConvertLeadInput) {
        // 1. Lấy thông tin Lead (đặc biệt có email, status, student)
        const lead = await leadRepository.findLeadForConvert(leadId);

        if (!lead) {
            // Nhém lỗi có mã riêng để Controller phân biệt 404 vs 400
            const err = new Error('Lead không tồn tại.');
            (err as any).statusCode = 404;
            throw err;
        }

        // 2. Kiểm tra Lead đã enrolled chưa
        if (lead.status === LeadStatus.enrolled) {
            const err = new Error('Lead này đã được chuyển đổi thành Học viên trước đó rồi.');
            (err as any).statusCode = 400;
            throw err;
        }

        // 3. Kiểm tra Lead đã có bản ghi Student chưa (data integrity guard)
        if (lead.student) {
            const err = new Error('Dữ liệu bất đồng bộ: Lead này đã có bản ghi Student liên kết.');
            (err as any).statusCode = 409;
            throw err;
        }

        // 4. Xác định email sẽ dùng (body ưu tiên hơn Lead record)
        const resolvedEmail = input.email?.trim() || lead.email?.trim();
        if (!resolvedEmail) {
            const err = new Error('Validation Error: Lead này chưa có email. Vui lòng truyền email trong body request.');
            (err as any).statusCode = 400;
            throw err;
        }

        // 5. Sinh password_hash ngẫu nhiên (rác) — vị sau sẽ thay bằng bcrypt hash thật
        // Nhưng KHAI BÁO RÕ trong code để không trở thành security debt im lặng
        const rawTempPassword = crypto.randomBytes(16).toString('hex');
        const password_hash = await bcrypt.hash(rawTempPassword, 12);

        // 6. Gần toàn bộ transaction cho Repository (Single Responsibility)
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

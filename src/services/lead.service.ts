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
     */
    async updateLead(id: number, data: UpdateLeadInput) {
        const lead = await leadRepository.checkExistence(id);
        if (!lead) return null;

        const updatedLead = await leadRepository.update(id, {
            status: data.status,
            assigned_to: data.assigned_to,
            notes: data.notes,
            occupation: data.occupation,
            study_purpose: data.study_purpose,
            lead_source: data.source,
            course_id: data.course_id,
        });

        // Chỉ trigger AI khi Sale thay đổi các thông số lõi (Core Features) làm ảnh hưởng trọng số AI
        // Giảm tải áp lực thừa thãi lên Microservice Python
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

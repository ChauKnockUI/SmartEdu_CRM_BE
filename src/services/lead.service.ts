import { PrismaClient, Prisma, LeadStatus } from '../generated/prisma';

const prisma = new PrismaClient();

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
            prisma.lead.count({ where }),
            prisma.lead.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                include: {
                    // Cắt các trường nhạy cảm của người dùng (như password hash)
                    assignedUser: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                            avatar_url: true,
                            role: true,
                        }
                    },
                    // Fetch Data AI 1-1
                    aiScore: true
                }
            })
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
        const lead = await prisma.lead.findUnique({
            where: { id },
            include: {
                // Join thông tin User được gán (Security: Cắt password)
                assignedUser: {
                    select: {
                        id: true,
                        full_name: true,
                        email: true,
                        avatar_url: true,
                        role: true
                    }
                },
                // Join Khóa học
                course: true,
                // Lấy 20 activities gần nhất để tránh phình to JSON
                activities: {
                    orderBy: { createdAt: 'desc' },
                    take: 20
                },
                // Join điểm AI
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

        if (!lead) return null;

        // Trả format phẳng đồng nhất với API Get Details để Component FrontEnd được Optimize tái sử dụng logic UI cho cả List & Item.
        return {
            ...lead,
            aiScore: lead.aiScore || null
        };
    }
}

export const leadService = new LeadService();

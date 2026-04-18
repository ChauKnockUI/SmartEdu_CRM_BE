import { Request, Response } from 'express';
import { leadService } from '../services/lead.service';
import { leadScoringService } from '../services/ai/leadScoring.service';
import { LeadStatus, LeadActivityType } from '../generated/prisma';

export class LeadController {
    /**
     * Lấy danh sách Leads | GET /api/leads
     */
    async getLeads(req: Request, res: Response) {
        try {
            // Lấy parameters từ query string
            const {
                page,
                limit,
                status,
                source,
                assigned_to,
                date_from,
                date_to,
                search,
                sort_by,
                sort_dir
            } = req.query;

            // Typecasting & Calling Service
            const result = await leadService.getLeads({
                page: page ? parseInt(page as string, 10) : 1,
                limit: limit ? parseInt(limit as string, 10) : 10,
                status: status as LeadStatus,
                source: source as string,
                assigned_to: assigned_to ? parseInt(assigned_to as string, 10) : undefined,
                date_from: date_from as string,
                date_to: date_to as string,
                search: search as string,
                sort_by: sort_by === 'probability_score' ? 'probability_score' : 'createdAt',
                sort_dir: sort_dir === 'asc' ? 'asc' : 'desc'
            });

            // Format API Output đúng chuẩn RESTful cho Extensible FE
            return res.status(200).json({
                success: true,
                data: result.data,
                pagination: result.pagination
            });
            
        } catch (error: any) {
            console.error('[LeadController] getLeads error:', error);
            
            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi lấy danh sách Leads',
                error: error.message
            });
        }
    }

    /**
     * Lấy chi tiết 1 Lead | GET /api/leads/:id
     */
    async getLeadById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Validate ID hợp lệ
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const result = await leadService.getLeadById(Number(id));

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy thông tin Lead (Not found)'
                });
            }

            return res.status(200).json({
                success: true,
                data: result // Đồng nhất chuẩn JSON response với GET /api/leads
            });
            
        } catch (error: any) {
            console.error('[LeadController] getLeadById error:', error);

            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi lấy dữ liệu chi tiết Lead',
                error: error.message
            });
        }
    }

    /**
     * Lấy danh sách lịch sử tương tác của 1 Lead | GET /api/leads/:id/activities
     */
    async getLeadActivities(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { page, limit } = req.query;

            // Validate ID hợp lệ
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const result = await leadService.getLeadActivities(Number(id), {
                page: page ? parseInt(page as string, 10) : 1,
                limit: limit ? parseInt(limit as string, 10) : 10
            });

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy thông tin Lead (Not found)'
                });
            }

            return res.status(200).json({
                success: true,
                data: result.data,
                pagination: result.pagination
            });
            
        } catch (error: any) {
            console.error('[LeadController] getLeadActivities error:', error);

            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi lấy dữ liệu lịch sử tương tác',
                error: error.message
            });
        }
    }

    /**
     * Tạo mới Activity cho Lead | POST /api/leads/:id/activities
     * Body: { type, content, engagement_status }
     * Sau khi insert → Fire-and-forget AI Scoring
     */
    async createLeadActivity(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { type, content, engagement_status } = req.body;

            // Validate Lead ID
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            // Validate type bắt buộc & thuộc enum cho phép
            const allowedTypes: LeadActivityType[] = ['call', 'email', 'sms', 'meeting', 'note', 'status_change'];
            if (!type || !allowedTypes.includes(type as LeadActivityType)) {
                return res.status(400).json({
                    success: false,
                    message: `Validation Error: Trường 'type' là bắt buộc và phải thuộc [${allowedTypes.join(', ')}]`
                });
            }

            // Lấy user_id từ header giả lập (tương tự deleteLead) — sẽ thay bằng Auth Middleware sau
            const userId = req.header('x-user-id');

            const activity = await leadService.createLeadActivity(Number(id), {
                type: type as LeadActivityType,
                content,
                engagement_status,
                user_id: userId ? parseInt(userId, 10) : undefined,
            });

            if (!activity) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Lead để ghi nhận Activity (Not found)'
                });
            }

            return res.status(201).json({
                success: true,
                message: 'Đã ghi nhận Activity thành công. AI đang cập nhật lại điểm số...',
                data: activity
            });

        } catch (error: any) {
            console.error('[LeadController] createLeadActivity error:', error);

            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi tạo Activity cho Lead',
                error: error.message
            });
        }
    }

    /**
     * Tạo Lead mới | POST /api/leads
     */
    async createLead(req: Request, res: Response) {
        try {
            const { full_name, phone, email, source, occupation, study_purpose } = req.body;

            // Basic Validation
            if (!full_name || typeof full_name !== 'string' || full_name.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Validaton Error: Trường full_name là bắt buộc.'
                });
            }

            const newLead = await leadService.createLead({
                full_name: full_name.trim(),
                phone,
                email,
                source,
                occupation,
                study_purpose
            });

            // Status 201: Created
            return res.status(201).json({
                success: true,
                data: newLead
            });
        } catch (error: any) {
            console.error('[LeadController] createLead error:', error);
            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi tạo Lead mới',
                error: error.message
            });
        }
    }

    /**
     * Cập nhật Lead | PUT /api/leads/:id
     */
    async updateLead(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Validate ID
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            // Chỉ destructure những field được phép update theo y/c
            const { status, assigned_to, notes, occupation, study_purpose, source, course_id } = req.body;

            const updatedLead = await leadService.updateLead(Number(id), {
                status,
                assigned_to,
                notes,
                occupation,
                study_purpose,
                source,
                course_id
            });

            if (!updatedLead) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy thông tin Lead để cập nhật (Not found)'
                });
            }

            return res.status(200).json({
                success: true,
                data: updatedLead
            });
        } catch (error: any) {
            console.error('[LeadController] updateLead error:', error);
            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi cập nhật dữ liệu Lead',
                error: error.message
            });
        }
    }

    /**
     * Xóa Lead | DELETE /api/leads/:id
     * - Chỉ Admin / Sale mới được xóa.
     * - Tự động xóa chùm (Cascade) Activity và điểm AI.
     */
    async deleteLead(req: Request, res: Response) {
        try {
            const { id } = req.params;
            
            // Simulating Role extraction from HTTP Header (vì chưa có Middleware Auth đầy đủ)
            // Header VD trong Postman/Apidog: 'x-role': 'admin' hoặc 'sale'
            const userRole = req.header('x-role');
            
            if (!userRole || !['admin', 'sale'].includes(userRole.toLowerCase())) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Bạn phải là (admin/sale) mới có quyền xóa Lead này.'
                });
            }

            // Validate ID
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const isDeleted = await leadService.deleteLead(Number(id));

            if (!isDeleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Leader không tồn tại hoặc đã bị xóa.'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Đã xóa thành công Lead ID ${id} (và toàn bộ Activity & AI Score liên đới).`
            });
        } catch (error: any) {
            console.error('[LeadController] deleteLead error:', error);
            
            // Fallback Foreign Key Exception: Nếu Lead đã join vào bảng Học Viên (Student)
            // thì Prisma sẽ quăng lỗi chặn xoá do vi phạm khóa ngoại.
            if (error.code === 'P2003') {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể xóa Lead này: Khách hàng đã được chuyển đổi thành Học viên (Student).'
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi thực hiện xóa Lead',
                error: error.message
            });
        }
    }

    /**
     * Trigger Chấm điểm AI Thủ Công | POST /api/leads/:id/score
     */
    async scoreLeadManually(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Validate ID
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            // Gọi hàm scoreLead (đã bao bọc Try/Catch cực kỳ kín kẽ bên trong)
            const result = await leadScoringService.scoreLead(Number(id));

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: result.error || 'Có lỗi xảy ra khi chấm điểm Lead.'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Đã cập nhật thang điểm AI thành công.',
                data: result.data // Chứa đối tượng LeadAiScore
            });
        } catch (error: any) {
            console.error('[LeadController] scoreLeadManually error:', error);
            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi trigger vòng lặp AI',
                error: error.message
            });
        }
    }

    /**
     * Convert Lead → Student | POST /api/leads/:id/convert
     * Body (optional): { email }
     * - Dùng prisma.$transaction() → đảm bảo atomic (tất cả thành công hoặc rollback hết)
     * - Trả về 201 kèm Student record vừa tạo
     */
    async convertLead(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { email } = req.body;

            // Validate Lead ID
            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            // Validate format email nếu được truyền vào
            if (email !== undefined && email !== null) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (typeof email !== 'string' || !emailRegex.test(email.trim())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Validation Error: Email không đúng định dạng.'
                    });
                }
            }

            const newStudent = await leadService.convertLeadToStudent(Number(id), { email });

            return res.status(201).json({
                success: true,
                message: `Chuyển đổi thành công! Lead ID ${id} đã trở thành Học viên.`,
                data: newStudent
            });

        } catch (error: any) {
            console.error('[LeadController] convertLead error:', error);

            // Bắt lỗi có statusCode tuỳ chỉnh từ Service (400 / 404 / 409)
            if (error.statusCode) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }

            // Bắt Prisma Unique Constraint (P2002): Email đã tồn tại trong bảng users
            if (error.code === 'P2002') {
                return res.status(409).json({
                    success: false,
                    message: 'Conflict: Email này đã được đăng ký bởi một tài khoản khác trong hệ thống.'
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Lỗi Internal Server khi thực hiện Convert Lead',
                error: error.message
            });
        }
    }
}

export const leadController = new LeadController();

import { Request, Response } from 'express';
import { leadService } from '../services/lead.service';
import { leadScoringService } from '../services/ai/leadScoring.service';
import { leadScoringRepository } from '../services/ai/leadScoring.repository';
import { LeadStatus, LeadActivityType } from '../generated/prisma';
import { isLeadSource, LEAD_SOURCES } from '../constants/leadSources';
import { leadEmailService } from '../services/leadEmail.service';
import { LEAD_CARE_FILTERS, type LeadCareFilter } from '../constants/leadWorkflow';

export class LeadController {
    getEmailConfiguration(_req: Request, res: Response) {
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ success: true, data: leadEmailService.getConfiguration() });
    }

    async sendEmail(req: Request, res: Response) {
        try {
            const data = await leadService.sendLeadEmail(Number(req.params.id), req.body, req.user!);
            return res.json({ success: true, data, message: data.history_saved
                ? 'Dịch vụ đã tiếp nhận email. Chưa xác nhận người nhận đã nhận hoặc đọc.'
                : 'Dịch vụ đã tiếp nhận email nhưng chưa lưu được lịch sử. Vui lòng kiểm tra dịch vụ email trước khi gửi lại.' });
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({ success: false,
                message: error.statusCode ? error.message : 'Chưa xử lý được yêu cầu gửi email. Vui lòng thử lại cùng nội dung.' });
        }
    }

    async getLeadSources(req: Request, res: Response) {
        try {
            const data = await leadService.getLeadSources(req.user?.role === 'sale' ? req.user.userId : undefined);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, data });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: 'Không tải được danh mục nguồn lead.' });
        }
    }

    async exportScoringDataset(req: Request, res: Response) {
        try {
            const dataset = await leadScoringRepository.exportDataset();
            res.setHeader('Cache-Control', 'no-store');
            return res.attachment('lead-scoring-snapshots.json').json(dataset);
        } catch (error: any) {
            return res.status(error.statusCode || 500).json({ success: false, message: error.message });
        }
    }
    async getLeads(req: Request, res: Response) {
        try {
            const {
                page,
                limit,
                status,
                source,
                assigned_to,
                course_id,
                needs_care,
                care,
                date_from,
                date_to,
                search,
                sort_by,
                sort_dir
            } = req.query;

            if (care !== undefined && !LEAD_CARE_FILTERS.includes(care as LeadCareFilter)) {
                return res.status(400).json({ success: false, message: 'Nhóm chăm sóc không hợp lệ.' });
            }

            const isSale = req.user?.role === 'sale';
            const currentUserId = req.user?.userId;
            const result = await leadService.getLeads({
                page: page ? parseInt(page as string, 10) : 1,
                limit: limit ? parseInt(limit as string, 10) : 10,
                status: status as LeadStatus,
                source: source as string,
                course_id: course_id ? Number(course_id) : undefined,
                needs_care: needs_care === 'true',
                care: care as LeadCareFilter | undefined,
                assigned_to: isSale ? currentUserId : (assigned_to === 'unassigned' ? null : (assigned_to ? parseInt(assigned_to as string, 10) : undefined)),
                date_from: date_from as string,
                date_to: date_to as string,
                search: search as string,
                sort_by: sort_by === 'probability_score' ? 'probability_score' : 'createdAt',
                sort_dir: sort_dir === 'asc' ? 'asc' : 'desc'
            });

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

    async getLeadById(req: Request, res: Response) {
        try {
            const { id } = req.params;

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
            if (req.user?.role === 'sale' && result.assigned_to !== req.user.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không có quyền truy cập thông tin của khách hàng này'
                });
            }
            return res.status(200).json({
                success: true,
                data: result
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

    async getLeadActivities(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { page, limit } = req.query;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }
            const lead = await leadService.getLeadById(Number(id));
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy thông tin Lead (Not found)'
                });
            }
            if (req.user?.role === 'sale' && lead.assigned_to !== req.user.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không có quyền xem lịch sử tương tác của lead này'
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

    async createLeadActivity(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { type, content, engagement_status } = req.body;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const lead = await leadService.getLeadById(Number(id));
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Lead để ghi nhận Activity (Not found)'
                });
            }
            if (req.user?.role === 'sale' && lead.assigned_to !== req.user.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không thể ghi nhận tương tác cho lead của sale khác'
                });
            }

            const allowedTypes: LeadActivityType[] = ['call', 'email', 'sms', 'meeting', 'note', 'status_change'];
            if (!type || !allowedTypes.includes(type as LeadActivityType)) {
                return res.status(400).json({
                    success: false,
                    message: `Validation Error: Trường 'type' là bắt buộc và phải thuộc [${allowedTypes.join(', ')}]`
                });
            }

            const activity = await leadService.createLeadActivity(Number(id), {
                type: type as LeadActivityType,
                content,
                engagement_status,
                user_id: req.user?.userId,
            });

            return res.status(201).json({
                success: true,
                message: 'Đã ghi nhận kết quả chăm sóc.',
                data: activity
            });

        } catch (error: any) {
            console.error('[LeadController] createLeadActivity error:', error);

            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.statusCode ? error.message : 'Lỗi Internal Server khi tạo Activity cho Lead',
                error: error.message
            });
        }
    }

    async createLead(req: Request, res: Response) {
        try {
            const { full_name, phone, email, source, occupation, study_purpose, course_id } = req.body;
            const allowedOccupations = ['student_y1_y2', 'student_y3_y4', 'working_professional'];
            const allowedStudyPurposes = ['study_abroad', 'pass_exam', 'career_advancement'];

            if (!full_name || typeof full_name !== 'string' || full_name.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Validaton Error: Trường full_name là bắt buộc.'
                });
            }

            if (!phone || typeof phone !== 'string' || phone.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Validation Error: phone là bắt buộc.'
                });
            }
            if (!isLeadSource(source)) {
                return res.status(400).json({
                    success: false,
                    message: `Validation Error: source phải thuộc [${LEAD_SOURCES.map(item => item.value).join(', ')}].`
                });
            }
            if (!occupation || !allowedOccupations.includes(occupation)) {
                return res.status(400).json({
                    success: false,
                    message: `Validation Error: occupation phải thuộc [${allowedOccupations.join(', ')}].`
                });
            }
            if (!study_purpose || !allowedStudyPurposes.includes(study_purpose)) {
                return res.status(400).json({
                    success: false,
                    message: `Validation Error: study_purpose phải thuộc [${allowedStudyPurposes.join(', ')}].`
                });
            }
            if (!course_id || isNaN(Number(course_id))) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation Error: course_id là bắt buộc và phải là số.'
                });
            }

            const newLead = await leadService.createLead({
                full_name: full_name.trim(),
                phone: phone.trim(),
                email,
                source,
                occupation,
                study_purpose,
                course_id: course_id ? Number(course_id) : undefined
            });

            return res.status(201).json({
                success: true,
                data: newLead
            });
        } catch (error: any) {
            console.error('[LeadController] createLead error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: [400, 409].includes(error.statusCode) ? error.message : 'Lỗi Internal Server khi tạo Lead mới',
                duplicate_fields: error.duplicateFields,
                error: error.message
            });
        }
    }

    async updateLead(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const lead = await leadService.getLeadById(Number(id));
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy thông tin Lead để cập nhật (Not found)'
                });
            }

            const isSale = req.user?.role === 'sale';
            if (isSale && lead.assigned_to !== req.user?.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không có quyền chỉnh sửa lead của sale khác'
                });
            }

            const { full_name, phone, email, status, assigned_to, notes, occupation, study_purpose, source, course_id, lost_reason } = req.body;
            if (isSale && assigned_to !== undefined) {
                return res.status(403).json({ success: false, message: 'Chỉ admin được thay đổi người phụ trách lead.' });
            }

            const updatedLead = await leadService.updateLead(Number(id), {
                full_name,
                phone,
                email,
                status,
                // Sales users cannot reassign a lead.
                assigned_to: isSale ? undefined : assigned_to,
                notes,
                occupation,
                study_purpose,
                source,
                course_id,
                lost_reason
            }, req.user?.userId);

            return res.status(200).json({
                success: true,
                data: updatedLead
            });
        } catch (error: any) {
            console.error('[LeadController] updateLead error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: [400, 409].includes(error.statusCode) ? error.message : 'Lỗi Internal Server khi cập nhật dữ liệu Lead',
                error: error.message
            });
        }
    }

    async getLeadFunnel(req: Request, res: Response) {
        try {
            const { assigned_to, source, course_id, date_from, date_to, status, search, needs_care, care } = req.query;
            if (care !== undefined && !LEAD_CARE_FILTERS.includes(care as LeadCareFilter)) {
                return res.status(400).json({ success: false, message: 'Nhóm chăm sóc không hợp lệ.' });
            }
            const isSale = req.user?.role === 'sale';
            const funnel = await leadService.getLeadFunnel({
                assigned_to: isSale ? req.user?.userId : (assigned_to === 'unassigned' ? null : (assigned_to ? parseInt(assigned_to as string, 10) : undefined)),
                source: source as string,
                course_id: course_id ? parseInt(course_id as string, 10) : undefined,
                status: status as LeadStatus,
                search: search as string,
                needs_care: needs_care === 'true',
                care: care as LeadCareFilter | undefined,
                date_from: date_from as string,
                date_to: date_to as string,
            });

            return res.status(200).json({
                success: true,
                data: funnel
            });
        } catch (error: any) {
            console.error('[LeadController] getLeadFunnel error:', error);
            return res.status(500).json({
                success: false,
                message: 'Lỗi khi lấy báo cáo phễu bán hàng',
                error: error.message
            });
        }
    }

    async deleteLead(req: Request, res: Response) {
        try {
            const { id } = req.params;

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

    async scoreLeadManually(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const lead = await leadService.getLeadById(Number(id));
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy thông tin Lead (Not found)'
                });
            }
            if (req.user?.role === 'sale' && lead.assigned_to !== req.user.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không có quyền chấm điểm lead của sale khác'
                });
            }

            const result = await leadScoringService.scoreLead(Number(id));

            if (!result.success) {
                return res.status(result.statusCode || 500).json({
                    success: false,
                    message: result.error || 'Có lỗi xảy ra khi chấm điểm Lead.'
                });
            }

            return res.status(200).json({
                success: true,
                message: result.message,
                data: result.data,
                care: result.care,
                model_status: result.model_status,
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

    async convertLead(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { email, class_id } = req.body;

            if (!id || isNaN(Number(id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID của Lead không hợp lệ'
                });
            }

            const lead = await leadService.getLeadById(Number(id));
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy Lead để chuyển đổi (Not found)'
                });
            }
            if (req.user?.role === 'sale' && lead.assigned_to !== req.user.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không có quyền chuyển đổi lead của sale khác'
                });
            }

            if (email !== undefined && email !== null) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (typeof email !== 'string' || !emailRegex.test(email.trim())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Validation Error: Email không đúng định dạng.'
                    });
                }
            }

            const newStudent = await leadService.convertLeadToStudent(Number(id), { email, class_id, user_id: req.user!.userId, user_role: req.user!.role });

            return res.status(201).json({
                success: true,
                message: `Chuyển đổi thành công! Lead ID ${id} đã trở thành Học viên.`,
                data: newStudent
            });

        } catch (error: any) {
            console.error('[LeadController] convertLead error:', error);

            if (error.statusCode) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }

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

import { Request, Response } from 'express';
import { leadService } from '../services/lead.service';
import { LeadStatus } from '../generated/prisma';

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
}

export const leadController = new LeadController();

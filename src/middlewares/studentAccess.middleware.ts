import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/db';
import { studentReadScope } from '../utils/academicAccess';

export async function requireStudentRead(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({ success: false, message: 'ID học viên không hợp lệ.' });
    }
    try {
        const student = await prisma.student.findFirst({ where: { id, ...studentReadScope(req.user) }, select: { id: true } });
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học viên trong phạm vi được xem.' });
        next();
    } catch {
        return res.status(500).json({ success: false, message: 'Không kiểm tra được quyền xem học viên.' });
    }
}

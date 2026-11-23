import type { Request, RequestHandler } from 'express';
import { materialService } from '../services/material.service';

const fail = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const id = (value: unknown) => {
    if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) throw fail('Mã tham chiếu không hợp lệ.');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > 2147483647) throw fail('Mã tham chiếu không hợp lệ.');
    return number;
};
const optionalId = (value: unknown) => value === undefined ? undefined : value === null || value === '' ? null : id(value);
const actor = (req: Request) => ({ userId: req.user!.userId, role: req.user!.role });
const handle = (action: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<object>): RequestHandler => async (req, res) => {
    try { res.json({ success: true, ...await action(req, res) }); }
    catch (error: any) {
        if (!error.statusCode) console.error('[Material]', error);
        const conflict = error.code === 'P2003';
        res.status(error.statusCode || (conflict ? 409 : 500)).json({ success: false,
            message: error.statusCode ? error.message : conflict ? 'Lớp hoặc buổi học vừa thay đổi. Vui lòng tải lại.' : 'Không xử lý được tài liệu. Vui lòng thử lại.',
        });
    }
};

export const materialController = {
    getByClass: handle(req => materialService.getByClass(id(req.params.classId), actor(req).userId, actor(req).role)),
    getBySession: handle(req => materialService.getBySession(id(req.params.scheduleId), actor(req).userId, actor(req).role)),
    upload: handle(async req => {
        if (!req.file) throw fail('Vui lòng chọn file.');
        const data = await materialService.upload({ classId: id(req.params.classId), ...actor(req),
            scheduleId: optionalId(req.body.schedule_id), title: req.body.title, file: req.file });
        return { data, message: 'Đã tải tài liệu lên.' };
    }),
    update: handle(async req => ({ data: await materialService.update(id(req.params.id), actor(req).userId, actor(req).role, {
        title: req.body.title, scheduleId: optionalId(req.body.schedule_id), file: req.file,
    }), message: 'Đã cập nhật tài liệu.' })),
    remove: handle(async req => {
        await materialService.remove(id(req.params.id), actor(req).userId, actor(req).role);
        return { message: 'Đã xóa tài liệu.' };
    }),
    download: handle(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        return { data: await materialService.download(id(req.params.id), actor(req).userId, actor(req).role) };
    }),
};

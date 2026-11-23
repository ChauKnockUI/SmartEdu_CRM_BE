import { randomUUID } from 'crypto';
import { prisma } from '../database/db';
import { getSupabase, SUPABASE_STORAGE_BUCKET } from '../config/supabase';
import { currentTenantId } from '../database/tenant-context';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const DOWNLOAD_TTL = 300;
const ALLOWED_TYPES: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    'text/plain': ['txt'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'],
    'application/zip': ['zip'], 'audio/mpeg': ['mp3'], 'video/mp4': ['mp4'],
};
type Actor = { userId: number; role: string };
type MaterialFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };
type Session = { id: number; date: Date; start_time: Date | null; end_time: Date | null; status: string; teacher: { user_id: number | null } | null };
type Access = { classId: number; owner: boolean; managedIds: number[]; schedules: Session[] };
const fail = (code: number, message: string) => Object.assign(new Error(message), { statusCode: code });

function validTitle(title: string) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) throw fail(400, 'Tên tài liệu phải từ 1 đến 200 ký tự.');
    return title.trim();
}
function validFile(file: MaterialFile) {
    if (!file?.buffer?.length) throw fail(400, 'Vui lòng chọn file có nội dung.');
    if (file.size > MAX_FILE_SIZE || file.buffer.length > MAX_FILE_SIZE) throw fail(400, 'File tối đa 20 MB.');
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_TYPES[file.mimetype]?.includes(ext)) throw fail(400, 'Định dạng file không được hỗ trợ.');
    return ext;
}
const storagePath = (classId: number, ext: string) =>
    'tenant-' + currentTenantId() + '/class-' + classId + '/' + randomUUID() + '.' + ext;

// Support public URLs saved by old versions, but never sign URLs from another project.
function getStoragePath(value: string): string | null {
    if (!/^https?:\/\//i.test(value)) return value;
    try {
        const url = new URL(value);
        if (!process.env.SUPABASE_URL || url.origin !== new URL(process.env.SUPABASE_URL).origin) return null;
        const prefix = '/storage/v1/object/public/' + SUPABASE_STORAGE_BUCKET + '/';
        return url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : null;
    } catch { return null; }
}
async function cleanup(path: string | null) {
    if (!path) return;
    try {
        const { error } = await getSupabase().storage.from(SUPABASE_STORAGE_BUCKET).remove([path]);
        if (error) console.error('[Material] File cleanup failed:', error.message);
    } catch (error) { console.error('[Material] File cleanup failed:', error); }
}

export class MaterialService {
    async checkClassAccess(classId: number, userId: number, role: string): Promise<Access> {
        if (!['admin', 'teacher', 'student'].includes(role)) throw fail(403, 'Bạn không có quyền truy cập tài liệu.');
        const item = await prisma.class.findFirst({
            where: { id: classId, tenant_id: currentTenantId() },
            select: {
                teacher: { select: { user_id: true } },
                classEnrollments: { where: { status: { in: ['active', 'completed'] }, student: { user_id: userId } }, select: { id: true }, take: 1 },
                schedules: { select: { id: true, date: true, start_time: true, end_time: true, status: true, teacher: { select: { user_id: true } } },
                    orderBy: [{ date: 'asc' }, { start_time: 'asc' }, { id: 'asc' }] },
            },
        });
        if (!item) throw fail(404, 'Không tìm thấy lớp học.');
        const owner = role === 'admin' || role === 'teacher' && item.teacher?.user_id === userId;
        const managedIds = role === 'teacher' ? item.schedules.filter(s => s.teacher?.user_id === userId).map(s => s.id) : [];
        if (role === 'student' && !item.classEnrollments.length || role === 'teacher' && !owner && !managedIds.length) {
            throw fail(403, 'Bạn không có quyền truy cập tài liệu lớp này.');
        }
        return { classId, owner, managedIds, schedules: item.schedules };
    }

    private canManage(access: Access, scheduleId: number | null) {
        return access.owner || scheduleId !== null && access.managedIds.includes(scheduleId);
    }
    private assertTarget(access: Access, scheduleId: number | null) {
        if (scheduleId !== null && !access.schedules.some(s => s.id === scheduleId)) throw fail(400, 'Chọn buổi học thuộc đúng lớp.');
        if (!this.canManage(access, scheduleId)) throw fail(403, 'Bạn không có quyền quản lý tài liệu ở phạm vi này.');
    }
    private present<T extends { file_url: string; schedule_id: number | null }>(material: T, access: Access) {
        const { file_url, ...metadata } = material;
        return { ...metadata, can_manage: this.canManage(access, material.schedule_id) };
    }
    private async findMaterial(id: number, actor: Actor, write = false) {
        const item = await prisma.class_materials.findFirst({ where: { id, tenant_id: currentTenantId() } });
        if (!item) throw fail(404, 'Không tìm thấy tài liệu.');
        const access = await this.checkClassAccess(item.class_id, actor.userId, actor.role);
        if (!access.owner && actor.role === 'teacher' && item.schedule_id !== null && !access.managedIds.includes(item.schedule_id)) {
            throw fail(403, 'Bạn không phụ trách buổi học của tài liệu này.');
        }
        if (write) this.assertTarget(access, item.schedule_id);
        return { item, access };
    }
    private async list(access: Access, role: string, scheduleId?: number) {
        const items = await prisma.class_materials.findMany({
            where: { tenant_id: currentTenantId(), class_id: access.classId,
                ...(scheduleId !== undefined ? { OR: [{ schedule_id: null }, { schedule_id: scheduleId }] }
                    : role === 'teacher' && !access.owner ? { OR: [{ schedule_id: null }, { schedule_id: { in: access.managedIds } }] } : {}),
            },
            include: { users: { select: { id: true, full_name: true } },
                schedule: { select: { id: true, date: true, start_time: true, end_time: true, status: true } } },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
        return {
            class_id: access.classId,
            data: items.map(item => this.present(item, access)),
            schedules: access.schedules.filter(s => (scheduleId === undefined || s.id === scheduleId)
                && (role !== 'teacher' || access.owner || access.managedIds.includes(s.id)))
                .map(({ teacher, ...schedule }) => schedule),
            can_upload_common: access.owner,
            can_upload_schedule_ids: access.owner ? access.schedules.map(s => s.id) : access.managedIds,
        };
    }
    async getByClass(classId: number, userId: number, role: string) {
        return this.list(await this.checkClassAccess(classId, userId, role), role);
    }
    async getBySession(scheduleId: number, userId: number, role: string) {
        const session = await prisma.schedule.findFirst({ where: { id: scheduleId, tenant_id: currentTenantId() }, select: { class_id: true } });
        if (!session?.class_id) throw fail(404, 'Buổi học chưa có lớp hoặc không tồn tại.');
        const access = await this.checkClassAccess(session.class_id, userId, role);
        if (role === 'teacher' && !access.owner && !access.managedIds.includes(scheduleId)) throw fail(403, 'Bạn không phụ trách buổi học này.');
        return this.list(access, role, scheduleId);
    }

    async upload(params: Actor & { classId: number; scheduleId?: number | null; title: string; file: MaterialFile }) {
        const { classId, userId, role, file } = params;
        const access = await this.checkClassAccess(classId, userId, role);
        const scheduleId = params.scheduleId ?? null;
        this.assertTarget(access, scheduleId);
        const title = validTitle(params.title), ext = validFile(file), path = storagePath(classId, ext);
        const { error } = await getSupabase().storage.from(SUPABASE_STORAGE_BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
        if (error) throw fail(502, 'Không thể tải file lên kho tài liệu. Vui lòng thử lại.');
        try {
            const item = await prisma.class_materials.create({ data: {
                tenant_id: currentTenantId(), class_id: classId, schedule_id: scheduleId, title,
                file_name: file.originalname.replace(/\\/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f]/g, ''),
                file_url: path, file_type: file.mimetype, file_size: file.size, uploaded_by: userId,
            } });
            return this.present(item, access);
        } catch (error) { await cleanup(path); throw error; }
    }

    async update(id: number, userId: number, role: string, data: { title?: string; scheduleId?: number | null; file?: MaterialFile }) {
        const { item, access } = await this.findMaterial(id, { userId, role }, true);
        const scheduleId = data.scheduleId === undefined ? item.schedule_id : data.scheduleId;
        this.assertTarget(access, scheduleId);
        const title = data.title === undefined ? item.title : validTitle(data.title);
        let path: string | undefined;
        if (data.file) {
            path = storagePath(item.class_id, validFile(data.file));
            const { error } = await getSupabase().storage.from(SUPABASE_STORAGE_BUCKET).upload(path, data.file.buffer, { contentType: data.file.mimetype, upsert: false });
            if (error) throw fail(502, 'Không thể tải file thay thế. Tài liệu cũ vẫn được giữ nguyên.');
        }
        let updated;
        try {
            updated = await prisma.class_materials.update({
                where: { id, tenant_id: currentTenantId(), updated_at: item.updated_at, file_url: item.file_url },
                data: { title, schedule_id: scheduleId,
                    ...(data.file && path ? { file_url: path, file_name: data.file.originalname.replace(/\\/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f]/g, ''),
                        file_type: data.file.mimetype, file_size: data.file.size } : {}),
                },
            });
        } catch (error: any) {
            if (path) await cleanup(path);
            if (error.code === 'P2025') throw fail(409, 'Tài liệu vừa được thay đổi hoặc xóa. Vui lòng tải lại.');
            throw error;
        }
        if (path) await cleanup(getStoragePath(item.file_url));
        return this.present(updated, access);
    }

    async remove(id: number, userId: number, role: string) {
        const { item } = await this.findMaterial(id, { userId, role }, true);
        try {
            await prisma.class_materials.delete({ where: { id, tenant_id: currentTenantId(), updated_at: item.updated_at, file_url: item.file_url } });
        } catch (error: any) {
            if (error.code === 'P2025') throw fail(409, 'Tài liệu vừa được thay đổi hoặc xóa. Vui lòng tải lại.');
            throw error;
        }
        await cleanup(getStoragePath(item.file_url));
    }

    async download(id: number, userId: number, role: string) {
        const { item } = await this.findMaterial(id, { userId, role });
        const path = getStoragePath(item.file_url);
        if (!path) throw fail(404, 'Không tìm thấy tệp của tài liệu này.');
        const { data, error } = await getSupabase().storage.from(SUPABASE_STORAGE_BUCKET)
            .createSignedUrl(path, DOWNLOAD_TTL, { download: item.file_name });
        if (error || !data?.signedUrl) throw fail(Number(error?.statusCode) === 404 ? 404 : 502, 'Không lấy được liên kết tải file. Vui lòng thử lại.');
        return { url: data.signedUrl, expires_in: DOWNLOAD_TTL };
    }
}

export const materialService = new MaterialService();

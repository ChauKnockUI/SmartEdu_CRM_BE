import { prisma } from '../database/db';
import { getSupabase, SUPABASE_STORAGE_BUCKET } from '../config/supabase';
import { currentTenantId } from '../database/tenant-context';

const SIGNED_URL_TTL_SECONDS = 3600;

// Chỉ nhận các loại tài liệu học tập; MIME do client khai báo nên kiểm tra thêm đuôi file.
const ALLOWED_TYPES: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    'text/plain': ['txt'],
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'application/zip': ['zip'],
    'audio/mpeg': ['mp3'],
    'video/mp4': ['mp4'],
};

const httpError = (statusCode: number, message: string) => {
    const err = new Error(message);
    (err as any).statusCode = statusCode;
    return err;
};

const validateFile = (file: { originalname: string; mimetype: string }) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const allowedExt = ALLOWED_TYPES[file.mimetype];
    if (!allowedExt || !allowedExt.includes(ext)) {
        throw httpError(400, 'Định dạng file không được hỗ trợ');
    }
    return ext;
};

const buildStoragePath = (classId: number, ext: string) =>
    `tenant-${currentTenantId()}/class-${classId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

/** file_url có thể là đường dẫn storage (mới) hoặc URL public cũ (trước khi chuyển bucket private). */
const getStoragePath = (fileUrl: string): string | null => {
    if (!/^https?:\/\//.test(fileUrl)) return fileUrl;
    try {
        const url = new URL(fileUrl);
        const marker = `/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`;
        const index = url.pathname.indexOf(marker);
        if (index === -1) return null;
        return decodeURIComponent(url.pathname.slice(index + marker.length));
    } catch {
        return null;
    }
};

export class MaterialService {
    async checkClassAccess(classId: number, userId: number, role: string) {
        if (role === 'admin') return;

        const classItem = await prisma.class.findUnique({
            where: { id: classId },
            include: {
                teacher: true,
                classEnrollments: {
                    include: {
                        student: true,
                    },
                },
            },
        });

        if (!classItem) {
            const err = new Error('Không tìm thấy lớp học');
            (err as any).statusCode = 404;
            throw err;
        }

        if (role === 'teacher') {
            if (classItem.teacher?.user_id !== userId) {
                const err = new Error('Bạn không có quyền thao tác lớp này');
                (err as any).statusCode = 403;
                throw err;
            }

            return;
        }

        if (role === 'student') {
            const isEnrolled = classItem.classEnrollments.some(
                (enrollment) => enrollment.student?.user_id === userId
            );

            if (!isEnrolled) {
                const err = new Error('Bạn không có quyền xem tài liệu lớp này');
                (err as any).statusCode = 403;
                throw err;
            }

            return;
        }

        const err = new Error('Bạn không có quyền truy cập');
        (err as any).statusCode = 403;
        throw err;
    }

    async getByClass(classId: number, userId: number, role: string) {
        await this.checkClassAccess(classId, userId, role);

        const items = await prisma.class_materials.findMany({
            where: {
                class_id: classId,
            },
            include: {
                users: {
                    select: {
                        id: true,
                        full_name: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                created_at: 'desc',
            },
        });

        // Bucket private: trả URL ký ngắn hạn thay cho URL cố định
        const paths = items.map((m) => getStoragePath(m.file_url));
        const valid = paths.filter((p): p is string => !!p);
        const signed = valid.length
            ? await getSupabase().storage.from(SUPABASE_STORAGE_BUCKET).createSignedUrls(valid, SIGNED_URL_TTL_SECONDS)
            : { data: [] as { path: string | null; signedUrl: string }[] };
        const urlByPath = new Map(signed.data?.map((d) => [d.path, d.signedUrl]) ?? []);

        return items.map((m, i) => ({
            ...m,
            file_url: (paths[i] && urlByPath.get(paths[i])) || null,
        }));
    }

    async upload(params: {
        classId: number;
        userId: number;
        role: string;
        title: string;
        file: any;
    }) {
        const { classId, userId, role, title, file } = params;

        if (role !== 'admin' && role !== 'teacher') {
            const err = new Error('Chỉ giảng viên hoặc admin được tải tài liệu lên');
            (err as any).statusCode = 403;
            throw err;
        }

        await this.checkClassAccess(classId, userId, role);

        const ext = validateFile(file);
        const storagePath = buildStoragePath(classId, ext);
        const supabase = getSupabase();

        const { error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(storagePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
            });

        if (error) {
            console.error('[Material] upload error:', error.message);
            throw httpError(500, 'Không thể tải file lên');
        }

        try {
            return await prisma.class_materials.create({
                data: {
                    class_id: classId,
                    title,
                    file_name: file.originalname,
                    file_url: storagePath,
                    file_type: file.mimetype,
                    file_size: file.size,
                    uploaded_by: userId,
                },
            });
        } catch (e) {
            await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([storagePath]);
            throw e;
        }
    }
    async update(
        id: number,
        userId: number,
        role: string,
        data: {
            title?: string;
            file: any;
        }
    ) {
        const material = await prisma.class_materials.findUnique({
            where: { id },
            include: {
                classes: {
                    include: {
                        teacher: true,
                    },
                },
            },
        });

        if (!material) {
            const err = new Error('Không tìm thấy tài liệu');
            (err as any).statusCode = 404;
            throw err;
        }

        if (role !== 'admin' && material.classes.teacher?.user_id !== userId) {
            const err = new Error('Bạn không có quyền chỉnh sửa tài liệu này');
            (err as any).statusCode = 403;
            throw err;
        }

        const supabase = getSupabase();
        let fileData = {};
        let newStoragePath: string | null = null;

        if (data.file) {
            const ext = validateFile(data.file);
            newStoragePath = buildStoragePath(material.class_id, ext);

            const { error } = await supabase.storage
                .from(SUPABASE_STORAGE_BUCKET)
                .upload(newStoragePath, data.file.buffer, {
                    contentType: data.file.mimetype,
                    upsert: false,
                });

            if (error) {
                console.error('[Material] upload error:', error.message);
                throw httpError(500, 'Không thể tải file lên');
            }

            fileData = {
                file_name: data.file.originalname,
                file_url: newStoragePath,
                file_type: data.file.mimetype,
                file_size: data.file.size,
            };
        }

        // Ghi DB trước; chỉ xóa file cũ sau khi DB đã cập nhật để không mất file khi DB lỗi
        let updated;
        try {
            updated = await prisma.class_materials.update({
                where: { id },
                data: {
                    title: data.title || material.title,
                    ...fileData,
                },
            });
        } catch (e) {
            if (newStoragePath) await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([newStoragePath]);
            throw e;
        }

        if (newStoragePath) {
            const oldStoragePath = getStoragePath(material.file_url);
            if (oldStoragePath) {
                await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([oldStoragePath]);
            }
        }

        return updated;
    }

    async remove(id: number, userId: number, role: string) {
        const material = await prisma.class_materials.findUnique({
            where: { id },
            include: {
                classes: {
                    include: {
                        teacher: true,
                    },
                },
            },
        });

        if (!material) {
            const err = new Error('Không tìm thấy tài liệu');
            (err as any).statusCode = 404;
            throw err;
        }

        if (role !== 'admin' && material.classes.teacher?.user_id !== userId) {
            const err = new Error('Bạn không có quyền xóa tài liệu này');
            (err as any).statusCode = 403;
            throw err;
        }

        const deleted = await prisma.class_materials.delete({
            where: { id },
        });

        const storagePath = getStoragePath(material.file_url);
        if (storagePath) {
            await getSupabase().storage.from(SUPABASE_STORAGE_BUCKET).remove([storagePath]);
        }

        return deleted;
    }
}

export const materialService = new MaterialService();
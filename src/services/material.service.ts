import { prisma } from '../database/db';
import { supabase, SUPABASE_STORAGE_BUCKET } from '../config/supabase';

const getStoragePathFromUrl = (fileUrl: string) => {
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

        return prisma.class_materials.findMany({
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

        const ext = file.originalname.split('.').pop() || 'file';

        const safeFileName =
            Date.now() +
            '-' +
            Math.random().toString(36).slice(2) +
            '.' +
            ext;

        const storagePath = `class-${classId}/${safeFileName}`;

        const { error } = await supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .upload(storagePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
            });

        if (error) {
            const err = new Error(error.message);
            (err as any).statusCode = 500;
            throw err;
        }

        const { data } = supabase.storage
            .from(SUPABASE_STORAGE_BUCKET)
            .getPublicUrl(storagePath);

        return prisma.class_materials.create({
            data: {
                class_id: classId,
                title,
                file_name: file.originalname,
                file_url: data.publicUrl,
                file_type: file.mimetype,
                file_size: file.size,
                uploaded_by: userId,
            },
        });
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

        let fileData = {};

        if (data.file) {
            const ext = data.file.originalname.split('.').pop() || 'file';

            const safeFileName =
                Date.now() +
                '-' +
                Math.random().toString(36).slice(2) +
                '.' +
                ext;

            const newStoragePath = `class-${material.class_id}/${safeFileName}`;

            const { error } = await supabase.storage
                .from(SUPABASE_STORAGE_BUCKET)
                .upload(newStoragePath, data.file.buffer, {
                    contentType: data.file.mimetype,
                    upsert: false,
                });

            if (error) {
                const err = new Error(error.message);
                (err as any).statusCode = 500;
                throw err;
            }

            const oldStoragePath = getStoragePathFromUrl(material.file_url);

            if (oldStoragePath) {
                await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([oldStoragePath]);
            }

            const { data: publicData } = supabase.storage
                .from(SUPABASE_STORAGE_BUCKET)
                .getPublicUrl(newStoragePath);

            fileData = {
                file_name: data.file.originalname,
                file_url: publicData.publicUrl,
                file_type: data.file.mimetype,
                file_size: data.file.size,
            };
        }

        return prisma.class_materials.update({
            where: { id },
            data: {
                title: data.title || material.title,
                ...fileData,
            },
        });
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

        const storagePath = getStoragePathFromUrl(material.file_url);

        if (storagePath) {
            await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([storagePath]);
        }

        return prisma.class_materials.delete({
            where: { id },
        });
    }
}

export const materialService = new MaterialService();
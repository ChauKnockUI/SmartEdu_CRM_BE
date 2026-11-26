import { z } from 'zod';
import { prisma, withTenantTx } from '../database/db';
import { currentTenantId } from '../database/tenant-context';
import { ApiError } from '../utils/apiError';
import { decryptEmailKey, emailStorageReady, encryptEmailKey, isGmailCredential } from '../utils/emailSettingsSecret';
import { createGmailTransport, isGmailCertificateError } from './gmailTransport';

const inputSchema = z.object({
    sender_name: z.string().trim().min(1, 'Nhập tên người gửi.').max(100, 'Tên người gửi tối đa 100 ký tự.').regex(/^[^\r\n]+$/, 'Tên người gửi chỉ gồm một dòng.'),
    sender_email: z.string().trim().max(255, 'Email tối đa 255 ký tự.').email('Email người gửi không hợp lệ.'),
    app_password: z.string().max(100, 'Mật khẩu ứng dụng không hợp lệ.').transform(value => value.replace(/\s/g, ''))
        .refine(value => !value || /^[a-zA-Z0-9]{16}$/.test(value), 'Mật khẩu ứng dụng gồm 16 ký tự do Google cung cấp.').optional(),
    updated_at: z.string().datetime().nullable(),
}).strict();
const changed = () => new ApiError(409, 'Cấu hình vừa được thay đổi ở nơi khác. Vui lòng tải lại trước khi lưu.');

async function verifySender(password: string, address: string) {
    const transport = createGmailTransport(address, password);
    try {
        await transport.verify();
    } catch (error: any) {
        if (isGmailCertificateError(error)) {
            throw new ApiError(503, 'Không xác minh được chứng chỉ kết nối Gmail. Vui lòng liên hệ quản trị viên kiểm tra chứng chỉ trên máy chủ.');
        }
        if (error.code === 'EAUTH' || [534, 535].includes(error.responseCode)) {
            throw new ApiError(422, 'Gmail từ chối đăng nhập. Kiểm tra đúng Gmail và Mật khẩu ứng dụng; không dùng mật khẩu đăng nhập Google.');
        }
        throw new ApiError(502, 'Chưa kết nối được Gmail. Cấu hình cũ vẫn được giữ; vui lòng kiểm tra mạng rồi thử lại.');
    } finally { transport.close(); }
}

export const emailSettingsService = {
    async get() {
        const row = await prisma.tenantEmailSettings.findFirst();
        const hasPassword = !!row && isGmailCredential(row.api_key_encrypted);
        return { sender_name: row?.sender_name || '', sender_email: row?.sender_email || '',
            has_password: hasPassword, checked_at: hasPassword ? row.checked_at : null, updated_at: row?.updated_at || null,
            storage_ready: emailStorageReady() };
    },

    async save(input: unknown) {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
        if (!emailStorageReady()) throw new ApiError(503, 'Chức năng email chưa được bật trên máy chủ. Vui lòng liên hệ người triển khai.');
        const tenantId = currentTenantId(), data = parsed.data;
        const existing = await prisma.tenantEmailSettings.findFirst();
        if ((existing?.updated_at.toISOString() || null) !== data.updated_at) throw changed();
        const password = data.app_password || (existing && isGmailCredential(existing.api_key_encrypted)
            ? decryptEmailKey(existing.api_key_encrypted, tenantId) : '');
        if (!password) throw new ApiError(400, 'Nhập Mật khẩu ứng dụng của Gmail cho lần kết nối đầu tiên.');
        await verifySender(password, data.sender_email);
        const values = { sender_name: data.sender_name, sender_email: data.sender_email,
            api_key_encrypted: encryptEmailKey(password, tenantId), checked_at: new Date() };
        await withTenantTx(async tx => {
            if (existing) {
                const result = await tx.tenantEmailSettings.updateMany({
                    where: { tenant_id: tenantId, updated_at: existing.updated_at }, data: values,
                });
                if (!result.count) throw changed();
            } else await tx.tenantEmailSettings.create({ data: { tenant_id: tenantId, ...values } });
        });
        return this.get();
    },

    async deliveryConfiguration() {
        if (!emailStorageReady()) return null;
        const row = await prisma.tenantEmailSettings.findFirst();
        return row && isGmailCredential(row.api_key_encrypted) ? { password: decryptEmailKey(row.api_key_encrypted, currentTenantId()),
            sender: { name: row.sender_name, email: row.sender_email } } : null;
    },
};

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ApiError } from './apiError';

export const emailStorageReady = () => /^[a-f0-9]{64}$/i.test(process.env.EMAIL_SETTINGS_ENCRYPTION_KEY || '');
export const isGmailCredential = (value: string) => value.startsWith('gmail-v1.');
const encryptionKey = () => {
    if (!emailStorageReady()) throw new ApiError(503, 'Chức năng email chưa được bật trên máy chủ. Vui lòng liên hệ người triển khai.');
    return Buffer.from(process.env.EMAIL_SETTINGS_ENCRYPTION_KEY!, 'hex');
};

// Bind ciphertext to its tenant so copying a stored key between tenants fails authentication.
export function encryptEmailKey(value: string, tenantId: number) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`tenant-gmail:${tenantId}`));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['gmail-v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptEmailKey(value: string, tenantId: number) {
    const key = encryptionKey();
    try {
        const parts = value.split('.'), [version, iv, tag, ciphertext] = parts;
        if (parts.length !== 4 || version !== 'gmail-v1' || !iv || !tag || !ciphertext) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAAD(Buffer.from(`tenant-gmail:${tenantId}`));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        throw new ApiError(503, 'Không đọc được mật khẩu ứng dụng đã lưu. Vui lòng nhập lại hoặc liên hệ người triển khai.');
    }
}

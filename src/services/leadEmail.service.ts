import { createHash } from 'crypto';
import { emailSettingsService } from './emailSettings.service';
import { createGmailTransport, isGmailCertificateError } from './gmailTransport';
const failure = (message: string, statusCode: number, deliveryUnknown = false) =>
    Object.assign(new Error(message), { statusCode, deliveryUnknown });
type SendInput = { to: string; subject: string; text: string; idempotencyKey: string };
const attempts = new Map<string, { fingerprint: string; expires: number; result: Promise<{ id: string }> }>();

async function deliver(data: SendInput) {
    const config = await emailSettingsService.deliveryConfiguration();
    if (!config) throw failure('Trung tâm chưa kết nối Gmail. Vui lòng liên hệ quản trị viên.', 503);
    const transport = createGmailTransport(config.sender.email, config.password);
    const messageId = `<${createHash('sha256').update(data.idempotencyKey).digest('hex')}@${config.sender.email.split('@')[1]}>`;
    try {
        const result = await transport.sendMail({
            from: { name: config.sender.name, address: config.sender.email }, replyTo: config.sender.email,
            to: data.to, subject: data.subject, text: data.text, messageId,
        });
        if (!result.accepted?.length) throw failure('Gmail chưa chấp nhận email. Vui lòng kiểm tra địa chỉ người nhận.', 502);
        return { id: result.messageId || messageId };
    } catch (error: any) {
        // Never expose SMTP responses, transport options or passwords.
        if (error.deliveryUnknown !== undefined) throw error;
        if (isGmailCertificateError(error)) throw failure('Không xác minh được chứng chỉ kết nối Gmail. Vui lòng yêu cầu Admin kiểm tra chứng chỉ trên máy chủ.', 503);
        if (error.code === 'EAUTH') throw failure('Gmail từ chối đăng nhập. Vui lòng yêu cầu Admin kiểm tra Mật khẩu ứng dụng.', 422);
        if ([421, 450, 451, 452].includes(error.responseCode)) throw failure('Gmail đang tạm giới hạn hoặc chưa nhận email. Vui lòng chờ rồi thử lại.', 429);
        if (error.responseCode >= 400 || ['EENVELOPE', 'EDNS', 'ETLS'].includes(error.code)
            || /^(CONN|EHLO|HELO|AUTH|STARTTLS|MAIL FROM|RCPT TO)/i.test(error.command || '')) {
            throw failure('Chưa gửi được email. Vui lòng kiểm tra kết nối, người nhận hoặc cấu hình Gmail.', 502);
        }
        throw failure('Chưa xác nhận được kết quả gửi. Hãy kiểm tra mục Đã gửi trong Gmail của trung tâm trước khi gửi lại.', 502, true);
    } finally { transport.close(); }
}

export const leadEmailService = {
    async getConfiguration() {
        const config = await emailSettingsService.get();
        const available = config.has_password && config.storage_ready;
        return { available, from: available ? `${config.sender_name} <${config.sender_email}>` : undefined };
    },

    async send(data: SendInput) {
        const now = Date.now();
        for (const [key, attempt] of attempts) if (attempt.expires <= now) attempts.delete(key);
        const fingerprint = createHash('sha256').update(JSON.stringify([data.to, data.subject, data.text])).digest('hex');
        const previous = attempts.get(data.idempotencyKey);
        if (previous) {
            if (previous.fingerprint !== fingerprint) throw failure('Mã gửi này đã dùng cho nội dung khác. Vui lòng soạn email mới.', 409);
            return previous.result;
        }
        if (attempts.size >= 1000) throw failure('Dịch vụ email đang bận. Vui lòng chờ rồi thử lại.', 429);
        // SMTP has no provider idempotency. Coalesce retries in this process; saved
        // Lead history remains the durable check. Retain ambiguous failures too.
        const result = deliver(data).catch(error => {
            if (!error.deliveryUnknown) attempts.delete(data.idempotencyKey);
            throw error;
        });
        attempts.set(data.idempotencyKey, { fingerprint, result, expires: now + 30 * 60_000 });
        return result;
    },
};

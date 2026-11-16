import axios from 'axios';
import { z } from 'zod';

const email = z.string().email();
const configuration = () => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.LEAD_EMAIL_FROM?.trim();
    const replyTo = process.env.LEAD_EMAIL_REPLY_TO?.trim();
    const senderAddress = from?.match(/<([^<>]+)>$/)?.[1] || from;
    return { apiKey, from, replyTo, available: !!apiKey && email.safeParse(senderAddress).success
        && (!replyTo || email.safeParse(replyTo).success) && !/[\r\n]/.test(from || '') };
};
const failure = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export const leadEmailService = {
    getConfiguration() {
        const { available, from } = configuration();
        return { available, from: available ? from : undefined };
    },

    async send(data: { to: string; subject: string; text: string; idempotencyKey: string }) {
        const { apiKey, from, replyTo, available } = configuration();
        if (!available) throw failure('Chưa cấu hình dịch vụ gửi email. Vui lòng liên hệ quản trị viên.', 503);
        try {
            const response = await axios.post('https://api.resend.com/emails', {
                from, to: [data.to], subject: data.subject, text: data.text,
                ...(replyTo ? { reply_to: replyTo } : {}),
            }, {
                headers: { Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': data.idempotencyKey },
                timeout: 15_000,
            });
            if (!response.data?.id) throw new Error('Missing email identifier');
            return { id: String(response.data.id) };
        } catch (error: any) {
            // Do not expose provider responses, headers or credentials to the client/logs.
            if (error.response?.status === 409) throw failure('Yêu cầu email đang được xử lý hoặc nội dung đã thay đổi. Vui lòng kiểm tra lịch sử trước khi thử lại.', 409);
            if (error.response?.status === 429) throw failure('Dịch vụ email đang giới hạn lượt gửi. Vui lòng chờ rồi thử lại.', 429);
            if (!error.response) throw failure('Chưa xác nhận được kết quả gửi email. Vui lòng thử lại cùng nội dung để tránh gửi trùng.', 502);
            throw failure('Dịch vụ chưa chấp nhận email. Vui lòng kiểm tra cấu hình gửi hoặc thử lại sau.', 502);
        }
    },
};

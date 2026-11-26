import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { rootCertificates } from 'tls';
import { ApiError } from '../utils/apiError';

export const isGmailCertificateError = (error: { code?: string; message?: string }) =>
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '') || /certificate|self.signed/i.test(error.message || '');

// The server/port stay fixed; the browser only supplies the center's credentials.
export const createGmailTransport = (email: string, password: string) => {
    const caFile = process.env.GMAIL_SMTP_CA_FILE?.trim();
    let ca: (string | Buffer)[] | undefined;
    if (caFile) {
        try { ca = [...rootCertificates, readFileSync(caFile)]; }
        catch { throw new ApiError(503, 'Không đọc được chứng chỉ Gmail trên máy chủ. Vui lòng liên hệ người triển khai.'); }
    }
    return nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true,
        auth: { user: email, pass: password },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
        disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    });
};

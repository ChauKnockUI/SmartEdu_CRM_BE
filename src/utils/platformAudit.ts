import { Request } from 'express';

/**
 * Ghi nhật ký thao tác của Super Admin dưới dạng JSON một dòng (stdout), không chứa mật khẩu/token.
 * TODO: chuyển sang bảng platform_audit_logs khi DB session bổ sung migration.
 */
export const auditPlatform = (req: Request, action: string, details: Record<string, unknown> = {}): void => {
  console.info(
    JSON.stringify({
      type: 'platform_audit',
      at: new Date().toISOString(),
      admin_id: req.platformAdmin?.id ?? null,
      admin_email: req.platformAdmin?.email ?? null,
      ip: req.ip,
      action,
      ...details,
    })
  );
};

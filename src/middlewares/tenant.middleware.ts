import { Request, Response, NextFunction } from 'express';
import { adminPrisma } from '../database/admin-db';
import { runWithTenant } from '../database/tenant-context';
import { env } from '../config/env';

export interface RequestTenant {
  id: number;
  subdomain: string;
  status: 'trial' | 'active';
}

declare global {
  namespace Express {
    interface Request {
      tenant?: RequestTenant;
    }
  }
}

export const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'admin', 'api', 'app', 'auth', 'login', 'mail', 'static',
  'assets', 'status', 'support', 'platform', 'super-admin',
]);

interface CachedTenant {
  value: (RequestTenant & { trialEndsAt: Date | null; dbStatus: string }) | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CachedTenant>();

export const invalidateTenantCache = (subdomain?: string): void => {
  if (subdomain) cache.delete(subdomain);
  else cache.clear();
};

/** Tách subdomain từ Host theo BASE_DOMAIN. Trả null nếu không có subdomain hợp lệ. */
export const extractSubdomain = (host: string): string | null => {
  const hostname = host.split(':')[0].toLowerCase();
  const suffix = `.${env.BASE_DOMAIN.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const sub = hostname.slice(0, -suffix.length);
  if (!sub || sub.includes('.')) return null;
  return sub;
};

const lookupTenant = async (subdomain: string) => {
  const hit = cache.get(subdomain);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const row = await adminPrisma.tenant.findUnique({
    where: { subdomain },
    select: { id: true, subdomain: true, status: true, trial_ends_at: true },
  });

  const value = row
    ? {
        id: row.id,
        subdomain: row.subdomain,
        status: row.status as 'trial' | 'active',
        dbStatus: row.status as string,
        trialEndsAt: row.trial_ends_at,
      }
    : null;
  cache.set(subdomain, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
};

/**
 * Xác định tenant từ Host (hoặc X-Forwarded-Host khi có proxy tin cậy) và mở ngữ cảnh DB cho request.
 * Tenant KHÔNG bao giờ lấy từ header/body do client gửi.
 */
export const resolveTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '';
    let subdomain = extractSubdomain(host);

    if (!subdomain && env.NODE_ENV !== 'production') {
      subdomain = env.DEV_DEFAULT_TENANT_SUBDOMAIN ?? null;
    }

    if (!subdomain || !SUBDOMAIN_REGEX.test(subdomain) || RESERVED_SUBDOMAINS.has(subdomain)) {
      res.status(404).json({ status: 'error', message: 'Không tìm thấy trung tâm' });
      return;
    }

    const tenant = await lookupTenant(subdomain);
    if (!tenant) {
      res.status(404).json({ status: 'error', message: 'Không tìm thấy trung tâm' });
      return;
    }

    if (tenant.dbStatus === 'suspended' || tenant.dbStatus === 'closed') {
      res.status(403).json({ status: 'error', message: 'Trung tâm đã bị tạm khóa' });
      return;
    }

    if (tenant.dbStatus === 'trial' && tenant.trialEndsAt && tenant.trialEndsAt.getTime() < Date.now()) {
      res.status(402).json({ status: 'error', message: 'Gói dùng thử đã hết hạn' });
      return;
    }

    req.tenant = { id: tenant.id, subdomain: tenant.subdomain, status: tenant.status };
    runWithTenant(tenant.id, () => next());
  } catch (error) {
    next(error);
  }
};

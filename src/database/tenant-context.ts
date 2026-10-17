import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: number;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const runWithTenant = <T>(tenantId: number, fn: () => T): T =>
  storage.run({ tenantId }, fn);

export const getTenantContext = (): TenantContext | undefined => storage.getStore();

/** Ném lỗi nếu gọi ngoài ngữ cảnh tenant — không để truy vấn không tenant lọt qua. */
export const currentTenantId = (): number => {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('Truy vấn DB ngoài ngữ cảnh tenant (thiếu runWithTenant)');
  }
  return ctx.tenantId;
};

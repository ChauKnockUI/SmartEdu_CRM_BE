import { withTenantTx } from '../database/db';
import { currentTenantId } from '../database/tenant-context';
import { vietnamClassDay } from '../utils/classStatus';

// Dates change at midnight. Share the first synchronization of a Vietnam day
// across concurrent requests; application class writes normalize their own status.
const synchronized = new Map<number, { day: string; pending: Promise<void> }>();

export async function ensureClassStatusesCurrent(now = new Date()): Promise<void> {
    const tenantId = currentTenantId();
    const day = vietnamClassDay(now);
    const previous = synchronized.get(tenantId);
    if (previous?.day === day) return previous.pending;
    const entry = { day, pending: Promise.resolve().then(async () => {
        await withTenantTx(tx => tx.$executeRaw`
            UPDATE classes
               SET status = CASE WHEN end_date < ${day}::date
                                 THEN 'completed'::"ClassStatus" ELSE 'ongoing'::"ClassStatus" END,
                   "updatedAt" = ${now}
             WHERE tenant_id = ${tenantId}
               AND status IN ('upcoming', 'ongoing')
               AND start_date IS NOT NULL
               AND (end_date IS NULL OR end_date >= start_date)
               AND (end_date < ${day}::date OR (status = 'upcoming' AND start_date <= ${day}::date))
        `);
    }) };
    synchronized.set(tenantId, entry);
    try { await entry.pending; }
    catch (error) {
        if (synchronized.get(tenantId) === entry) synchronized.delete(tenantId);
        throw error;
    }
}

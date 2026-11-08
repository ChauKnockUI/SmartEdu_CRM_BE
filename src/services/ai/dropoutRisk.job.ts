import { adminPrisma } from '../../database/admin-db';
import { prisma } from '../../database/db';
import { runWithTenant } from '../../database/tenant-context';
import { dropoutRiskService } from './dropoutRisk.service';

/** Cross-tenant job: resolve tenants with admin client, all business queries remain tenant scoped. */
export function startDropoutRiskJob() {
  let stopped = false;
  let pending: Promise<void> | null = null;
  const minutes = Number(process.env.DROPOUT_SCAN_INTERVAL_MINUTES || 60);
  if (!Number.isFinite(minutes) || minutes < 5) throw new Error('DROPOUT_SCAN_INTERVAL_MINUTES must be >= 5');
  const scan = () => {
    if (stopped || pending) return;
    pending = (async () => {
      const tenants = await adminPrisma.tenant.findMany({ where: { status: { in: ['trial', 'active'] } }, select: { id: true } });
      for (const tenant of tenants) {
        if (stopped) break;
        try {
          await runWithTenant(tenant.id, async () => {
            const classes = await prisma.class.findMany({ where: { status: 'ongoing' }, select: { id: true } });
            for (const item of classes) {
              if (stopped) break;
              await dropoutRiskService.scoreClass(item.id);
            }
          });
        } catch (error) { console.error('[DropoutRiskJob] tenant scan failed', tenant.id, error); }
      }
    })().catch(error => console.error('[DropoutRiskJob]', error)).finally(() => { pending = null; });
  };
  const initial = setTimeout(scan, 30_000);
  const interval = setInterval(scan, minutes * 60_000);
  initial.unref();
  interval.unref();
  return async () => { stopped = true; clearTimeout(initial); clearInterval(interval); await pending; };
}

import { Prisma } from '../generated/prisma';
import { withTenantTx } from '../database/db';
import { currentTenantId } from '../database/tenant-context';
import type { AcademicActor } from '../utils/academicAccess';
import { HYBRID_VERSION, MAPPING_VERSION } from '../services/ai/dropoutRisk.policy';

export interface DropoutSnapshotRow {
    student_id: number; class_id: number; full_name: string; email: string | null;
    class_name: string; class_status: string; result_data: unknown; evaluated_at: Date | null;
}

export function readDropoutSnapshot(row: DropoutSnapshotRow) {
    const data = row.result_data as Record<string, any> | null;
    const compatible = row.class_status === 'ongoing' && data
        && [MAPPING_VERSION, 'crm_assessments_to_uci_2_early', 'crm_assessments_to_uci_1'].includes(data.mapping_version);
    const snapshot = compatible ? data : null;
    const current = snapshot?.hybrid?.version === HYBRID_VERSION;
    return {
        student_id: row.student_id, class_id: row.class_id, full_name: row.full_name, email: row.email,
        class_name: row.class_name, class_status: row.class_status,
        risk_score: current ? snapshot?.risk_score ?? null : null,
        risk_level: ['high', 'medium', 'low'].includes(snapshot?.risk_level) ? snapshot!.risk_level as 'high' | 'medium' | 'low' : null,
        score_type: snapshot ? current ? 'hybrid_risk_index' : 'academic_legacy' : undefined,
        hybrid: current ? snapshot?.hybrid : null,
        model_score: snapshot?.model_score ?? snapshot?.model?.risk_score ?? null,
        model_includes_finance: snapshot?.model_includes_finance === true,
        academic_score: snapshot?.model_includes_finance ? null : snapshot?.academic_score ?? snapshot?.model?.risk_score ?? null,
        evidence: snapshot?.evidence || null, top_reasons: snapshot?.top_reasons || [], model_status: snapshot?.model_status,
        limited_data: snapshot?.snapshot?.limited_data || false, action: snapshot?.action,
        evaluated_at: snapshot && row.evaluated_at ? row.evaluated_at.toISOString() : null,
    };
}

export const dropoutRiskRepository = {
    async getSnapshots(actor: AcademicActor, filters: { classId?: number; studentId?: number; includeUpcoming?: boolean } = {}) {
        const tenantId = currentTenantId();
        const conditions = [Prisma.sql`e.tenant_id = ${tenantId} AND e.status = 'active'`,
            filters.includeUpcoming ? Prisma.sql`c.status IN ('ongoing', 'upcoming')` : Prisma.sql`c.status = 'ongoing'`];
        if (actor.role === 'teacher') conditions.push(Prisma.sql`EXISTS (
            SELECT 1 FROM teachers t WHERE t.id = c.teacher_id AND t.tenant_id = ${tenantId} AND t.user_id = ${actor.userId})`);
        else if (actor.role === 'sale') conditions.push(Prisma.sql`EXISTS (
            SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.tenant_id = ${tenantId} AND l.assigned_to = ${actor.userId})`);
        else if (actor.role !== 'admin') return [];
        if (filters.classId !== undefined) conditions.push(Prisma.sql`e.class_id = ${filters.classId}`);
        if (filters.studentId !== undefined) conditions.push(Prisma.sql`e.student_id = ${filters.studentId}`);
        const rows = await withTenantTx(tx => tx.$queryRaw<DropoutSnapshotRow[]>`
            SELECT e.student_id, e.class_id, s.full_name, s.email, c.name AS class_name, c.status AS class_status,
                   p.result_data, p."createdAt" AS evaluated_at
              FROM class_enrollments e
              JOIN classes c ON c.id = e.class_id AND c.tenant_id = ${tenantId}
              JOIN students s ON s.id = e.student_id AND s.tenant_id = ${tenantId}
              LEFT JOIN LATERAL (
                  SELECT result_data, "createdAt" FROM ai_predictions p
                   WHERE p.tenant_id = ${tenantId} AND p.prediction_type = 'dropout_risk'
                     AND p.reference_id = e.student_id AND p.result_data->'class_id' = to_jsonb(e.class_id)
                   ORDER BY p.id DESC LIMIT 1
              ) p ON true
             WHERE ${Prisma.join(conditions, ' AND ')}
             ORDER BY c.id, s.id`, { maxWait: 10_000, timeout: 15_000 });
        return rows.map(readDropoutSnapshot);
    },
};

export type DropoutSnapshot = ReturnType<typeof readDropoutSnapshot>;
export function dropoutAttention(rows: DropoutSnapshot[]) {
    const order = { high: 2, medium: 1, low: 0 };
    return rows.filter(row => row.risk_level === 'high' || row.risk_level === 'medium')
        .sort((a, b) => order[b.risk_level!] - order[a.risk_level!]
            || (b.risk_score ?? -1) - (a.risk_score ?? -1) || a.class_id - b.class_id || a.student_id - b.student_id);
}

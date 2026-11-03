import { HYBRID_VERSION } from './dropoutRisk.policy';

/** Keep the public reasons array compatible while exposing versioned JSON details. */
export function serializeStudentRisk<T extends { dropout_risk_reasons?: unknown; dropout_risk?: unknown; dropout_risk_updated_at?: unknown }>(student: T) {
  const stored = student.dropout_risk_reasons;
  const envelope = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Record<string, unknown> : null;
  const current = envelope?.version === HYBRID_VERSION;
  return { ...student,
    dropout_risk_reasons: Array.isArray(stored) ? stored.filter(item => typeof item === 'string')
      : current && Array.isArray(envelope?.reasons) ? envelope.reasons.filter(item => typeof item === 'string') : [],
    dropout_risk_type: current ? 'hybrid_risk_index'
      : student.dropout_risk_updated_at || student.dropout_risk != null ? 'academic_legacy' : 'unassessed',
    dropout_risk_details: current ? envelope?.details ?? null : null,
  };
}

import type { AcademicActor } from './academicAccess';

export type SessionChange = {
    action: 'cancel' | 'makeup'; date: string; start_time: string | null; end_time: string | null;
    reason: string; at: string; by: number;
};
type Journal = { type: 'session_changes_v1'; previousMemo?: string; history: SessionChange[] };

export function sessionJournal(memo?: string | null): Journal {
    if (memo) try {
        const value = JSON.parse(memo);
        if (value?.type === 'session_changes_v1' && Array.isArray(value.history)
            && value.history.every((item: SessionChange) => item && ['cancel', 'makeup'].includes(item.action)
                && typeof item.date === 'string' && typeof item.reason === 'string' && typeof item.at === 'string')) return value;
    } catch { /* Preserve existing free-text memos when the first change is recorded. */ }
    return { type: 'session_changes_v1', ...(memo ? { previousMemo: memo } : {}), history: [] };
}

export function sessionChangeInfo(memo?: string | null, status?: string, classStatus?: string) {
    const history = sessionJournal(memo).history.map(({ by: _by, ...item }) => item);
    const latest = history[history.length - 1];
    return { history, pendingMakeup: classStatus !== 'cancelled' && status === 'cancelled' && latest?.action === 'cancel',
        isMakeup: status !== 'cancelled' && latest?.action === 'makeup' };
}

export function sessionChangeAccess(row: {
    date: Date; start_time: Date | null; status: string; memo?: string | null;
    teacher?: { user_id: number | null } | null; class?: { status: string } | null;
    _count?: { attendances: number }; attendances?: unknown[];
}, actor: AcademicActor, now = new Date()) {
    const info = sessionChangeInfo(row.memo, row.status, row.class?.status);
    const owned = actor.role === 'admin' || (actor.role === 'teacher' && row.teacher?.user_id === actor.userId);
    const available = owned && !!row.class && row.class.status !== 'cancelled' && !(row._count?.attendances ?? row.attendances?.length ?? 0);
    const start = new Date(`${row.date.toISOString().slice(0, 10)}T${row.start_time?.toISOString().slice(11, 19) || '00:00:00'}+07:00`);
    return { ...info, canCancel: available && row.class?.status !== 'completed' && row.status === 'scheduled' && start > now,
        canMakeup: available && info.pendingMakeup };
}

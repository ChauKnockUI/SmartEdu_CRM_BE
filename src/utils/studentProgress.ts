import { sessionChangeInfo } from './sessionChanges';
import { sessionHasEnded, summarizeAttendance } from './attendanceSummary';

type ProgressEnrollment = {
    class_id: number; status: string;
    class: { name: string; status: string; course: { name: string; total_sessions: number | null } | null;
        schedules: { date: Date; end_time: Date | null; status: string; memo: string | null;
            _count: { attendances: number }; attendances: { status: string }[] }[] };
};

export function studentClassProgress(enrollment: ProgressEnrollment, now: Date) {
    const cls = enrollment.class;
    const sessions = cls.schedules.filter(session => session.status !== 'cancelled'
        || sessionChangeInfo(session.memo, session.status, cls.status).pendingMakeup);
    let held = 0, pendingMakeup = 0, awaitingConfirmation = 0;
    const personalAttendance: { status: string }[] = [];
    for (const session of sessions) {
        if (session.status === 'cancelled') { pendingMakeup++; continue; }
        if (!sessionHasEnded(session, now)) continue;
        if (session.status !== 'completed' && !session._count.attendances) { awaitingConfirmation++; continue; }
        held++;
        if (session.attendances[0]) personalAttendance.push(session.attendances[0]);
    }
    const courseTotal = cls.course?.total_sessions;
    const planned = sessions.length || (courseTotal && courseTotal > 0 ? courseTotal : null);
    const attendance = summarizeAttendance(personalAttendance);
    return { classId: enrollment.class_id, className: cls.name, courseName: cls.course?.name ?? null,
        classStatus: cls.status, enrollmentStatus: enrollment.status,
        plannedSessions: planned, scheduledSessions: sessions.length,
        heldSessions: held, attendedSessions: attendance.present + attendance.late,
        absentSessions: attendance.absent, excusedSessions: attendance.excused,
        pendingMakeupSessions: pendingMakeup, awaitingConfirmationSessions: awaitingConfirmation,
        progressPercent: sessions.length ? Math.round(held / sessions.length * 100) : null,
    };
}

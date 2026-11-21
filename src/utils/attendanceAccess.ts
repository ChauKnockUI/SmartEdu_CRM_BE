type Session = {
    date: Date; start_time: Date | null; status?: string; is_attendance_unlocked?: boolean;
    teacher?: { user_id: number | null } | null;
    class?: { status?: string; teacher?: { user_id: number | null } | null } | null;
};

export function attendanceAccess(session: Session, userId: number, role: string, now = new Date()) {
    // PostgreSQL DATE/TIME contain the centre's wall-clock date/time, not UTC instants.
    const day = session.date.toISOString().slice(0, 10);
    const time = session.start_time?.toISOString().slice(11, 19) || '00:00:00';
    const startsAt = new Date(`${day}T${time}+07:00`);
    const timeLocked = now.getTime() - startsAt.getTime() > 48 * 60 * 60 * 1000;
    const notStarted = now < startsAt;
    const cancelled = session.status === 'cancelled' || session.class?.status === 'cancelled';
    const assigned = role === 'teacher' && session.teacher?.user_id === userId;
    const blockReason = role !== 'admin' && !assigned ? 'Bạn không phụ trách điểm danh buổi học này.'
        : cancelled ? 'Buổi học hoặc lớp học đã hủy, không thể điểm danh.'
        : notStarted ? 'Chưa đến giờ bắt đầu buổi học.'
        : timeLocked && role !== 'admin' && !session.is_attendance_unlocked
            ? 'Điểm danh đã khóa sau 48 giờ từ lúc bắt đầu. Vui lòng yêu cầu Admin mở khóa.' : '';
    return { canMark: !blockReason, blockReason, timeLocked, cancelled, notStarted,
        canRequestUnlock: assigned && timeLocked && !cancelled && !session.is_attendance_unlocked };
}

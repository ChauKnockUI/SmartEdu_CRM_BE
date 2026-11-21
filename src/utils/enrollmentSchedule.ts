import { vietnamClassDay } from './classStatus';

type Session = { date: Date; start_time: Date | null; end_time: Date | null; status?: string };
type Enrollment = { class_id?: number; class: { name: string; status?: string; schedules: Session[] } };

export const remainingScheduleWhere = (now: Date) => ({
    date: { gte: new Date(`${vietnamClassDay(now)}T00:00:00Z`) },
    status: { notIn: ['cancelled', 'completed'] as ('cancelled' | 'completed')[] },
});

export function remainingSchedules(schedules: Session[], now: Date) {
    return schedules.filter(item => {
        if (['cancelled', 'completed'].includes(item.status || '') || !item.start_time || !item.end_time) return false;
        const end = `${item.date.toISOString().slice(0, 10)}T${item.end_time.toISOString().slice(11, 19)}+07:00`;
        return Date.parse(end) > now.getTime();
    });
}

export function enrollmentConflict(classId: number, schedules: Session[], enrollments: Enrollment[], now: Date) {
    const target = remainingSchedules(schedules, now);
    for (const enrollment of enrollments) {
        if (enrollment.class_id === classId || ['cancelled', 'completed'].includes(enrollment.class.status || '')) continue;
        for (const other of remainingSchedules(enrollment.class.schedules, now)) {
            const day = other.date.toISOString().slice(0, 10);
            if (target.some(item => item.date.toISOString().slice(0, 10) === day
                && item.start_time! < other.end_time! && item.end_time! > other.start_time!))
                return `Trùng lịch lớp ${enrollment.class.name} ngày ${day.split('-').reverse().join('/')}`;
        }
    }
    return undefined;
}

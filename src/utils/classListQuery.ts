import { z } from 'zod';
import { ClassStatus } from '../generated/prisma';

const id = z.coerce.number().int().positive().max(2147483647).optional();
export const classListQuery = z.object({
    page: z.coerce.number().int().positive().max(2147483647).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(200).optional(),
    status: z.enum(ClassStatus).optional(),
    course_id: id,
    teacher_id: id,
    unassigned_teacher: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
}).refine(query => !(query.teacher_id && query.unassigned_teacher), {
    message: 'Chọn giáo viên cụ thể hoặc lớp chưa phân công giáo viên.',
});

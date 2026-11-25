import { z } from 'zod';
import { StudentStatus } from '../generated/prisma';

export const studentListQuery = z.object({
    page: z.coerce.number().int().positive().max(2147483647).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(10),
    search: z.string().trim().max(200).optional(),
    status: z.enum(StudentStatus).optional(),
    class_id: z.coerce.number().int().positive().max(2147483647).optional(),
    exclude_class_id: z.coerce.number().int().positive().max(2147483647).optional(),
    has_debt: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
});
export const studentExportQuery = studentListQuery.omit({ page: true, limit: true });

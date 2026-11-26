import { Prisma } from '../generated/prisma';
import { courseRepository } from '../repositories/course.repository';
import type { AcademicActor } from '../utils/academicAccess';

export interface GetCoursesQuery {
    page?: unknown;
    limit?: unknown;
    search?: unknown;
    is_active?: unknown;
}

export interface CreateCourseInput {
    name: string;
    description?: string | null;
    total_sessions?: number | string;
    fee?: number | string;
    duration_weeks?: number | string;
    is_active?: boolean;
}

export type UpdateCourseInput = Partial<CreateCourseInput>;

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const MAX_INT = 2147483647;

function positiveInteger(value: unknown, label: string, max = MAX_INT): number {
    if ((typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && !/^\d+$/.test(value.trim()))) {
        throw fail(`${label} phải là số nguyên dương không vượt quá ${max.toLocaleString('vi-VN')}.`);
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || number > max) {
        throw fail(`${label} phải là số nguyên dương không vượt quá ${max.toLocaleString('vi-VN')}.`);
    }
    return number;
}

function validateCourseInput(input: CreateCourseInput | UpdateCourseInput, creating: boolean) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Thông tin khóa học không hợp lệ.');
    const data: Omit<CreateCourseInput, 'fee' | 'total_sessions' | 'duration_weeks' | 'name'> & {
        name?: string; fee?: Prisma.Decimal; total_sessions?: number; duration_weeks?: number;
    } = {};
    if (creating || input.name !== undefined) {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 255) {
            throw fail('Tên khóa học phải có từ 1 đến 255 ký tự.');
        }
        data.name = input.name.trim();
    }
    if (input.description !== undefined) {
        if (input.description !== null && typeof input.description !== 'string') throw fail('Mô tả khóa học phải là chuỗi ký tự.');
        data.description = input.description;
    }
    if (input.total_sessions !== undefined) data.total_sessions = positiveInteger(input.total_sessions, 'Tổng số buổi học', 10000);
    if (input.duration_weeks !== undefined) data.duration_weeks = positiveInteger(input.duration_weeks, 'Thời lượng (tuần)');
    if (input.fee !== undefined) {
        const message = 'Học phí phải là số hữu hạn không âm, không vượt quá 9.999.999.999.999,99 và có tối đa 2 chữ số thập phân.';
        if ((typeof input.fee !== 'number' && typeof input.fee !== 'string')
            || (typeof input.fee === 'number' && !Number.isFinite(input.fee))
            || (typeof input.fee === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.fee.trim()))) {
            throw fail(message);
        }
        const fee = new Prisma.Decimal(typeof input.fee === 'string' ? input.fee.trim() : input.fee);
        if (!fee.isFinite() || (fee.isNegative() && !fee.isZero()) || fee.gt('9999999999999.99') || fee.decimalPlaces() > 2) {
            throw fail(message);
        }
        data.fee = fee;
    }
    if (input.is_active !== undefined) {
        if (typeof input.is_active !== 'boolean') throw fail('Trạng thái khóa học phải là true hoặc false.');
        data.is_active = input.is_active;
    }
    if (!creating && !Object.keys(data).length) throw fail('Vui lòng cung cấp thông tin khóa học cần cập nhật.');
    return data;
}

export class CourseService {
    async getCourses(query: GetCoursesQuery) {
        const page = positiveInteger(query.page === undefined ? 1 : query.page, 'Trang');
        const limit = positiveInteger(query.limit === undefined ? 10 : query.limit, 'Số khóa học mỗi trang');
        const skip = (page - 1) * limit;
        if (!Number.isSafeInteger(skip) || skip > MAX_INT) throw fail('Phân trang khóa học vượt giới hạn cho phép.');
        if (query.search !== undefined && typeof query.search !== 'string') throw fail('Từ khóa tìm kiếm không hợp lệ.');
        const search = typeof query.search === 'string' ? query.search.trim() : '';

        const where: Prisma.CourseWhereInput = {};
        if (query.is_active === undefined || query.is_active === true || query.is_active === 'true') where.is_active = true;
        else if (query.is_active === false || query.is_active === 'false') where.is_active = false;
        else if (query.is_active !== 'all') throw fail('Bộ lọc trạng thái khóa học phải là true, false hoặc all.');

        if (search) {
            where.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        const [total, courses] = await Promise.all([
            courseRepository.count(where),
            courseRepository.findMany({
                skip,
                take: limit,
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
            })
        ]);

        return {
            data: courses,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getCourseById(id: number) {
        return courseRepository.findById(id);
    }

    async createCourse(data: CreateCourseInput) {
        const validated = validateCourseInput(data, true);
        return courseRepository.create({ ...validated, name: validated.name! });
    }

    async updateCourse(id: number, data: UpdateCourseInput) {
        const validated = validateCourseInput(data, false);
        const existing = await courseRepository.checkExistence(id);
        if (!existing) return null;

        return courseRepository.update(id, validated);
    }

    async deleteCourse(id: number) {
        const existing = await courseRepository.checkExistence(id);
        if (!existing) return false;

        await courseRepository.softDelete(id);
        return true;
    }

    async getClasses(courseId: number, actor: AcademicActor) {
        if (!actor) throw fail('Vui lòng đăng nhập để tiếp tục.', 401);
        if (!await courseRepository.checkExistence(courseId)) throw fail('Không tìm thấy khóa học.', 404);
        const classes = await courseRepository.findClasses(courseId, actor);
        const studentIds = new Set<number>();
        const data = classes.map(({ classEnrollments, ...cls }) => {
            classEnrollments.forEach(enrollment => studentIds.add(enrollment.student_id));
            return cls;
        });
        return { data, summary: { total_students: studentIds.size } };
    }
}

export const courseService = new CourseService();

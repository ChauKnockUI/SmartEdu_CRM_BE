import { Prisma } from '../generated/prisma';
import { prisma, withTenantTx } from '../database/db';
import { serializeStudentRisk } from '../services/ai/dropoutRisk.summary';
import { currentTenantId } from '../database/tenant-context';
import { LEAD_ACTIVE_STATUSES } from '../constants/leadWorkflow';
import { studentReadScope, classReadScope, enrollmentReadScope, type AcademicActor } from '../utils/academicAccess';
import { invoiceRemainingSql, studentBillingSummary } from '../utils/billing';

// A teacher reads risk per assigned class, not the student's aggregate from other classes.
const hiddenAggregateRisk = { dropout_risk: null, dropout_risk_level: null, dropout_risk_reasons: null, dropout_risk_updated_at: null };

export class StudentRepository {
    async getClassOptions(actor: AcademicActor) {
        return prisma.class.findMany({ where: classReadScope(actor), select: { id: true, name: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    }
    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.StudentWhereInput;
        orderBy?: Prisma.StudentOrderByWithRelationInput | Prisma.StudentOrderByWithRelationInput[];
    }, actor?: AcademicActor) {
        const viewBilling = actor?.role === 'admin' || actor?.role === 'sale';
        const now = new Date();
        const students = await prisma.student.findMany({
            ...params,
            include: {
                invoices: viewBilling ? { select: { total_amount: true, discount_amount: true, due_date: true, status: true,
                    payments: { where: { paid_at: { lte: now } }, select: { amount: true, paid_at: true } } } } : false,
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        avatar_url: true,
                        is_active: true
                    }
                },
                classEnrollments: {
                    ...(actor ? { where: enrollmentReadScope(actor) } : {}),
                    select: {
                        class_id: true,
                        status: true,
                        class: { select: { id: true, name: true } },
                    }
                }
            }
        });
        return students.map(student => {
            const { invoices, ...record } = student;
            const { lead_id, ...withoutLead } = record;
            const hideCRM = actor?.role === 'teacher' || actor?.role === 'student';
            return { ...serializeStudentRisk(hideCRM ? { ...withoutLead, ...hiddenAggregateRisk } : record),
                ...(viewBilling ? { financial_summary: studentBillingSummary(invoices || [], now) } : {}) };
        });
    }

    async findStudentIdsWithDebt(actor: AcademicActor, now = new Date()) {
        const tenantId = currentTenantId();
        const sale = actor.role === 'sale' ? Prisma.sql`AND EXISTS (SELECT 1 FROM leads l
            WHERE l.id = s.lead_id AND l.tenant_id = ${tenantId} AND l.assigned_to = ${actor.userId})` : Prisma.empty;
        return withTenantTx(tx => tx.$queryRaw<{ student_id: number }[]>`
            SELECT DISTINCT i.student_id FROM invoices i
              JOIN students s ON s.id = i.student_id AND s.tenant_id = ${tenantId}
             WHERE i.tenant_id = ${tenantId} AND i.status NOT IN ('cancelled', 'refunded')
               AND ${invoiceRemainingSql(tenantId, now)} > 0 ${sale}`);
    }

    async count(where?: Prisma.StudentWhereInput) {
        return await prisma.student.count({ where });
    }

    async findById(id: number, actor?: AcademicActor) {
        return this.findProfile({ id, ...(actor ? studentReadScope(actor) : {}) }, actor);
    }

    async findByUserId(user_id: number, actor: AcademicActor) {
        return this.findProfile({ user_id, AND: [studentReadScope(actor)] }, actor);
    }

    private async findProfile(where: Prisma.StudentWhereInput, actor?: AcademicActor) {
        const student = await prisma.student.findFirst({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        avatar_url: true,
                        is_active: true
                    }
                },
                lead: actor?.role === 'teacher' || actor?.role === 'student' ? false : { include: { course: { select: { id: true, name: true } } } },
                classEnrollments: {
                    ...(actor?.role === 'teacher' ? { where: enrollmentReadScope(actor) } : {}),
                    include: {
                        class: {
                            select: { id: true, name: true, course_id: true, start_date: true, end_date: true, status: true,
                                schedule_days: true, schedule_time: true,
                                course: { select: { name: true } }, teacher: { select: { full_name: true } } }
                        }
                    }
                }
            }
        });
        if (!student) return null;
        const { lead_id, ...record } = student;
        const hideCRM = actor?.role === 'teacher' || actor?.role === 'student';
        return serializeStudentRisk(hideCRM ? { ...record, ...hiddenAggregateRisk } : student);
    }

    async findByEmail(email: string) {
        return await prisma.user.findUnique({
            where: { tenant_id_email: { tenant_id: currentTenantId(), email } }
        });
    }

    async createStudentWithUser(
        userData: Prisma.UserCreateInput,
        studentData: Omit<Prisma.StudentUncheckedCreateInput, 'user_id'>
    ) {
        return await withTenantTx(async (tx) => {
            if (studentData.lead_id) {
                const updated = await tx.lead.updateMany({
                    where: { id: studentData.lead_id, status: { in: LEAD_ACTIVE_STATUSES }, assigned_to: { not: null },
                        assignedUser: { role: 'sale', is_active: true } },
                    data: { status: 'enrolled' },
                });
                if (!updated.count) throw Object.assign(new Error('Lead cần còn hoạt động, có Sale phụ trách đang hoạt động và chưa chuyển thành học viên. Vui lòng kiểm tra lại Lead.'), { statusCode: 400 });
            }
            // 1. Create User account for student
            const newUser = await tx.user.create({
                data: userData
            });

            // 2. Create Student profile linked to the new user
            const newStudent = await tx.student.create({
                data: {
                    ...studentData,
                    user_id: newUser.id
                }
            });

            return newStudent;
        });
    }

    async updateStudentAndUser(
        studentId: number,
        userId: number | null,
        studentData: Prisma.StudentUncheckedUpdateInput,
        userData?: Prisma.UserUncheckedUpdateInput
    ) {
        return await withTenantTx(async (tx) => {
            const updatedStudent = await tx.student.update({
                where: { id: studentId },
                data: studentData
            });

            if (userId && userData && Object.keys(userData).length > 0) {
                await tx.user.update({
                    where: { id: userId },
                    data: userData
                });
            }

            return updatedStudent;
        });
    }

    async updateUserPassword(userId: number, password_hash: string) {
        return await prisma.user.update({
            where: { id: userId },
            data: { password_hash }
        });
    }
}

export const studentRepository = new StudentRepository();

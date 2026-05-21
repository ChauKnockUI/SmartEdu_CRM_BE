import { Prisma } from '../generated/prisma';
import { prisma } from '../database/db';

export class TeacherRepository {
    async count(where?: Prisma.TeacherWhereInput) {
        return await prisma.teacher.count({ where });
    }

    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.TeacherWhereInput;
        orderBy?: Prisma.TeacherOrderByWithRelationInput;
    }) {
        return await prisma.teacher.findMany({
            ...params,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        is_active: true
                    }
                },
                _count: {
                    select: {
                        classes: true,
                        schedules: true
                    }
                }
            }
        });
    }

    async findById(id: number) {
        return await prisma.teacher.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        is_active: true
                    }
                },
                classes: {
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        start_date: true,
                        end_date: true
                    },
                    orderBy: { createdAt: 'desc' }
                },
                _count: {
                    select: {
                        classes: true,
                        schedules: true
                    }
                }
            }
        });
    }

    async findUserByEmail(email: string) {
        return await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true }
        });
    }

    async findTeacherByEmail(email: string) {
        return await prisma.teacher.findUnique({
            where: { email },
            select: { id: true, user_id: true, email: true }
        });
    }

    async createTeacherWithUser(
        userData: Prisma.UserCreateInput,
        teacherData: Omit<Prisma.TeacherUncheckedCreateInput, 'user_id'>
    ) {
        return await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({ data: userData });

            const newTeacher = await tx.teacher.create({
                data: {
                    ...teacherData,
                    user_id: newUser.id
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            role: true,
                            is_active: true
                        }
                    }
                }
            });

            return newTeacher;
        });
    }

    async updateTeacherAndUser(
        teacherId: number,
        userId: number | null,
        teacherData: Prisma.TeacherUncheckedUpdateInput,
        userData?: Prisma.UserUncheckedUpdateInput
    ) {
        return await prisma.$transaction(async (tx) => {
            const updatedTeacher = await tx.teacher.update({
                where: { id: teacherId },
                data: teacherData,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            role: true,
                            is_active: true
                        }
                    }
                }
            });

            if (userId && userData && Object.keys(userData).length > 0) {
                await tx.user.update({
                    where: { id: userId },
                    data: userData
                });
            }

            return updatedTeacher;
        });
    }

    async softDelete(id: number, userId: number | null) {
        return await prisma.$transaction(async (tx) => {
            const teacher = await tx.teacher.update({
                where: { id },
                data: { is_active: false }
            });

            if (userId) {
                await tx.user.update({
                    where: { id: userId },
                    data: { is_active: false }
                });
            }

            return teacher;
        });
    }

    async updateUserPassword(userId: number, password_hash: string) {
        return await prisma.user.update({
            where: { id: userId },
            data: { password_hash }
        });
    }

    async getSchedule(teacherId: number, startDate?: Date, endDate?: Date) {
        return await prisma.schedule.findMany({
            where: {
                teacher_id: teacherId,
                ...(startDate || endDate
                    ? {
                        date: {
                            ...(startDate ? { gte: startDate } : {}),
                            ...(endDate ? { lte: endDate } : {})
                        }
                    }
                    : {})
            },
            include: {
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                room: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: [
                { date: 'asc' },
                { start_time: 'asc' }
            ]
        });
    }
}

export const teacherRepository = new TeacherRepository();

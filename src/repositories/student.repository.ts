import { PrismaClient, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

export class StudentRepository {
    async findMany(params: {
        skip?: number;
        take?: number;
        where?: Prisma.StudentWhereInput;
        orderBy?: Prisma.StudentOrderByWithRelationInput;
    }) {
        return await prisma.student.findMany({
            ...params,
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
                classEnrollments: {
                    select: {
                        class_id: true,
                        status: true
                    }
                }
            }
        });
    }

    async count(where?: Prisma.StudentWhereInput) {
        return await prisma.student.count({ where });
    }

    async findById(id: number) {
        return await prisma.student.findUnique({
            where: { id },
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
                lead: true,
                classEnrollments: {
                    include: {
                        class: {
                            select: { id: true, name: true, start_date: true, end_date: true, status: true }
                        }
                    }
                }
            }
        });
    }

    async findByUserId(user_id: number) {
        return await prisma.student.findUnique({
            where: { user_id }
        });
    }

    async findByEmail(email: string) {
        return await prisma.user.findUnique({
            where: { email }
        });
    }

    async createStudentWithUser(
        userData: Prisma.UserCreateInput,
        studentData: Omit<Prisma.StudentUncheckedCreateInput, 'user_id'>
    ) {
        return await prisma.$transaction(async (tx) => {
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
        return await prisma.$transaction(async (tx) => {
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

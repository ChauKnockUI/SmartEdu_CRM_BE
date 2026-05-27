import { UserRole } from '../generated/prisma';
import { prisma } from '../database/db';

class UserService {
  async getSales() {
    return prisma.user.findMany({
      where: {
        role: UserRole.sale,
        is_active: true,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
      },
      orderBy: {
        full_name: 'asc',
      },
    });
  }
}

export const userService = new UserService();

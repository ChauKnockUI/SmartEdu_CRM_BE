import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../database/db';
import { generateToken } from '../utils/jwt.util';
import { RegisterInput, LoginInput } from '../schemas/auth.schema';

// ─── Register ─────────────────────────────────────────────────────────────────
/**
 * POST /api/auth/register
 * Đăng ký tài khoản mới.
 * - Kiểm tra email đã tồn tại chưa
 * - Hash mật khẩu
 * - Tạo user trong DB
 * - Trả về thông tin user + JWT token
 */
export const register = async (
  req: Request<{}, {}, RegisterInput>,
  res: Response
): Promise<void> => {
  try {
    const { email, password, full_name, phone, role } = req.body;

    // 1. Kiểm tra email đã tồn tại chưa
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(409).json({
        status: 'error',
        message: 'Email này đã được sử dụng',
      });
      return;
    }

    // 2. Hash mật khẩu (salt rounds = 12)
    const password_hash = await bcrypt.hash(password, 12);

    // Xác định trạng thái active dựa trên role
    const assignedRole = role ?? 'student';
    const isActive = assignedRole === 'student';

    // 3. Tạo user trong database
    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        full_name,
        phone,
        role: assignedRole,
        is_active: isActive,
      },
      select: {
        // Chỉ trả về các field cần thiết, KHÔNG trả về password_hash
        id: true,
        email: true,
        full_name: true,
        phone: true,
        role: true,
        avatar_url: true,
        is_active: true,
        createdAt: true,
      },
    });

    // Nếu không phải student (chưa được duyệt), không trả về token
    if (!isActive) {
      res.status(201).json({
        status: 'success',
        message: 'Đăng ký thành công. Vui lòng chờ quản trị viên duyệt tài khoản của bạn.',
        data: {
          user,
          token: null,
        },
      });
      return;
    }

    // 4. Sinh JWT token cho tài khoản đã active (student)
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      status: 'success',
      message: 'Đăng ký thành công',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error('[Auth] Register error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Lỗi server, vui lòng thử lại sau',
    });
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────
/**
 * POST /api/auth/login
 * Đăng nhập với email + password.
 * - Tìm user theo email
 * - So sánh mật khẩu
 * - Trả về thông tin user + JWT token
 */
export const login = async (
  req: Request<{}, {}, LoginInput>,
  res: Response
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // 1. Tìm user theo email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(401).json({
        status: 'error',
        message: 'Email hoặc mật khẩu không đúng',
      });
      return;
    }

    // 2. Kiểm tra tài khoản còn active không
    if (!user.is_active) {
      res.status(403).json({
        status: 'error',
        message: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ admin',
      });
      return;
    }

    // 3. So sánh mật khẩu
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      res.status(401).json({
        status: 'error',
        message: 'Email hoặc mật khẩu không đúng',
      });
      return;
    }

    // 4. Sinh JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // 5. Trả về response (không bao gồm password_hash)
    const { password_hash: _, ...userWithoutPassword } = user;

    res.status(200).json({
      status: 'success',
      message: 'Đăng nhập thành công',
      data: {
        user: userWithoutPassword,
        token,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Lỗi server, vui lòng thử lại sau',
    });
  }
};

// ─── Get Me ───────────────────────────────────────────────────────────────────
/**
 * GET /api/auth/me
 * Lấy thông tin user hiện tại (cần JWT token).
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    // req.user được gắn vào bởi auth middleware (sẽ tạo sau)
    const userId = (req as any).user?.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone: true,
        role: true,
        avatar_url: true,
        is_active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({
        status: 'error',
        message: 'Không tìm thấy người dùng',
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  } catch (error) {
    console.error('[Auth] GetMe error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Lỗi server, vui lòng thử lại sau',
    });
  }
};

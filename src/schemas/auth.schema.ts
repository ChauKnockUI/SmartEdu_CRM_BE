import { z } from 'zod';

// ─── Register ─────────────────────────────────────────────────────────────────
export const registerSchema = z.object({
  body: z.object({
    email: z
      .string()
      .min(1, 'Email là bắt buộc')
      .email('Email không hợp lệ')
      .toLowerCase(),
    password: z
      .string()
      .min(1, 'Mật khẩu là bắt buộc')
      .min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
    full_name: z
      .string()
      .min(2, 'Họ tên phải có ít nhất 2 ký tự')
      .max(100, 'Họ tên không được quá 100 ký tự'),
    phone: z
      .string()
      .regex(/^(0|\+84)[0-9]{8,10}$/, 'Số điện thoại không hợp lệ')
      .optional(),
    role: z
      .enum(['sale', 'teacher', 'student'] as const, {
        message: 'Role phải là sale, teacher hoặc student',
      })
      .optional()
      .default('student'),
  }),
});

// ─── Login ────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  body: z.object({
    email: z
      .string()
      .min(1, 'Email là bắt buộc')
      .email('Email không hợp lệ')
      .toLowerCase(),
    password: z
      .string()
      .min(1, 'Mật khẩu là bắt buộc'),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];

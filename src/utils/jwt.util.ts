import jwt from 'jsonwebtoken';
import { UserRole } from '../generated/prisma';
import { env } from '../config/env';

export interface JwtPayload {
  userId: number;
  email: string;
  role: UserRole;
  tenantId: number;
  scope: 'tenant' | 'platform';
}

export const generateToken = (payload: JwtPayload, expiresIn: string = env.JWT_EXPIRES_IN): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
};

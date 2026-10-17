import express from 'express';
import cors from 'cors';
import { router } from './routes';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { requestLogger } from './middlewares/requestLogger.middleware';
import { resolveTenant } from './middlewares/tenant.middleware';
import platformRoutes from './routes/platform.routes';
import materialRoutes from './routes/material.routes';

const app = express();

// Cho phép FRONTEND_URL và mọi subdomain của BASE_DOMAIN (kiểm tra bằng hàm, không dùng '*')
const isAllowedOrigin = (origin: string): boolean => {
  if (origin === env.FRONTEND_URL) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === env.BASE_DOMAIN || hostname.endsWith(`.${env.BASE_DOMAIN}`);
  } catch {
    return false;
  }
};

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get('/', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    message: 'SmartEdu CRM API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// API nền tảng (Super Admin): không thuộc tenant nào, phải đặt trước resolveTenant
app.use('/api/platform', platformRoutes);
app.use('/api', resolveTenant);
app.use('/api', router);
app.use('/api', materialRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export { app };

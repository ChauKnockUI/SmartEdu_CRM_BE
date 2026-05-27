import express from 'express';
import cors from 'cors';
import { router } from './routes';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { requestLogger } from './middlewares/requestLogger.middleware';
import materialRoutes from './routes/material.routes';

const app = express();

app.use(cors({
  origin: env.FRONTEND_URL,
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

app.use('/api', router);
app.use('/uploads', express.static('uploads'));
app.use('/api', materialRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export { app };

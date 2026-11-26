import { Router, type RequestHandler } from 'express';
import { AsyncResource } from 'node:async_hooks';
import multer from 'multer';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { materialController } from '../controllers/material.controller';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
});
// Multer completes from stream events; bind its callback to this request's tenant context.
const receiveFile: RequestHandler = (req, res, next) => upload.single('file')(req, res, AsyncResource.bind((error?: unknown) => {
  if (error) {
    res.status(400).json({ success: false, message: error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 'File tối đa 20 MB.' : 'Chỉ được chọn một file hợp lệ.' });
    return;
  }
  next();
}));

router.get('/schedules/:scheduleId/materials', authenticate, authorize('admin', 'teacher', 'student'), materialController.getBySession);
router.get('/materials/:id/download', authenticate, authorize('admin', 'teacher', 'student'), materialController.download);

router.get(
  '/classes/:classId/materials',
  authenticate,
  authorize('admin', 'teacher', 'student'),
  materialController.getByClass
);

router.post(
  '/classes/:classId/materials',
  authenticate,
  authorize('admin', 'teacher'),
  receiveFile,
  materialController.upload
);

router.put(
  '/materials/:id',
  authenticate,
  authorize('admin', 'teacher'),
  receiveFile,
  materialController.update
);

router.delete('/materials/:id', authenticate, authorize('admin', 'teacher'), materialController.remove);

export default router;

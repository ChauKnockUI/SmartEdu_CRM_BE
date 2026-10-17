import { Router } from 'express';
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

router.get(
  '/classes/:classId/materials',
  authenticate,
  materialController.getByClass
);

router.post(
  '/classes/:classId/materials',
  authenticate,
  authorize('admin', 'teacher'),
  upload.single('file'),
  materialController.upload
);

router.put(
  '/materials/:id',
  authenticate,
  authorize('admin', 'teacher'),
  upload.single('file'),
  materialController.update
);

router.delete('/materials/:id', authenticate, authorize('admin', 'teacher'), materialController.remove);

export default router;
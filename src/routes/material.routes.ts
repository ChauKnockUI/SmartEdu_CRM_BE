import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middlewares/auth.middleware';
import { materialController } from '../controllers/material.controller';

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads/materials');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
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
  upload.single('file'),
  materialController.upload
);

router.put(
  '/materials/:id',
  authenticate,
  upload.single('file'),
  materialController.update
);

router.delete('/materials/:id', authenticate, materialController.remove);

export default router;
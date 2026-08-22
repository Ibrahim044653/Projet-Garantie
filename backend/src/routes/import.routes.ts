import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate, requireGestionnaire } from '../middleware/auth.middleware';
import { previewImport, confirmImport } from '../controllers/import.controller';

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format non supporté. Utilisez .csv, .xlsx ou .xls'));
    }
  },
});

export const importRouter = Router();

importRouter.use(authenticate);

importRouter.post('/preview', upload.single('file'), previewImport);
importRouter.post('/confirm', requireGestionnaire, confirmImport);

import { randomUUID } from 'crypto';
import express, { NextFunction, Request, Response, Router } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { authenticate, requirePermission } from '../modules/identity/middleware';
import { getMenuUploadsDirectory } from '../config/uploads';

const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export const menuUploadsRouter = Router();
menuUploadsRouter.use(authenticate());

menuUploadsRouter.post(
  '/image',
  requirePermission('admin:menus:manage'),
  express.raw({ type: [...ALLOWED_IMAGE_TYPES.keys()], limit: MAX_IMAGE_SIZE_BYTES }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const extension = ALLOWED_IMAGE_TYPES.get(contentType);

      if (!extension) {
        return res.status(415).json({
          success: false,
          error: { code: 'MENU_IMAGE_TYPE_UNSUPPORTED', message: 'Use a JPG, PNG, or WebP image.' },
        });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'MENU_IMAGE_REQUIRED', message: 'Choose an image to upload.' },
        });
      }

      if (req.body.length > MAX_IMAGE_SIZE_BYTES) {
        return res.status(413).json({
          success: false,
          error: { code: 'MENU_IMAGE_TOO_LARGE', message: 'Menu images must be 5 MB or smaller.' },
        });
      }

      const uploadDirectory = getMenuUploadsDirectory();
      await mkdir(uploadDirectory, { recursive: true });

      const filename = `${Date.now()}-${randomUUID()}.${extension}`;
      await writeFile(path.join(uploadDirectory, filename), req.body, { flag: 'wx' });

      return res.status(201).json({
        success: true,
        data: { url: `/uploads/menu/${filename}` },
      });
    } catch (error) {
      return next(error);
    }
  },
);

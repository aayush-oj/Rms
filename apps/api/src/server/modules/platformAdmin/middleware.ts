import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors';
import {
  PlatformAdminAuthService,
  platformAdminAuthService,
} from './authService';
import type { PlatformAdminSessionContext } from './types';
import { platformRequestToken } from './sessionCookies';

declare global {
  namespace Express {
    interface Request {
      platformAdmin?: PlatformAdminSessionContext;
    }
  }
}

export function authenticatePlatformAdmin(
  options: { allowTemporaryPassword?: boolean } = {},
  auth: PlatformAdminAuthService = platformAdminAuthService,
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = platformRequestToken(req);
      if (!token) {
        throw new UnauthorizedError(
          'Platform Admin authentication required',
          'PLATFORM_AUTH_REQUIRED'
        );
      }

      req.platformAdmin = await auth.resolveToken(token);
      if (
        req.platformAdmin.admin.mustChangePassword
        && !options.allowTemporaryPassword
      ) {
        throw new ForbiddenError(
          'A permanent Platform password must be set before accessing God View data.',
          'PLATFORM_PASSWORD_CHANGE_REQUIRED',
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

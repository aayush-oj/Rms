import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformAdminAuthService,
  platformAdminAuthService,
} from './authService';
import {
  PlatformAdminSessionService,
  platformAdminSessionService,
} from './sessionService';
import {
  clearPlatformSessionCookie,
  platformBearerToken,
  platformSessionCookieToken,
  setPlatformSessionCookie,
} from './sessionCookies';

export class PlatformAdminController {
  constructor(
    private readonly auth: PlatformAdminAuthService = platformAdminAuthService,
    private readonly sessions: PlatformAdminSessionService = platformAdminSessionService,
  ) {}

  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.auth.login(req.body);
      setPlatformSessionCookie(res, result.token, result.expiresAt);

      const response: ApiSuccessResponse = {
        success: true,
        data: {
          admin: result.admin,
          expiresAt: result.expiresAt,
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  public me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.platformAdmin!;
      const response: ApiSuccessResponse = {
        success: true,
        data: {
          admin: context.admin,
          session: {
            expiresAt: context.session.expiresAt,
          },
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  public logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tokens = new Set<string>();
      const bearer = platformBearerToken(req);
      const cookie = platformSessionCookieToken(req);
      if (bearer) tokens.add(bearer);
      if (cookie) tokens.add(cookie);

      const tokenIds = new Set<string>();
      for (const token of tokens) {
        try {
          tokenIds.add(this.auth.verifyToken(token).tokenId);
        } catch {
          // Logout must still clear the HttpOnly cookie if the token is expired,
          // malformed, from the restaurant realm, or already unusable.
        }
      }

      await Promise.all(
        [...tokenIds].map(tokenId => this.sessions.revoke(tokenId).catch(() => false))
      );

      clearPlatformSessionCookie(res);

      const response: ApiSuccessResponse = {
        success: true,
        data: { message: 'Platform Admin logged out successfully' },
      };
      res.status(200).json(response);
    } catch (error) {
      clearPlatformSessionCookie(res);
      next(error);
    }
  };

  public changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.platformAdmin!;
      await this.auth.changePassword({
        platformAdminId: context.admin.id,
        email: context.admin.email,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      });
      clearPlatformSessionCookie(res);
      const response: ApiSuccessResponse = {
        success: true,
        data: { message: 'Password updated. Sign in again with your new password.' },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const platformAdminController = new PlatformAdminController();

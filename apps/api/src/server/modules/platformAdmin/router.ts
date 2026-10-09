import { Router } from 'express';
import { getEnv } from '../../config/env';
import { rateLimit } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import { platformAdminController } from './controller';
import { authenticatePlatformAdmin } from './middleware';
import { platformAdminChangePasswordSchema, platformAdminLoginSchema } from './validation';
import { platformPasswordResetRouter } from './passwordReset';

const env = getEnv();

const platformLoginIpLimiter = rateLimit({
  keyPrefix: 'platform:auth:login:ip',
  windowMs: env.AUTH_LOGIN_WINDOW_MS,
  max: env.AUTH_LOGIN_MAX_ATTEMPTS,
});

const platformLoginIdentityLimiter = rateLimit({
  keyPrefix: 'platform:auth:login:email',
  windowMs: env.AUTH_LOGIN_WINDOW_MS,
  max: Math.max(3, Math.ceil(env.AUTH_LOGIN_MAX_ATTEMPTS / 2)),
  key: req => String(req.body?.email || '').trim().toLowerCase(),
});

export const platformAuthRouter = Router();

platformAuthRouter.use(platformPasswordResetRouter);

platformAuthRouter.post(
  '/login',
  platformLoginIpLimiter,
  platformLoginIdentityLimiter,
  validateRequest({ body: platformAdminLoginSchema }),
  platformAdminController.login,
);

platformAuthRouter.get(
  '/me',
  authenticatePlatformAdmin({ allowTemporaryPassword: true }),
  platformAdminController.me,
);

platformAuthRouter.post(
  '/change-password',
  authenticatePlatformAdmin({ allowTemporaryPassword: true }),
  validateRequest({ body: platformAdminChangePasswordSchema }),
  platformAdminController.changePassword,
);

// Logout deliberately does not require an active Platform Admin session.
// It must always be able to clear the scoped HttpOnly cookie, including after
// expiry, revocation, or account disablement.
platformAuthRouter.post('/logout', platformAdminController.logout);

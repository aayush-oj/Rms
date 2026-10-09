import { Router } from 'express';
import { identityController } from './controller';
import { directAuth } from './directAuth';
import { accessStatusController } from './accessStatusController';
import {
  organizationActivationRequestController,
} from '../activationRequests/controller';
import {
  submitActivationRequestSchema,
} from '../activationRequests/validation';
import { getEnv } from '../../config/env';
import { rateLimit } from '../../middleware/rateLimit';
import { authenticate, authenticateAccessStatus, requirePermission, requireBranchAccess } from './middleware';
import { validateRequest } from '../../middleware/validate';
import { roleManagementController, createRoleSchema, updateRoleSchema } from './roleManagement';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  handleSuggestionsSchema,
  handleAvailabilitySchema,
  switchBranchSchema,
  updateOrgSchema,
  createBranchSchema,
  updateBranchSchema,
  createUserSchema,
  updateUserSchema,
} from './validation';

const env = getEnv();
const registrationLimiter = rateLimit({ keyPrefix: 'auth:register', windowMs: env.AUTH_REGISTER_WINDOW_MS, max: env.AUTH_REGISTER_MAX_ATTEMPTS });
const loginIpLimiter = rateLimit({
  keyPrefix: 'auth:login:ip',
  windowMs: env.AUTH_LOGIN_WINDOW_MS,
  max: env.AUTH_LOGIN_MAX_ATTEMPTS,
});
const loginIdentityLimiter = rateLimit({
  keyPrefix: 'auth:login:username',
  windowMs: env.AUTH_LOGIN_WINDOW_MS,
  max: Math.max(3, Math.ceil(env.AUTH_LOGIN_MAX_ATTEMPTS / 2)),
  key: req => String(req.body?.username || '').trim().toLowerCase(),
});
const handleSuggestionLimiter = rateLimit({
  keyPrefix: 'auth:handle-suggestions',
  windowMs: 10 * 60 * 1000,
  max: 30,
});
const changePasswordLimiter = rateLimit({
  keyPrefix: 'auth:change-password',
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: req => `${req.ip}:${req.user?.id ?? 'unknown'}`,
});

export const authRouter = Router();
authRouter.post('/handle-suggestions', handleSuggestionLimiter, validateRequest({ body: handleSuggestionsSchema }), directAuth.handleSuggestions);
authRouter.post('/handle-availability', handleSuggestionLimiter, validateRequest({ body: handleAvailabilitySchema }), directAuth.handleAvailability);
authRouter.post('/register', registrationLimiter, validateRequest({ body: registerSchema }), directAuth.register);
authRouter.post('/login', loginIpLimiter, loginIdentityLimiter, validateRequest({ body: loginSchema }), directAuth.login);
authRouter.get('/me', authenticate(), directAuth.me);
authRouter.post(
  '/change-password',
  authenticate(),
  changePasswordLimiter,
  validateRequest({ body: changePasswordSchema }),
  directAuth.changePassword,
);
authRouter.get('/access-status', authenticateAccessStatus(), accessStatusController.me);
authRouter.get(
  '/activation-request',
  authenticateAccessStatus(),
  organizationActivationRequestController.current,
);
authRouter.post(
  '/activation-request',
  authenticateAccessStatus(),
  validateRequest({ body: submitActivationRequestSchema }),
  organizationActivationRequestController.submit,
);
authRouter.post('/switch-branch', authenticate(), validateRequest({ body: switchBranchSchema }), identityController.switchBranch);
authRouter.post('/logout', identityController.logout);
authRouter.post('/lock-staff', authenticate(), identityController.lockStaff);

export const organizationsRouter = Router();
organizationsRouter.use(authenticate());
organizationsRouter.get('/current', identityController.getCurrentOrganization);
organizationsRouter.patch(
  '/current',
  requirePermission('admin:org:manage'),
  validateRequest({ body: updateOrgSchema }),
  identityController.updateCurrentOrganization
);

organizationsRouter.post(
  '/current/starter-pack/dismiss',
  requirePermission('admin:org:manage'),
  identityController.dismissStarterPackWelcome
);
organizationsRouter.delete(
  '/current/starter-pack/samples',
  requirePermission('admin:org:manage'),
  identityController.removeStarterPackSamples
);

export const branchesRouter = Router();
branchesRouter.use(authenticate());
branchesRouter.get('/', identityController.listBranches);
branchesRouter.post(
  '/',
  requirePermission('admin:branches:manage'),
  validateRequest({ body: createBranchSchema }),
  identityController.createBranch
);
branchesRouter.get('/:id', requireBranchAccess, identityController.getBranch);
branchesRouter.patch(
  '/:id',
  requirePermission('admin:branches:manage'),
  validateRequest({ body: updateBranchSchema }),
  identityController.updateBranch
);

export const usersRouter = Router();
usersRouter.use(authenticate());
usersRouter.get('/', requirePermission('admin:users:manage'), identityController.listUsers);
usersRouter.post(
  '/',
  requirePermission('admin:users:manage'),
  validateRequest({ body: createUserSchema }),
  directAuth.createUser
);
usersRouter.get('/:id', requirePermission('admin:users:manage'), identityController.getUser);
usersRouter.patch(
  '/:id',
  requirePermission('admin:users:manage'),
  validateRequest({ body: updateUserSchema }),
  directAuth.updateUser
);

export const rolesRouter = Router();
rolesRouter.use(authenticate());
rolesRouter.get('/', identityController.listRoles);
rolesRouter.post(
  '/',
  requirePermission('admin:roles:manage'),
  validateRequest({ body: createRoleSchema }),
  roleManagementController.create
);
rolesRouter.patch(
  '/:id',
  requirePermission('admin:roles:manage'),
  validateRequest({ body: updateRoleSchema }),
  roleManagementController.update
);

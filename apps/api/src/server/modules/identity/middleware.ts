import { Request, Response, NextFunction } from 'express';
import { authService, AuthService } from './authService';
import { AuthContext, SYSTEM_ROLES } from './types';
import { UnauthorizedError, ForbiddenError } from '../../shared/errors';
import { cookieToken } from './sessionCookies';
import { accessStatusAuthService, type AccessStatusContext } from './accessStatusAuth';

declare global {
  namespace Express {
    interface Request {
      user?: AuthContext;
      accessStatus?: AccessStatusContext;
    }
  }
}

async function authenticateContext(req: Request, auth: AuthService, preferred?: 'ACCOUNT' | 'STAFF'): Promise<AuthContext> {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7).trim();
  if (!token && preferred) token = cookieToken(req, preferred);
  if (!token && !preferred) token = cookieToken(req, 'STAFF') || cookieToken(req, 'ACCOUNT');
  if (!token) throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');
  return auth.resolveAuthContext(auth.verifyToken(token));
}

export function authenticateAccessStatus() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      let token: string | null = null;
      if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7).trim();
      if (!token) token = cookieToken(req, 'ACCESS_STATUS');
      if (!token) throw new UnauthorizedError('Access-status authentication required', 'ACCESS_STATUS_AUTH_REQUIRED');
      const claims = accessStatusAuthService.verifyToken(token);
      req.accessStatus = await accessStatusAuthService.resolve(claims);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function authenticateAny(auth: AuthService = authService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.headers.authorization?.startsWith('Bearer ')) {
        req.user = await authenticateContext(req, auth);
      } else {
        const staff = cookieToken(req, 'STAFF');
        if (staff) {
          try { req.user = await authenticateContext(req, auth, 'STAFF'); }
          catch { req.user = await authenticateContext(req, auth, 'ACCOUNT'); }
        } else {
          req.user = await authenticateContext(req, auth, 'ACCOUNT');
        }
      }
      next();
    } catch (err) { next(err); }
  };
}

/** @deprecated Direct RMS sign-in now issues a staff session immediately. */
export function authenticateAccount(auth: AuthService = authService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = await authenticateContext(req, auth, 'ACCOUNT');
      if (context.authLevel !== 'ACCOUNT') throw new ForbiddenError('Account authentication is required', 'ACCOUNT_AUTH_REQUIRED');
      req.user = context;
      next();
    } catch (err) { next(err); }
  };
}

export function authenticate(auth: AuthService = authService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = await authenticateContext(req, auth, 'STAFF');
      if (context.authLevel !== 'STAFF') throw new ForbiddenError('Staff authentication is required', 'STAFF_AUTH_REQUIRED');
      const expectedContext = req.headers['x-rms-context'];
      if (expectedContext && expectedContext !== `${context.organizationId}:${context.activeBranchId}:${context.id}`) {
        throw new ForbiddenError('Queued action belongs to a different account or branch', 'OFFLINE_SCOPE_MISMATCH');
      }
      req.user = context;
      next();
    } catch (err) { next(err); }
  };
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));
    if (req.user.role === SYSTEM_ROLES.OWNER || req.user.permissions.includes('admin:all')) return next();
    const hasPermission = permissions.some(permission => req.user?.permissions.includes(permission));
    if (!hasPermission) {
      return next(new ForbiddenError(
        `Action requires one of the following permissions: [${permissions.join(', ')}]`,
        'FORBIDDEN_PERMISSION',
        { requiredPermissions: permissions, userPermissions: req.user.permissions }
      ));
    }
    next();
  };
}

/** @deprecated Prefer requirePermission() for feature authorization. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));
    if (req.user.role === SYSTEM_ROLES.OWNER) return next();
    const hasRole = roles.map(role => role.toUpperCase()).includes(req.user.role.toUpperCase());
    if (!hasRole) {
      return next(new ForbiddenError(
        `Action requires one of the following roles: [${roles.join(', ')}]`,
        'FORBIDDEN_ROLE',
        { requiredRoles: roles, userRole: req.user.role }
      ));
    }
    next();
  };
}

export function requireBranchAccess(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));
  const branchIdParam = req.params.branchId || req.params.id;
  const branchId = branchIdParam ? parseInt(branchIdParam, 10) : undefined;
  if (branchId !== undefined && !Number.isNaN(branchId)) {
    if (req.user.role === SYSTEM_ROLES.OWNER || req.user.permissions.includes('admin:branches:manage')) return next();
    if (!req.user.allowedBranchIds.includes(branchId)) {
      return next(new ForbiddenError(`You do not have authorization to access branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS'));
    }
  }
  next();
}

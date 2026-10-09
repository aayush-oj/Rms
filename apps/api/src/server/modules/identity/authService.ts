import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getEnv } from '../../config/env';
import { identityRepository, IdentityRepository } from './repository';
import {
  OrganizationAccessService,
  organizationAccessService,
} from '../organizationAccess/service';
import {
  AuthClaims,
  AuthContext,
  AuthResult,
  SYSTEM_ROLES,
} from './types';
import {
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '../../shared/errors';

export class AuthService {
  constructor(
    private repo: IdentityRepository = identityRepository,
    private organizationAccess: OrganizationAccessService = organizationAccessService,
  ) {}

  public async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  public async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  public async hashPin(pin: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(pin, saltRounds);
  }

  public async verifyPin(pin: string, hash: string): Promise<boolean> {
    return bcrypt.compare(pin, hash);
  }

  public generateToken(claims: AuthClaims): string {
    const env = getEnv();
    return jwt.sign(claims, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as any,
    });
  }

  public verifyToken(token: string): AuthClaims {
    const env = getEnv();
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as Partial<AuthClaims>;
      if (
        (decoded.authLevel !== 'ACCOUNT' && decoded.authLevel !== 'STAFF')
        || !Number.isInteger(decoded.userId)
        || !Number.isInteger(decoded.organizationId)
        || !Number.isInteger(decoded.activeBranchId)
        || !Number.isInteger(decoded.roleId)
        || typeof decoded.role !== 'string'
        || typeof decoded.username !== 'string'
        || typeof decoded.tokenId !== 'string'
        || !decoded.tokenId
      ) {
        throw new Error('invalid operational auth claims');
      }
      return decoded as AuthClaims;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token', 'TOKEN_INVALID');
    }
  }

  /**
   * Web Login (Username or Email + Password)
   */
  public async login(params: {
    identifier: string;
    password: string;
  }): Promise<AuthResult> {
    const user = await this.repo.findUserByUsernameOrEmailGlobal(params.identifier);
    if (!user) {
      throw new UnauthorizedError('Invalid username or password', 'INVALID_CREDENTIALS');
    }


    if (!user.isActive) {
      throw new ForbiddenError('User account is deactivated. Contact organization admin.', 'ACCOUNT_DEACTIVATED');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedError('User does not have a web password configured', 'NO_PASSWORD_SET');
    }

    const isValidPassword = await this.verifyPassword(params.password, user.passwordHash);
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid username or password', 'INVALID_CREDENTIALS');
    }

    const org = await this.repo.findOrganizationById(user.organizationId);
    if (!org || org.status !== 'ACTIVE') {
      throw new ForbiddenError('Organization is suspended or not found', 'ORGANIZATION_INACTIVE');
    }

    const branch = await this.repo.findBranchById(org.id, user.defaultBranchId);
    if (!branch) {
      throw new NotFoundError('User default branch not found', 'BRANCH_NOT_FOUND');
    }

    const role = await this.repo.getRoleById(user.roleId, org.id);
    const roleName = role ? role.name : user.roleName;
    const permissions = role ? role.permissions : [];
    const allowedBranchIds = await this.repo.getUserAllowedBranchIds(user.id, org.id);

    const tokenId = crypto.randomUUID();
    const token = this.generateToken({
      userId: user.id,
      organizationId: org.id,
      activeBranchId: branch.id,
      role: roleName,
      roleId: user.roleId,
      username: user.username,
      tokenId,
      authLevel: 'ACCOUNT',
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.repo.createSession(tokenId, user.id, org.id, expiresAt);

    return {
      user: {
        id: user.id,
        organizationId: org.id,
        defaultBranchId: branch.id,
        activeBranchId: branch.id,
        role: roleName,
        name: user.name,
        username: user.username,
        email: user.email,
        permissions,
        allowedBranchIds,
        mustChangePin: user.mustChangePin,
      },
      organization: {
        id: org.id,
        name: org.name,
        currencyCode: org.currencyCode,
        status: org.status,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        billPrefix: branch.billPrefix,
        timezone: branch.timezone,
      },
      token,
      expiresIn: '24h',
    };
  }

  /**
   * Staff PIN Login after account-level authentication.
   */
  public async terminalLogin(params: {
    pin: string;
    branchId?: number;
    accountContext: AuthContext;
  }): Promise<AuthResult> {
    if (params.accountContext.authLevel !== 'ACCOUNT') {
      throw new ForbiddenError('Account authentication is required before staff access', 'ACCOUNT_AUTH_REQUIRED');
    }
    if (!/^\d{4,6}$/.test(params.pin)) {
      throw new BadRequestError('PIN must be 4 to 6 numeric digits', 'INVALID_PIN_FORMAT');
    }

    const orgId = params.accountContext.organizationId;
    const branchId = params.branchId ?? params.accountContext.activeBranchId;
    const allowedAccountBranches = params.accountContext.allowedBranchIds;

    if (!allowedAccountBranches.includes(branchId) && params.accountContext.role !== SYSTEM_ROLES.OWNER && !params.accountContext.permissions.includes('admin:all')) {
      throw new ForbiddenError('You do not have access to this branch', 'UNAUTHORIZED_BRANCH_ACCESS');
    }

    const org = await this.repo.findOrganizationById(orgId);
    if (!org || org.status !== 'ACTIVE') {
      throw new ForbiddenError('Organization is not active', 'ORGANIZATION_INACTIVE');
    }
    const branch = await this.repo.findBranchById(org.id, branchId);
    if (!branch || !branch.isActive) {
      throw new NotFoundError('Branch not found or inactive', 'BRANCH_NOT_FOUND');
    }

    let pinUser: any = null;
    {
      const users = await this.repo.findUsersByOrgId(org.id);
      for (const candidate of users) {
        if (!candidate.isActive) continue;
        const fullUser = await this.repo.findUserById(org.id, candidate.id);
        if (!fullUser?.pinHash) continue;
        const allowedBranches = await this.repo.getUserAllowedBranchIds(candidate.id, org.id);
        if (!allowedBranches.includes(branch.id) && fullUser.defaultBranchId !== branch.id) continue;
        if (await this.verifyPin(params.pin, fullUser.pinHash)) {
          pinUser = fullUser;
          break;
        }
      }
    }

    if (!pinUser) {
      throw new UnauthorizedError('Incorrect PIN. Please try again.', 'INVALID_PIN');
    }

    const role = await this.repo.getRoleById(pinUser.roleId, org.id);
    const roleName = role ? role.name : pinUser.roleName;
    const permissions = role ? role.permissions : [];
    const allowedBranchIds = await this.repo.getUserAllowedBranchIds(pinUser.id, org.id);

    const tokenId = crypto.randomUUID();
    const token = this.generateToken({
      userId: pinUser.id,
      organizationId: org.id,
      activeBranchId: branch.id,
      role: roleName,
      roleId: pinUser.roleId,
      username: pinUser.username,
      tokenId,
      authLevel: 'STAFF',
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.repo.createSession(tokenId, pinUser.id, org.id, expiresAt);

    return {
      user: {
        id: pinUser.id,
        organizationId: org.id,
        defaultBranchId: pinUser.defaultBranchId,
        activeBranchId: branch.id,
        role: roleName,
        name: pinUser.name,
        username: pinUser.username,
        email: pinUser.email,
        permissions,
        allowedBranchIds,
        mustChangePin: pinUser.mustChangePin,
      },
      organization: {
        id: org.id,
        name: org.name,
        currencyCode: org.currencyCode,
        status: org.status,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        billPrefix: branch.billPrefix,
        timezone: branch.timezone,
      },
      token,
      expiresIn: '24h',
    };
  }

  /**
   * Switch Active Branch within Organization
   */
  public async switchActiveBranch(userContext: AuthContext, targetBranchId: number): Promise<{
    activeBranch: {
      id: number;
      name: string;
      code: string;
      billPrefix: string;
      timezone: string;
    };
    token: string;
  }> {
    // 1. Verify target branch belongs to user's organization
    const branch = await this.repo.findBranchById(userContext.organizationId, targetBranchId);
    if (!branch) {
      throw new NotFoundError(`Branch #${targetBranchId} not found in this organization`, 'BRANCH_NOT_FOUND');
    }

    if (!branch.isActive) {
      throw new ForbiddenError(`Branch "${branch.name}" is inactive`, 'BRANCH_INACTIVE');
    }

    // 2. Verify user has branch access
    const allowed = await this.repo.getUserAllowedBranchIds(userContext.id, userContext.organizationId);
    const hasAccess = allowed.includes(targetBranchId) || userContext.permissions.includes('admin:all') || userContext.role === SYSTEM_ROLES.OWNER;
    if (!hasAccess) {
      throw new ForbiddenError(`You do not have access permissions for branch "${branch.name}"`, 'FORBIDDEN_BRANCH_ACCESS');
    }

    // 3. Issue new JWT token with updated activeBranchId
    const newTokenId = crypto.randomUUID();
    const token = this.generateToken({
      userId: userContext.id,
      organizationId: userContext.organizationId,
      activeBranchId: branch.id,
      role: userContext.role,
      roleId: userContext.roleId,
      username: userContext.username,
      tokenId: newTokenId,
      authLevel: 'STAFF',
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.repo.createSession(newTokenId, userContext.id, userContext.organizationId, expiresAt);
    if (userContext.tokenId && userContext.tokenId !== newTokenId) await this.repo.revokeSession(userContext.tokenId);

    return {
      activeBranch: {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        billPrefix: branch.billPrefix,
        timezone: branch.timezone,
      },
      token,
    };
  }

  /**
   * Invalidate / Revoke Token
   */
  public async logout(tokenId: string): Promise<void> {
    await this.repo.revokeSession(tokenId);
  }

  /**
   * Resolve Full Auth Context from Claims
   */
  public async resolveAuthContext(claims: AuthClaims): Promise<AuthContext> {
    const isRevoked = await this.repo.isSessionRevoked(claims.tokenId);
    if (isRevoked) {
      throw new UnauthorizedError('Session has been revoked or logged out', 'SESSION_REVOKED');
    }

    const user = await this.repo.findUserById(claims.organizationId, claims.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account not found or inactive', 'USER_INACTIVE');
    }

    const org = await this.repo.findOrganizationById(claims.organizationId);
    if (!org) {
      throw new UnauthorizedError(
        'Organization for this session is unavailable',
        'SESSION_ORGANIZATION_INVALID',
      );
    }

    // Platform entitlement is the authoritative operational access gate for
    // authenticated restaurant requests. Legacy organizations.status remains
    // present temporarily for login compatibility, but it no longer decides
    // whether an already-authenticated request may enter business logic.
    await this.organizationAccess.assertOperationalAccess(org.id);

    const role = await this.repo.getRoleById(user.roleId, org.id);
    const rolePermissions = role ? role.permissions : [];
    const allowedBranchIds = await this.repo.getUserAllowedBranchIds(user.id, org.id);
    const activeBranch = await this.repo.findBranchById(org.id, claims.activeBranchId);
    if (!activeBranch || !activeBranch.isActive) {
      throw new UnauthorizedError('Session branch is no longer available', 'SESSION_BRANCH_INVALID');
    }
    const resolvedRoleName = role ? role.name : user.roleName;
    if (resolvedRoleName !== SYSTEM_ROLES.OWNER && !allowedBranchIds.includes(claims.activeBranchId)) {
      throw new UnauthorizedError('Session branch access has been revoked', 'SESSION_BRANCH_REVOKED');
    }

    // Fetch user permission overrides
    const userOverrides = await this.repo.getUserPermissionOverrides(user.id, org.id);

    // Compute effective permissions using precedence model:
    // 1. OWNER → all permissions (superuser bypass)
    // 2. Explicit user DENIED → denied
    // 3. Explicit user GRANTED → granted
    // 4. Role permission → granted
    // 5. Otherwise → denied (deny-by-default)
    const effectivePermissions: string[] = [];
    const roleName = resolvedRoleName;

    if (roleName === SYSTEM_ROLES.OWNER) {
      // OWNER gets all permissions (superuser bypass, not affected by DENIED overrides)
      effectivePermissions.push(
        'admin:all', 'admin:org:manage', 'admin:branches:manage', 'admin:users:manage',
        'admin:roles:manage', 'admin:tables:manage', 'admin:hardware:manage', 'admin:taxes:manage',
        'admin:payments:manage', 'admin:units:manage', 'admin:settings:manage', 'admin:menus:manage',
        'admin:system:status', 'dashboard:view', 'pos:orders:create', 'pos:orders:view',
        'pos:orders:void', 'pos:tables:manage', 'pos:tables:allocate', 'pos:billing:settle',
        'pos:discounts:apply', 'kitchen:tickets:view', 'kitchen:tickets:update', 'bar:tickets:view',
        'bar:tickets:update', 'inventory:view', 'inventory:manage', 'reports:view',
        'businessday:view', 'businessday:open', 'businessday:close', 'shift:view', 'shift:open', 'shift:close', 'shift:cash:manage', 'shift:reconcile', 'admin:registers:manage',
      );
    } else {
      // Non-OWNER: apply precedence model
      const allPermissionCodes = new Set([...rolePermissions, ...userOverrides.keys()]);

      for (const perm of allPermissionCodes) {
        const override = userOverrides.get(perm);
        if (override === 'DENIED') continue;                    // Explicit deny wins
        if (override === 'GRANTED') { effectivePermissions.push(perm); continue; }
        if (rolePermissions.includes(perm)) { effectivePermissions.push(perm); continue; }
        // No role permission, no override → denied by default
      }
    }

    return {
      id: user.id,
      organizationId: org.id,
      activeBranchId: claims.activeBranchId,
      allowedBranchIds,
      role: roleName,
      roleId: user.roleId,
      permissions: effectivePermissions,
      username: user.username,
      email: user.email,
      name: user.name,
      mustChangePin: user.mustChangePin,
      tokenId: claims.tokenId,
      authLevel: claims.authLevel,
    };
  }

  /**
   * Change a user's PIN. Requires current PIN verification.
   */
  public async changePin(
    userContext: { organizationId: number; id: number; tokenId?: string; accountTokenId?: string },
    params: { currentPin: string; newPin: string }
  ): Promise<void> {
    const user = await this.repo.findUserById(userContext.organizationId, userContext.id);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Verify current PIN
    if (user.pinHash) {
      const currentValid = await this.verifyPin(params.currentPin, user.pinHash);
      if (!currentValid) {
        throw new UnauthorizedError('Current PIN is incorrect', 'INVALID_CURRENT_PIN');
      }
    }

    // Hash new PIN
    const newPinHash = await this.hashPin(params.newPin);

    // Update pin_hash and set must_change_pin = false
    await this.repo.updateUserPin(userContext.organizationId, userContext.id, newPinHash, false, userContext.tokenId, userContext.accountTokenId);
  }
}

export const authService = new AuthService();

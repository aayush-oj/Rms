import { Request, Response, NextFunction } from 'express';
import { authService, AuthService } from './authService';
import { identityRepository, IdentityRepository } from './repository';
import { ApiSuccessResponse } from '../../shared/types';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '../../shared/errors';
import { SYSTEM_ROLES } from './types';
import { alertRepository } from '../alerts/repository';
import { administrationRepository } from '../administration/repository';
import { browserSafeAuthResult, clearSessionCookie, cookieToken, setSessionCookie } from './sessionCookies';
import { accessStatusAuthService } from './accessStatusAuth';

export class IdentityController {
  constructor(
    private auth: AuthService = authService,
    private repo: IdentityRepository = identityRepository
  ) {}

  private async ensureUserManagementScope(req: Request, targetUserId: number): Promise<void> {
    if (!req.user || targetUserId === req.user.id || req.user.role === SYSTEM_ROLES.OWNER || req.user.permissions.includes('admin:all') || req.user.permissions.includes('admin:branches:manage')) return;
    const target = await this.repo.findUserById(req.user.organizationId, targetUserId);
    if (!target) return;
    const targetBranches = await this.repo.getUserAllowedBranchIds(targetUserId, req.user.organizationId);
    if (!targetBranches.some(branchId => req.user!.allowedBranchIds.includes(branchId))) {
      throw new ForbiddenError('Staff member is outside your authorized branches', 'STAFF_SCOPE_FORBIDDEN');
    }
  }

  // ==========================================
  // AUTHENTICATION
  // ==========================================

  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.auth.login(req.body);
      const response: ApiSuccessResponse = {
        success: true,
        data: browserSafeAuthResult(result),
      };
      setSessionCookie(res, 'ACCOUNT', result.token);
      clearSessionCookie(res, 'STAFF');
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public terminalLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const account = req.user!;
    const branchId = Number(req.body?.branchId ?? account.activeBranchId);
    try {
      const result = await this.auth.terminalLogin({ ...req.body, accountContext: account });
      try {
        await alertRepository.clearAuthFailures(account.organizationId, branchId, account.id, 'TERMINAL_PIN');
        const { alertService } = await import('../alerts/service');
        await alertService.resolveCondition(account.organizationId, branchId, `SECURITY_AUTH_FAILURE:TERMINAL_PIN:${account.id}`);
      } catch {
        // Alerting must never turn a valid staff authentication into a failed login.
      }
      const response: ApiSuccessResponse = {
        success: true,
        data: browserSafeAuthResult(result),
      };
      setSessionCookie(res, 'STAFF', result.token);
      res.status(200).json(response);
    } catch (err: any) {
      if (err?.errorCode === 'INVALID_PIN' && Number.isInteger(branchId) && branchId > 0) {
        try {
          const count = await alertRepository.recordAuthFailure(account.organizationId, branchId, account.id, 'TERMINAL_PIN');
          if (count >= 5) {
            const { alertService } = await import('../alerts/service');
            await alertService.open({
              organizationId: account.organizationId,
              branchId,
              dedupKey: `SECURITY_AUTH_FAILURE:TERMINAL_PIN:${account.id}`,
              type: 'SECURITY_AUTH_FAILURE',
              category: 'SECURITY',
              severity: count >= 10 ? 'CRITICAL' : 'WARNING',
              title: 'Repeated failed staff PIN attempts',
              message: `${count} failed staff PIN attempts were recorded within the current 10-minute window.`,
              entityType: 'user',
              entityId: account.id,
              audienceType: 'PERMISSION_GROUP',
              audienceReference: 'alerts.security.view',
              metadata: { failureType: 'TERMINAL_PIN', failureCount: count },
            });
          }
        } catch {
          // Authentication failure response must not be replaced by alerting infrastructure failure.
        }
      }
      next(err);
    }
  };

  public me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const org = await this.repo.findOrganizationById(user.organizationId);
      const activeBranch = await this.repo.findBranchById(user.organizationId, user.activeBranchId);
      const branches = await this.repo.findBranchesByOrgId(user.organizationId);
      const allowedBranches = branches.filter(b => user.allowedBranchIds.includes(b.id));

      const response: ApiSuccessResponse = {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            role: user.role,
            roleId: user.roleId,
            permissions: user.permissions,
            mustChangePin: user.mustChangePin,
            authLevel: user.authLevel,
          },
          organization: org,
          activeBranch,
          allowedBranches,
        },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public switchBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetBranchId = req.body.targetBranchId;
      const result = await this.auth.switchActiveBranch(req.user!, targetBranchId);
      const response: ApiSuccessResponse = {
        success: true,
        data: browserSafeAuthResult(result),
      };
      setSessionCookie(res, 'STAFF', result.token);
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const operationalTokenIds = new Set<string>();
      for (const kind of ['STAFF', 'ACCOUNT'] as const) {
        const token = cookieToken(req, kind);
        if (!token) continue;
        try { operationalTokenIds.add(this.auth.verifyToken(token).tokenId); } catch {}
      }

      const accessStatusToken = cookieToken(req, 'ACCESS_STATUS');
      let accessStatusTokenId: string | null = null;
      if (accessStatusToken) {
        try {
          accessStatusTokenId = accessStatusAuthService.verifyToken(accessStatusToken).tokenId;
        } catch {
          accessStatusTokenId = null;
        }
      }

      await Promise.all([
        ...[...operationalTokenIds].map(tokenId => this.auth.logout(tokenId)),
        ...(accessStatusTokenId ? [accessStatusAuthService.revoke(accessStatusTokenId)] : []),
      ]);

      clearSessionCookie(res, 'STAFF');
      clearSessionCookie(res, 'ACCOUNT');
      clearSessionCookie(res, 'ACCESS_STATUS');

      const response: ApiSuccessResponse = {
        success: true,
        data: { message: 'Logged out successfully' },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public lockStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.user?.tokenId) await this.auth.logout(req.user.tokenId);
      clearSessionCookie(res, 'STAFF');
      res.status(200).json({ success: true, data: { message: 'Staff session locked' } } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };

  public changePin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let accountTokenId: string | undefined;
      const accountToken = cookieToken(req, 'ACCOUNT');
      if (accountToken) {
        try {
          const account = await this.auth.resolveAuthContext(this.auth.verifyToken(accountToken));
          if (account.authLevel === 'ACCOUNT' && account.id === req.user!.id && account.organizationId === req.user!.organizationId) accountTokenId = account.tokenId;
        } catch { /* An expired account cookie must not prevent an authenticated PIN change. */ }
      }
      await this.auth.changePin(
        { organizationId: req.user!.organizationId, id: req.user!.id, tokenId: req.user!.tokenId, accountTokenId },
        req.body
      );
      const response: ApiSuccessResponse = {
        success: true,
        data: { message: 'PIN changed successfully' },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // ORGANIZATION MANAGEMENT (Tenant Isolation)
  // ==========================================

  public getCurrentOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const org = await this.repo.findOrganizationById(req.user!.organizationId);
      if (!org) {
        throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
      }

      const response: ApiSuccessResponse = {
        success: true,
        data: org,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateCurrentOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await this.repo.updateOrganization(req.user!.organizationId, req.body);
      if (!updated) {
        throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
      }

      const response: ApiSuccessResponse = {
        success: true,
        data: updated,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };


  public dismissStarterPackWelcome = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await administrationRepository.dismissStarterWelcome(req.user!.organizationId);
      res.status(200).json({ success: true, data: { welcomePending: false } } as ApiSuccessResponse);
    } catch (err) {
      next(err);
    }
  };

  public removeStarterPackSamples = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await administrationRepository.removeStarterSamples(req.user!.organizationId);
      res.status(200).json({ success: true, data: result } as ApiSuccessResponse);
    } catch (err) {
      next(err);
    }
  };


  // ==========================================
  // BRANCH MANAGEMENT (Strict Tenant Isolation)
  // ==========================================

  public listBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const allBranches = await this.repo.findBranchesByOrgId(orgId);

      // If OWNER or has admin:branches:manage, view all branches in tenant
      // Otherwise view only branches assigned to user
      const isPrivileged = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:branches:manage');
      const branches = isPrivileged
        ? allBranches
        : allBranches.filter(b => req.user!.allowedBranchIds.includes(b.id));

      const response: ApiSuccessResponse = {
        success: true,
        data: branches,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;

      // Check code uniqueness inside organization
      const existing = await this.repo.findBranchByCode(orgId, req.body.code);
      if (existing) {
        throw new ConflictError(`Branch code "${req.body.code}" is already in use in your organization`);
      }

      const branch = await this.repo.createBranch({
        organizationId: orgId,
        name: req.body.name,
        code: req.body.code,
        address: req.body.address,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        phone: req.body.phone,
        email: req.body.email,
        billPrefix: req.body.billPrefix,
      });

      try {
        await administrationRepository.seedBranchDefaults(orgId, branch.id, req.user!.id);
      } catch {
        // Provisioning is idempotent and can be repaired through the branch baseline endpoint.
      }

      const response: ApiSuccessResponse = {
        success: true,
        data: branch,
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const branchId = parseInt(req.params.id, 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Invalid branch ID');
      }

      const branch = await this.repo.findBranchById(orgId, branchId);
      if (!branch) {
        throw new NotFoundError(`Branch #${branchId} not found in this organization`, 'BRANCH_NOT_FOUND');
      }

      const response: ApiSuccessResponse = {
        success: true,
        data: branch,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const branchId = parseInt(req.params.id, 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Invalid branch ID');
      }

      if (req.body.code) {
        const existing = await this.repo.findBranchByCode(orgId, req.body.code);
        if (existing && existing.id !== branchId) {
          throw new ConflictError(`Branch code "${req.body.code}" is already in use`);
        }
      }

      const updated = await this.repo.updateBranch(orgId, branchId, req.body);
      if (!updated) {
        throw new NotFoundError(`Branch #${branchId} not found in this organization`, 'BRANCH_NOT_FOUND');
      }

      const response: ApiSuccessResponse = {
        success: true,
        data: updated,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // USER MANAGEMENT (Strict Tenant Isolation)
  // ==========================================

  public listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const users = await this.repo.findUsersByOrgId(orgId);
      const branchAdmin = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:branches:manage') || req.user!.permissions.includes('admin:all');
      const scopedUsers = branchAdmin ? users : (await Promise.all(users.map(async (user) => ({ user, branches: await this.repo.getUserAllowedBranchIds(user.id, orgId) })))).filter(x => x.branches.some(branchId => req.user!.allowedBranchIds.includes(branchId))).map(x => x.user);
      const safeUsers = await Promise.all(scopedUsers.map(async (user) => {
        const { passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user as any;
        const allowedBranchIds = await this.repo.getUserAllowedBranchIds(user.id, orgId);
        return { ...safeUser, allowedBranchIds };
      }));

      const response: ApiSuccessResponse = {
        success: true,
        data: safeUsers,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;

      // Verify username uniqueness within organization
      const existing = await this.repo.findUserByUsername(orgId, req.body.username);
      if (existing) {
        throw new ConflictError(`Username "${req.body.username}" is already taken in your organization`);
      }

      // Verify default branch exists in tenant
      const branch = await this.repo.findBranchById(orgId, req.body.defaultBranchId);
      if (!branch) {
        throw new NotFoundError(`Branch #${req.body.defaultBranchId} does not exist in your organization`);
      }

      // Verify role exists
      const role = await this.repo.getRoleById(req.body.roleId, orgId);
      if (!role) {
        throw new NotFoundError(`Role #${req.body.roleId} not found`);
      }

      // Privilege check: Only OWNER can assign OWNER or FB_MANAGER roles
      if (req.user!.role !== SYSTEM_ROLES.OWNER && !req.user!.permissions.includes('admin:all') && role.permissions.some(permission => !req.user!.permissions.includes(permission))) {
        throw new ForbiddenError('You cannot assign a role containing permissions you do not possess', 'ROLE_ASSIGNMENT_ESCALATION');
      }
      if (role.name === SYSTEM_ROLES.OWNER || role.name === SYSTEM_ROLES.FB_MANAGER) {
        if (req.user!.role !== SYSTEM_ROLES.OWNER) {
          throw new ForbiddenError(
            `Only organization OWNER can assign ${role.name} role`,
            'PRIVILEGE_ESCALATION'
          );
        }
      }

      // Branch authorization check for creator
      const isBranchAdmin = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:branches:manage');
      if (!isBranchAdmin) {
        if (!req.user!.allowedBranchIds.includes(req.body.defaultBranchId)) {
          throw new ForbiddenError('Cannot assign a default branch outside your authorized branches', 'FORBIDDEN_BRANCH_ASSIGNMENT');
        }
        if (req.body.allowedBranchIds && Array.isArray(req.body.allowedBranchIds)) {
          const hasUnauthorized = req.body.allowedBranchIds.some((bId: number) => !req.user!.allowedBranchIds.includes(bId));
          if (hasUnauthorized) {
            throw new ForbiddenError('Cannot grant access to branches outside your authorized branches', 'FORBIDDEN_BRANCH_ASSIGNMENT');
          }
        }
      }

      let passwordHash: string | undefined;
      if (req.body.password) {
        passwordHash = await this.auth.hashPassword(req.body.password);
      }

      let pinHash: string | undefined;
      if (req.body.pin) {
        pinHash = await this.auth.hashPin(req.body.pin);
      }

      const user = await this.repo.createUser({
        organizationId: orgId,
        defaultBranchId: req.body.defaultBranchId,
        roleId: req.body.roleId,
        name: req.body.name,
        username: req.body.username,
        email: req.body.email,
        passwordHash,
        pinHash,
      });

      // Branch assignments
      if (req.body.allowedBranchIds && Array.isArray(req.body.allowedBranchIds)) {
        // Filter only valid branches in tenant
        const branches = await this.repo.findBranchesByOrgId(orgId);
        const validIds = branches.map(b => b.id);
        const filtered = req.body.allowedBranchIds.filter((id: number) => validIds.includes(id));
        if (!filtered.includes(req.body.defaultBranchId)) {
          filtered.push(req.body.defaultBranchId);
        }
        await this.repo.setUserBranchAccess(user.id, orgId, filtered);
      }

      const { passwordHash: _, pinHash: __, ...safeUser } = user;

      const response: ApiSuccessResponse = {
        success: true,
        data: safeUser,
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        throw new BadRequestError('Invalid user ID');
      }
      await this.ensureUserManagementScope(req, userId);

      const user = await this.repo.findUserById(orgId, userId);
      if (!user) {
        throw new NotFoundError(`User #${userId} not found in this organization`, 'USER_NOT_FOUND');
      }

      const allowedBranchIds = await this.repo.getUserAllowedBranchIds(user.id, orgId);
      const { passwordHash: _, pinHash: __, ...safeUser } = user;

      const response: ApiSuccessResponse = {
        success: true,
        data: {
          ...safeUser,
          allowedBranchIds,
        },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        throw new BadRequestError('Invalid user ID');
      }
      await this.ensureUserManagementScope(req, userId);

      const existing = await this.repo.findUserById(orgId, userId);
      if (!existing) {
        throw new NotFoundError(`User #${userId} not found in this organization`, 'USER_NOT_FOUND');
      }
      if (existing.roleName === SYSTEM_ROLES.OWNER && req.user!.role !== SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError('Only an OWNER may modify another OWNER account', 'OWNER_ACCOUNT_PROTECTED');
      }

      // Check self-elevation: A user cannot change their own role
      if (req.body.roleId && userId === req.user!.id && req.body.roleId !== req.user!.roleId) {
        throw new ForbiddenError('Users cannot change their own role', 'PRIVILEGE_ESCALATION');
      }

      // Check self-branch elevation: Non-owner cannot change their own branch access
      if (req.body.allowedBranchIds && userId === req.user!.id && req.user!.role !== SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError('Users cannot modify their own branch access restrictions', 'PRIVILEGE_ESCALATION');
      }

      // If changing role to OWNER or FB_MANAGER, require caller to be OWNER
      if (req.body.roleId && req.body.roleId !== existing.roleId) {
        const targetRole = await this.repo.getRoleById(req.body.roleId, orgId);
        if (!targetRole) throw new NotFoundError('Role not found', 'ROLE_NOT_FOUND');
        if (req.user!.role !== SYSTEM_ROLES.OWNER && !req.user!.permissions.includes('admin:all') && targetRole.permissions.some(permission => !req.user!.permissions.includes(permission))) {
          throw new ForbiddenError('You cannot assign a role containing permissions you do not possess', 'ROLE_ASSIGNMENT_ESCALATION');
        }
        if (targetRole && (targetRole.name === SYSTEM_ROLES.OWNER || targetRole.name === SYSTEM_ROLES.FB_MANAGER)) {
          if (req.user!.role !== SYSTEM_ROLES.OWNER) {
            throw new ForbiddenError(`Only organization OWNER can assign ${targetRole.name} role`, 'PRIVILEGE_ESCALATION');
          }
        }
      }

      // Branch authorization check for updater
      const isBranchAdmin = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:branches:manage');
      if (!isBranchAdmin) {
        if (req.body.defaultBranchId && !req.user!.allowedBranchIds.includes(req.body.defaultBranchId)) {
          throw new ForbiddenError('Cannot assign a default branch outside your authorized branches', 'FORBIDDEN_BRANCH_ASSIGNMENT');
        }
        if (req.body.allowedBranchIds && Array.isArray(req.body.allowedBranchIds)) {
          const hasUnauthorized = req.body.allowedBranchIds.some((bId: number) => !req.user!.allowedBranchIds.includes(bId));
          if (hasUnauthorized) {
            throw new ForbiddenError('Cannot grant access to branches outside your authorized branches', 'FORBIDDEN_BRANCH_ASSIGNMENT');
          }
        }
      }

      const removesOwnerAuthority = existing.roleName === SYSTEM_ROLES.OWNER && (req.body.isActive === false || (req.body.roleId !== undefined && req.body.roleId !== existing.roleId));
      if (removesOwnerAuthority && await this.repo.countActiveOwners(orgId) <= 1) {
        throw new ConflictError('The final active OWNER cannot be deactivated or demoted', 'FINAL_OWNER_REQUIRED');
      }

      // Password or PIN hashing if provided
      let passwordHash: string | undefined;
      if (req.body.password) {
        passwordHash = await this.auth.hashPassword(req.body.password);
      }

      let pinHash: string | undefined;
      if (req.body.pin) {
        pinHash = await this.auth.hashPin(req.body.pin);
      }

      const updated = await this.repo.updateUser(orgId, userId, {
        name: req.body.name,
        email: req.body.email,
        roleId: req.body.roleId,
        defaultBranchId: req.body.defaultBranchId,
        isActive: req.body.isActive,
        passwordHash,
        pinHash,
      });

      if (req.body.allowedBranchIds && Array.isArray(req.body.allowedBranchIds)) {
        const branches = await this.repo.findBranchesByOrgId(orgId);
        const validIds = branches.map(b => b.id);
        const filtered = req.body.allowedBranchIds.filter((id: number) => validIds.includes(id));
        await this.repo.setUserBranchAccess(userId, orgId, filtered);
      }

      const { passwordHash: _, pinHash: __, ...safeUser } = updated!;
      const allowedBranchIds = await this.repo.getUserAllowedBranchIds(userId, orgId);

      const response: ApiSuccessResponse = {
        success: true,
        data: {
          ...safeUser,
          allowedBranchIds,
        },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // ROLES & PERMISSIONS
  // ==========================================

  public listRoles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user!.organizationId;
      const roles = await this.repo.getRoles(orgId);
      const permissions = await this.repo.getPermissions();

      const response: ApiSuccessResponse = {
        success: true,
        data: {
          roles,
          permissions,
        },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };
}

export const identityController = new IdentityController();

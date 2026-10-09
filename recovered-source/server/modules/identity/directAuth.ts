import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { administrationRepository } from '../administration/repository';
import { createPendingRegistrationEntitlementInTransaction } from '../organizationAccess/registrationEntitlement';
import { organizationAccessService } from '../organizationAccess/service';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../shared/errors';
import { authService } from './authService';
import { accessStatusAuthService, safeAccessStatusResult } from './accessStatusAuth';
import { identityRepository } from './repository';
import { browserSafeAuthResult, clearSessionCookie, setSessionCookie } from './sessionCookies';
import { SYSTEM_ROLES } from './types';

const cleanName = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizedEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normalizedUsername = (value: unknown) => String(value ?? '').trim().toLowerCase();

function alnum(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function handleCandidates(name: unknown): string[] {
  const words = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
  const joined = words.join('');
  const first = words[0] || '';
  const rest = words.slice(1).join('');
  const initials = words.map(word => word[0]).join('');
  const raw = [
    joined.slice(0, 3),
    words.length > 1 ? `${first[0] || ''}${rest}` : '',
    first,
    joined,
    initials,
  ];
  const seen = new Set<string>();
  return raw
    .map(value => value.replace(/[^a-z0-9]/g, '').slice(0, 15))
    .filter(value => /^[a-z][a-z0-9]{2,14}$/.test(value))
    .filter(value => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

async function isHandleAvailable(handle: string): Promise<boolean> {
  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
    'SELECT id FROM organizations WHERE handle = ? LIMIT 1',
    [handle]
  );
  return rows.length === 0;
}

async function availableHandleSuggestions(name: unknown): Promise<string[]> {
  const baseCandidates = handleCandidates(name);
  const suggestions: string[] = [];
  for (const candidate of baseCandidates) {
    if (await isHandleAvailable(candidate)) suggestions.push(candidate);
    if (suggestions.length >= 4) return suggestions;
  }

  const base = baseCandidates[0] || `rms${alnum(name).slice(0, 8) || 'biz'}`.slice(0, 15);
  let suffix = 2;
  while (suggestions.length < 4 && suffix < 100) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, Math.max(3, 15 - suffixText.length))}${suffixText}`;
    if (/^[a-z][a-z0-9]{2,14}$/.test(candidate) && await isHandleAvailable(candidate)) suggestions.push(candidate);
    suffix += 1;
  }
  return suggestions;
}

async function restaurantHandleForOrganization(organizationId: number): Promise<string> {
  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
    'SELECT handle FROM organizations WHERE id = ? LIMIT 1',
    [organizationId]
  );
  if (!rows.length) throw new NotFoundError('Restaurant not found', 'ORGANIZATION_NOT_FOUND');
  return String(rows[0].handle || '');
}

async function generatedStaffUsername(organizationId: number, handle: string, name: string, excludeUserId?: number): Promise<string> {
  const local = (alnum(name) || 'staff').slice(0, 80);
  const base = `${handle}-${local}`.slice(0, 96);
  const params: any[] = [organizationId];
  let sql = 'SELECT username FROM users WHERE organization_id = ?';
  if (excludeUserId) {
    sql += ' AND id <> ?';
    params.push(excludeUserId);
  }
  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(sql, params);
  const used = new Set(rows.map(row => String(row.username || '').toLowerCase()));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (suffix < 10000) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, Math.max(1, 100 - suffixText.length))}${suffixText}`;
    if (!used.has(candidate)) return candidate;
    suffix += 1;
  }
  throw new ConflictError('Unable to generate a unique staff username');
}

async function issueStaffSession(user: any, organization: any, branch: any, role: any, allowedBranchIds: number[]) {
  const tokenId = crypto.randomUUID();
  const token = authService.generateToken({
    userId: user.id,
    organizationId: organization.id,
    activeBranchId: branch.id,
    role: role.name,
    roleId: role.id,
    username: user.username,
    tokenId,
    authLevel: 'STAFF',
  });
  await identityRepository.createSession(tokenId, user.id, organization.id, new Date(Date.now() + 24 * 60 * 60 * 1000));
  return {
    user: {
      id: user.id,
      organizationId: organization.id,
      defaultBranchId: user.defaultBranchId,
      activeBranchId: branch.id,
      role: role.name,
      roleId: role.id,
      name: user.name,
      username: user.username,
      email: user.email ?? null,
      permissions: role.permissions,
      allowedBranchIds,
      mustChangePin: false,
      authLevel: 'STAFF' as const,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      legalName: organization.legalName ?? null,
      taxIdentifier: organization.taxIdentifier ?? null,
      currencyCode: organization.currencyCode,
      status: organization.status,
      settings: organization.settings ?? {},
      handle: organization.handle,
    },
    branch: {
      id: branch.id,
      organizationId: branch.organizationId,
      name: branch.name,
      code: branch.code,
      billPrefix: branch.billPrefix,
      timezone: branch.timezone,
      isActive: branch.isActive,
    },
    allowedBranches: [branch],
    token,
    expiresIn: '24h',
    authLevel: 'STAFF' as const,
  };
}

export const directAuth = {
  handleSuggestions: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const suggestions = await availableHandleSuggestions(req.body.restaurantName);
      res.status(200).json({ success: true, data: { suggestions } });
    } catch (error) {
      next(error);
    }
  },

  handleAvailability: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const handle = String(req.body.restaurantHandle).trim().toLowerCase();
      const available = await isHandleAvailable(handle);
      res.status(200).json({ success: true, data: { handle, available } });
    } catch (error) {
      next(error);
    }
  },

  register: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const pool = getDatabasePool();
    const connection = await pool.getConnection();
    try {
      const organizationName = cleanName(req.body.organizationName);
      const restaurantHandle = String(req.body.restaurantHandle).trim().toLowerCase();
      const ownerName = cleanName(req.body.ownerName);
      const ownerEmail = normalizedEmail(req.body.ownerEmail);
      const ownerPhone = String(req.body.ownerPhone).trim();

      if (await identityRepository.findOrganizationByName(organizationName)) {
        throw new ConflictError(`Registered restaurant name "${organizationName}" already exists`);
      }
      if (!(await isHandleAvailable(restaurantHandle))) {
        throw new ConflictError(`Restaurant handle "${restaurantHandle}" is already in use. Choose another suggestion.`);
      }
      const emailOwner = await identityRepository.findUserByUsernameOrEmailGlobal(ownerEmail);
      if (emailOwner) throw new ConflictError('That email address is already linked to an RMS account.');

      const passwordHash = await authService.hashPassword(req.body.ownerPassword);
      const ownerUsername = `${restaurantHandle}-${(alnum(ownerName) || 'owner').slice(0, 80)}`;
      await connection.beginTransaction();

      const [orgInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO organizations (handle, name, legal_name, tax_identifier, currency_code, status, settings)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [restaurantHandle, organizationName, req.body.legalName || null, req.body.taxIdentifier || null, req.body.currencyCode || 'NPR', JSON.stringify({})]
      );
      const organizationId = Number(orgInsert.insertId);

      await createPendingRegistrationEntitlementInTransaction(
        connection,
        organizationId,
      );

      const [branchInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO branches (organization_id, name, code, address, bill_prefix, is_active)
         VALUES (?, ?, ?, ?, 'FH-', TRUE)`,
        [
          organizationId,
          req.body.branchName || 'Main Branch',
          String(req.body.branchCode || 'MAIN-01').toUpperCase(),
          req.body.branchAddress || null,
        ]
      );
      const branchId = Number(branchInsert.insertId);

      const [roleRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM roles
         WHERE name = ? AND (organization_id IS NULL OR organization_id = ?)
         ORDER BY organization_id IS NOT NULL DESC LIMIT 1`,
        [SYSTEM_ROLES.OWNER, organizationId]
      );
      if (!roleRows.length) throw new Error('System OWNER role not initialized');
      const roleId = Number(roleRows[0].id);

      const [userInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (organization_id, default_branch_id, role_id, name, username, email, phone, password_hash, pin_hash, is_active, must_change_pin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, TRUE, FALSE)`,
        [organizationId, branchId, roleId, ownerName, ownerUsername, ownerEmail, ownerPhone, passwordHash]
      );
      const userId = Number(userInsert.insertId);
      await connection.execute(
        'INSERT INTO user_branches (user_id, branch_id, organization_id) VALUES (?, ?, ?)',
        [userId, branchId, organizationId]
      );
      await connection.commit();

      try {
        await administrationRepository.seedOrganizationBaseline(organizationId, branchId, userId);
        await administrationRepository.seedStarterSamples(organizationId, branchId, userId);
      } catch {
        // Provisioning is idempotent. Registration must remain recoverable even if optional starter data fails.
      }

      const [organization, branch, user, role] = await Promise.all([
        identityRepository.findOrganizationById(organizationId),
        identityRepository.findBranchById(organizationId, branchId),
        identityRepository.findUserById(organizationId, userId),
        identityRepository.getRoleById(roleId, organizationId),
      ]);
      if (!organization || !branch || !user || !role) throw new Error('Restaurant registration committed but could not be reloaded');

      const access = await organizationAccessService.resolveEffectiveAccess(
        organizationId,
      );
      const issued = await accessStatusAuthService.issueForBlockedOwner({
        userId: user.id,
        organizationId,
        username: user.username,
        role: role.name,
        access,
      });
      const context = await accessStatusAuthService.resolve(
        accessStatusAuthService.verifyToken(issued.token),
      );
      const result = {
        ...safeAccessStatusResult(context),
        token: issued.token,
        expiresIn: issued.expiresIn,
      };

      setSessionCookie(res, 'ACCESS_STATUS', issued.token);
      clearSessionCookie(res, 'STAFF');
      clearSessionCookie(res, 'ACCOUNT');
      res.status(201).json({
        success: true,
        data: browserSafeAuthResult(result),
      });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      next(error);
    } finally {
      connection.release();
    }
  },

  login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const username = normalizedUsername(req.body.username);
      const [lookupRows] = await getDatabasePool().execute<RowDataPacket[]>(
        `SELECT u.organization_id, o.name, o.legal_name, o.tax_identifier, o.currency_code, o.status, o.settings, o.handle
           FROM users u
           JOIN organizations o ON o.id = u.organization_id
          WHERE LOWER(u.username) = ?
          LIMIT 2`,
        [username]
      );
      if (lookupRows.length !== 1) {
        throw new UnauthorizedError('Invalid username or password', 'INVALID_CREDENTIALS');
      }

      const orgRow = lookupRows[0];
      const organizationId = Number(orgRow.organization_id);
      const user = await identityRepository.findUserByUsername(organizationId, username);

      // Credentials are always verified before any organization lifecycle state
      // is disclosed. A blocked tenant must not become an account-enumeration
      // side channel for unauthenticated callers.
      if (
        !user?.isActive
        || !user.passwordHash
        || !(await authService.verifyPassword(req.body.password, user.passwordHash))
      ) {
        throw new UnauthorizedError('Invalid username or password', 'INVALID_CREDENTIALS');
      }

      const role = await identityRepository.getRoleById(user.roleId, organizationId);
      if (!role) throw new NotFoundError('User role is unavailable', 'ROLE_NOT_FOUND');

      const access = await organizationAccessService.resolveEffectiveAccess(
        organizationId,
      );

      if (!access.canOperate) {
        if (role.name !== SYSTEM_ROLES.OWNER || !access.ownerCanViewStatus) {
          throw new ForbiddenError(
            'This restaurant workspace is currently inactive. Please contact your restaurant owner.',
            'ORGANIZATION_ACCESS_BLOCKED',
            {
              status: access.configuredStatus,
              accessMode: access.accessMode,
              reason: access.blockingReason,
            },
          );
        }

        const issued = await accessStatusAuthService.issueForBlockedOwner({
          userId: user.id,
          organizationId,
          username: user.username,
          role: role.name,
          access,
        });
        const context = await accessStatusAuthService.resolve(
          accessStatusAuthService.verifyToken(issued.token),
        );
        const result = {
          ...safeAccessStatusResult(context),
          token: issued.token,
          expiresIn: issued.expiresIn,
        };

        setSessionCookie(res, 'ACCESS_STATUS', issued.token);
        clearSessionCookie(res, 'STAFF');
        clearSessionCookie(res, 'ACCOUNT');
        res.status(200).json({
          success: true,
          data: browserSafeAuthResult(result),
        });
        return;
      }

      const branch = await identityRepository.findBranchById(
        organizationId,
        user.defaultBranchId,
      );
      if (!branch?.isActive) {
        throw new NotFoundError(
          'Your default branch is unavailable',
          'BRANCH_NOT_FOUND',
        );
      }

      const allowedBranchIds = await identityRepository.getUserAllowedBranchIds(
        user.id,
        organizationId,
      );
      const result = await issueStaffSession(
        user,
        {
          id: organizationId,
          name: String(orgRow.name),
          legalName: orgRow.legal_name,
          taxIdentifier: orgRow.tax_identifier,
          currencyCode: String(orgRow.currency_code),
          status: String(orgRow.status),
          settings:
            typeof orgRow.settings === 'string'
              ? JSON.parse(orgRow.settings || '{}')
              : (orgRow.settings || {}),
          handle: String(orgRow.handle),
        },
        branch,
        role,
        allowedBranchIds,
      );
      result.allowedBranches = (
        await identityRepository.findBranchesByOrgId(organizationId)
      ).filter(candidate => allowedBranchIds.includes(candidate.id));

      setSessionCookie(res, 'STAFF', result.token);
      clearSessionCookie(res, 'ACCOUNT');
      clearSessionCookie(res, 'ACCESS_STATUS');
      res.status(200).json({
        success: true,
        data: browserSafeAuthResult(result),
      });
    } catch (error) {
      next(error);
    }
  },

  changePassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.user!;
      const user = await identityRepository.findUserById(
        context.organizationId,
        context.id,
      );
      if (!user?.passwordHash) {
        throw new UnauthorizedError(
          'Current password is unavailable for this account',
          'CURRENT_PASSWORD_INVALID',
        );
      }

      const currentValid = await authService.verifyPassword(
        req.body.currentPassword,
        user.passwordHash,
      );
      if (!currentValid) {
        throw new UnauthorizedError(
          'Current password is incorrect',
          'CURRENT_PASSWORD_INVALID',
        );
      }

      if (await authService.verifyPassword(req.body.newPassword, user.passwordHash)) {
        throw new ConflictError(
          'New password must be different from the current password',
          'PASSWORD_REUSE_NOT_ALLOWED',
        );
      }

      const passwordHash = await authService.hashPassword(req.body.newPassword);
      await identityRepository.updateUser(context.organizationId, context.id, {
        passwordHash,
      });

      clearSessionCookie(res, 'STAFF');
      clearSessionCookie(res, 'ACCOUNT');
      clearSessionCookie(res, 'ACCESS_STATUS');

      res.status(200).json({
        success: true,
        data: {
          message: 'Password changed successfully. Sign in again with your new password.',
        },
      });
    } catch (error) {
      next(error);
    }
  },

  me: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.user!;
      const [organization, activeBranch, branches, handle] = await Promise.all([
        identityRepository.findOrganizationById(context.organizationId),
        identityRepository.findBranchById(context.organizationId, context.activeBranchId),
        identityRepository.findBranchesByOrgId(context.organizationId),
        restaurantHandleForOrganization(context.organizationId),
      ]);
      if (!organization || !activeBranch) throw new NotFoundError('Authenticated restaurant context is unavailable', 'AUTH_CONTEXT_NOT_FOUND');
      res.status(200).json({
        success: true,
        data: {
          user: {
            id: context.id,
            name: context.name,
            username: context.username,
            email: context.email,
            role: context.role,
            roleId: context.roleId,
            permissions: context.permissions,
            authLevel: 'STAFF',
          },
          organization: { ...organization, handle },
          activeBranch,
          allowedBranches: branches.filter(branch => context.allowedBranchIds.includes(branch.id)),
          authLevel: 'STAFF',
        },
      });
    } catch (error) {
      next(error);
    }
  },

  createUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor = req.user!;
      const orgId = actor.organizationId;
      const name = cleanName(req.body.name);
      const handle = await restaurantHandleForOrganization(orgId);
      const username = await generatedStaffUsername(orgId, handle, name);
      const branch = await identityRepository.findBranchById(orgId, req.body.defaultBranchId);
      if (!branch) throw new NotFoundError('Default branch does not exist in this restaurant', 'BRANCH_NOT_FOUND');
      const role = await identityRepository.getRoleById(req.body.roleId, orgId);
      if (!role) throw new NotFoundError('Role not found', 'ROLE_NOT_FOUND');

      if (actor.role !== SYSTEM_ROLES.OWNER && !actor.permissions.includes('admin:all') && role.permissions.some(permission => !actor.permissions.includes(permission))) {
        throw new ForbiddenError('You cannot assign a role containing permissions you do not possess', 'ROLE_ASSIGNMENT_ESCALATION');
      }
      if ([SYSTEM_ROLES.OWNER, SYSTEM_ROLES.FB_MANAGER].includes(role.name as any) && actor.role !== SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError(`Only the restaurant owner can assign ${role.name}`, 'PRIVILEGE_ESCALATION');
      }

      const allBranches = await identityRepository.findBranchesByOrgId(orgId);
      const validBranchIds = new Set(allBranches.map(item => item.id));
      const requested = Array.from(new Set<number>([...(req.body.allowedBranchIds || []), req.body.defaultBranchId]));
      if (requested.some(id => !validBranchIds.has(id))) throw new NotFoundError('One or more assigned branches do not exist', 'BRANCH_NOT_FOUND');
      const branchAdmin = actor.role === SYSTEM_ROLES.OWNER || actor.permissions.includes('admin:all') || actor.permissions.includes('admin:branches:manage');
      if (!branchAdmin && requested.some(id => !actor.allowedBranchIds.includes(id))) {
        throw new ForbiddenError('Cannot grant branches outside your own access', 'FORBIDDEN_BRANCH_ASSIGNMENT');
      }

      const user = await identityRepository.createUser({
        organizationId: orgId,
        defaultBranchId: req.body.defaultBranchId,
        roleId: req.body.roleId,
        name,
        username,
        passwordHash: await authService.hashPassword(req.body.password),
        mustChangePin: false,
      });
      await identityRepository.setUserBranchAccess(user.id, orgId, requested);
      const allowedBranchIds = await identityRepository.getUserAllowedBranchIds(user.id, orgId);
      const { passwordHash: _passwordHash, pinHash: _pinHash, mustChangePin: _mustChangePin, ...safeUser } = user;
      res.status(201).json({ success: true, data: { ...safeUser, allowedBranchIds } });
    } catch (error) {
      next(error);
    }
  },

  updateUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor = req.user!;
      const orgId = actor.organizationId;
      const userId = Number(req.params.id);
      const existing = await identityRepository.findUserById(orgId, userId);
      if (!existing) throw new NotFoundError('Staff member not found', 'USER_NOT_FOUND');

      const branchAdmin = actor.role === SYSTEM_ROLES.OWNER || actor.permissions.includes('admin:all') || actor.permissions.includes('admin:branches:manage');
      const existingAccess = await identityRepository.getUserAllowedBranchIds(userId, orgId);
      if (!branchAdmin && !existingAccess.some(id => actor.allowedBranchIds.includes(id))) {
        throw new ForbiddenError('Staff member is outside your authorized branches', 'STAFF_SCOPE_FORBIDDEN');
      }
      if (actor.id === userId && req.body.isActive === false) {
        throw new ForbiddenError('You cannot deactivate your own signed-in account', 'SELF_DEACTIVATION_FORBIDDEN');
      }

      let nextUsername = existing.username;
      let nextName = existing.name;
      if (req.body.name !== undefined) {
        nextName = cleanName(req.body.name);
        const handle = await restaurantHandleForOrganization(orgId);
        nextUsername = await generatedStaffUsername(orgId, handle, nextName, userId);
      }

      const nextRoleId = req.body.roleId ?? existing.roleId;
      const role = await identityRepository.getRoleById(nextRoleId, orgId);
      if (!role) throw new NotFoundError('Role not found', 'ROLE_NOT_FOUND');
      if (actor.role !== SYSTEM_ROLES.OWNER && !actor.permissions.includes('admin:all') && role.permissions.some(permission => !actor.permissions.includes(permission))) {
        throw new ForbiddenError('You cannot assign a role containing permissions you do not possess', 'ROLE_ASSIGNMENT_ESCALATION');
      }
      if ([SYSTEM_ROLES.OWNER, SYSTEM_ROLES.FB_MANAGER].includes(role.name as any) && actor.role !== SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError(`Only the restaurant owner can assign ${role.name}`, 'PRIVILEGE_ESCALATION');
      }

      const defaultBranchId = req.body.defaultBranchId ?? existing.defaultBranchId;
      if (!(await identityRepository.findBranchById(orgId, defaultBranchId))) throw new NotFoundError('Default branch does not exist', 'BRANCH_NOT_FOUND');
      const requestedAccess = req.body.allowedBranchIds
        ? Array.from(new Set<number>([...req.body.allowedBranchIds, defaultBranchId]))
        : Array.from(new Set<number>([...existingAccess, defaultBranchId]));
      const allBranches = await identityRepository.findBranchesByOrgId(orgId);
      const validBranchIds = new Set(allBranches.map(item => item.id));
      if (requestedAccess.some(id => !validBranchIds.has(id))) throw new NotFoundError('One or more assigned branches do not exist', 'BRANCH_NOT_FOUND');
      if (!branchAdmin && requestedAccess.some(id => !actor.allowedBranchIds.includes(id))) {
        throw new ForbiddenError('Cannot grant branches outside your own access', 'FORBIDDEN_BRANCH_ASSIGNMENT');
      }

      const passwordHash = req.body.password ? await authService.hashPassword(req.body.password) : undefined;
      const updated = await identityRepository.updateUser(orgId, userId, {
        name: nextName,
        roleId: nextRoleId,
        defaultBranchId,
        passwordHash,
        isActive: req.body.isActive,
      });
      if (!updated) throw new NotFoundError('Staff member not found', 'USER_NOT_FOUND');
      if (nextUsername !== existing.username) {
        await getDatabasePool().execute(
          'UPDATE users SET username = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
          [nextUsername, userId, orgId]
        );
      }
      await identityRepository.setUserBranchAccess(userId, orgId, requestedAccess);
      const reloaded = await identityRepository.findUserById(orgId, userId);
      if (!reloaded) throw new NotFoundError('Staff member not found after update', 'USER_NOT_FOUND');
      const allowedBranchIds = await identityRepository.getUserAllowedBranchIds(userId, orgId);
      const { passwordHash: _passwordHash, pinHash: _pinHash, mustChangePin: _mustChangePin, ...safeUser } = reloaded;
      res.status(200).json({ success: true, data: { ...safeUser, allowedBranchIds } });
    } catch (error) {
      next(error);
    }
  },
};

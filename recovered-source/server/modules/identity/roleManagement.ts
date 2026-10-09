import { NextFunction, Request, Response } from 'express';
import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { getDatabasePool, isDatabaseAvailable } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { identityRepository } from './repository';
import { SYSTEM_ROLES } from './types';

const permissionIdsSchema = z.array(z.coerce.number().int().positive()).max(500).refine(
  values => new Set(values).size === values.length,
  'Permission IDs must be unique'
);

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(255).optional().default(''),
  permissionIds: permissionIdsSchema.default([]),
}).strict();

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(255).optional().default(''),
  permissionIds: permissionIdsSchema.default([]),
}).strict();

function normalizeRoleName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function actorIsSuper(req: Request): boolean {
  return req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:all');
}

async function ensureDatabase(): Promise<void> {
  if (!(await isDatabaseAvailable())) {
    throw new BadRequestError(
      'Custom role management requires MySQL in this development session.',
      'ROLE_WRITE_REQUIRES_DATABASE'
    );
  }
}

async function validatePermissionSelection(req: Request, permissionIds: number[]): Promise<void> {
  const permissions = await identityRepository.getPermissions();
  const byId = new Map(permissions.map(permission => [permission.id, permission]));
  const superUser = actorIsSuper(req);

  for (const permissionId of permissionIds) {
    const permission = byId.get(permissionId);
    if (!permission) throw new BadRequestError(`Unknown permission #${permissionId}`, 'INVALID_PERMISSION');
    if (!superUser && !req.user!.permissions.includes(permission.code)) {
      throw new ForbiddenError(
        `You cannot add ${permission.code} to a role because you do not possess that permission.`,
        'ROLE_PERMISSION_ESCALATION'
      );
    }
  }
}

async function ensureRoleNameAvailable(organizationId: number, name: string, excludingRoleId?: number): Promise<void> {
  const roles = await identityRepository.getRoles(organizationId);
  const duplicate = roles.find(role => role.id !== excludingRoleId && role.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    throw new ConflictError(`Role "${name}" already exists.`, 'ROLE_NAME_TAKEN');
  }
}

async function replaceRolePermissions(connection: PoolConnection, roleId: number, permissionIds: number[]): Promise<void> {
  await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  for (const permissionId of permissionIds) {
    await connection.execute(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [roleId, permissionId]
    );
  }
}

export const roleManagementController = {
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await ensureDatabase();
      const organizationId = req.user!.organizationId;
      const name = normalizeRoleName(req.body.name);
      const permissionIds = req.body.permissionIds as number[];

      await ensureRoleNameAvailable(organizationId, name);
      await validatePermissionSelection(req, permissionIds);

      const connection = await getDatabasePool().getConnection();
      let roleId = 0;
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO roles (organization_id, name, description, is_system)
           VALUES (?, ?, ?, FALSE)`,
          [organizationId, name, req.body.description || null]
        );
        roleId = Number(result.insertId);
        await replaceRolePermissions(connection, roleId, permissionIds);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      const role = await identityRepository.getRoleById(roleId, organizationId);
      if (!role) throw new Error('Custom role was created but could not be reloaded');
      res.status(201).json({ success: true, data: role });
    } catch (error) { next(error); }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await ensureDatabase();
      const organizationId = req.user!.organizationId;
      const roleId = Number(req.params.id);
      if (!Number.isInteger(roleId) || roleId <= 0) throw new BadRequestError('Invalid role ID', 'INVALID_ROLE_ID');

      const existing = await identityRepository.getRoleById(roleId, organizationId);
      if (!existing || existing.organizationId !== organizationId) {
        throw new NotFoundError('Custom role not found', 'ROLE_NOT_FOUND');
      }
      if (existing.isSystem || existing.organizationId == null) {
        throw new ForbiddenError('System roles cannot be edited.', 'SYSTEM_ROLE_PROTECTED');
      }

      const name = normalizeRoleName(req.body.name);
      const permissionIds = req.body.permissionIds as number[];
      await ensureRoleNameAvailable(organizationId, name, roleId);
      await validatePermissionSelection(req, permissionIds);

      const connection = await getDatabasePool().getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `UPDATE roles SET name = ?, description = ? WHERE id = ? AND organization_id = ? AND is_system = FALSE`,
          [name, req.body.description || null, roleId, organizationId]
        );
        await replaceRolePermissions(connection, roleId, permissionIds);

        // Permissions are embedded in authenticated staff context. End active
        // sessions for users on this role so the changed role takes effect on
        // their next sign-in instead of leaving stale authorization behind.
        await connection.execute(
          `UPDATE sessions s
           INNER JOIN users u ON u.id = s.user_id AND u.organization_id = s.organization_id
           SET s.is_revoked = TRUE, s.revoked_at = NOW()
           WHERE u.organization_id = ? AND u.role_id = ? AND s.is_revoked = FALSE`,
          [organizationId, roleId]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      const role = await identityRepository.getRoleById(roleId, organizationId);
      if (!role) throw new Error('Custom role was updated but could not be reloaded');
      res.status(200).json({ success: true, data: role });
    } catch (error) { next(error); }
  },
};

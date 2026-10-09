import { Router, Request } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../identity/middleware';
import { identityRepository } from '../identity/repository';
import { SYSTEM_ROLES } from '../identity/types';
import { validateRequest } from '../../middleware/validate';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';

const overrideSchema = z.object({
  overrides: z.array(z.object({
    permissionId: z.coerce.number().int().positive(),
    effect: z.enum(['GRANTED', 'DENIED']),
  })).max(500),
}).strict();

async function targetInScope(req: Request, userId: number) {
  const actor = req.user!;
  const target = await identityRepository.findUserById(actor.organizationId, userId);
  if (!target) throw new NotFoundError('Staff member not found', 'USER_NOT_FOUND');

  const orgWide = actor.role === SYSTEM_ROLES.OWNER || actor.permissions.includes('admin:all') || actor.permissions.includes('admin:branches:manage');
  if (!orgWide && userId !== actor.id) {
    const targetBranches = await identityRepository.getUserAllowedBranchIds(userId, actor.organizationId);
    if (!targetBranches.some(branchId => actor.allowedBranchIds.includes(branchId))) {
      throw new ForbiddenError('Staff member is outside your authorized branches', 'STAFF_SCOPE_FORBIDDEN');
    }
  }
  return target;
}

async function permissionProfile(req: Request, userId: number) {
  const target = await targetInScope(req, userId);
  const [role, permissions, overrides] = await Promise.all([
    identityRepository.getRoleById(target.roleId, req.user!.organizationId),
    identityRepository.getPermissions(),
    identityRepository.getUserPermissionOverrides(userId, req.user!.organizationId),
  ]);

  const rolePermissions = role?.permissions ?? [];
  const effective = new Set<string>();
  if ((role?.name ?? target.roleName) === SYSTEM_ROLES.OWNER) {
    permissions.forEach(permission => effective.add(permission.code));
    effective.add('admin:all');
  } else {
    rolePermissions.forEach(code => effective.add(code));
    for (const [code, effect] of overrides) {
      if (effect === 'DENIED') effective.delete(code);
      else effective.add(code);
    }
  }

  const permissionByCode = new Map(permissions.map(permission => [permission.code, permission]));
  return {
    target,
    role,
    permissions,
    overrides,
    data: {
      userId,
      roleId: target.roleId,
      roleName: role?.name ?? target.roleName,
      rolePermissions,
      overrides: [...overrides.entries()].map(([code, effect]) => ({
        permissionId: permissionByCode.get(code)?.id ?? 0,
        code,
        effect,
      })).filter(item => item.permissionId > 0),
      effectivePermissions: [...effective].sort(),
    },
  };
}

export const staffPermissionsRouter = Router();
staffPermissionsRouter.use(authenticate());

staffPermissionsRouter.get('/:userId', requirePermission('admin:users:manage'), async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw new BadRequestError('Invalid staff ID', 'INVALID_USER_ID');
    const profile = await permissionProfile(req, userId);
    res.json({ success: true, data: profile.data });
  } catch (error) { next(error); }
});

staffPermissionsRouter.put(
  '/:userId',
  requirePermission('admin:users:manage'),
  validateRequest({ body: overrideSchema }),
  async (req, res, next) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw new BadRequestError('Invalid staff ID', 'INVALID_USER_ID');
      if (userId === req.user!.id) {
        throw new ForbiddenError('You cannot modify your own individual permission overrides', 'SELF_PERMISSION_OVERRIDE_FORBIDDEN');
      }

      const profile = await permissionProfile(req, userId);
      if ((profile.role?.name ?? profile.target.roleName) === SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError('OWNER permissions cannot be changed with individual overrides', 'OWNER_PERMISSION_OVERRIDE_FORBIDDEN');
      }

      const actorIsSuper = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:all');
      const permissionById = new Map(profile.permissions.map(permission => [permission.id, permission]));
      const desired = new Map<number, 'GRANTED' | 'DENIED'>();

      for (const item of req.body.overrides as Array<{ permissionId: number; effect: 'GRANTED' | 'DENIED' }>) {
        if (desired.has(item.permissionId)) throw new BadRequestError('Duplicate permission override', 'DUPLICATE_PERMISSION_OVERRIDE');
        const permission = permissionById.get(item.permissionId);
        if (!permission) throw new BadRequestError(`Unknown permission #${item.permissionId}`, 'INVALID_PERMISSION');
        if (!actorIsSuper && !req.user!.permissions.includes(permission.code)) {
          throw new ForbiddenError(`You cannot change permission ${permission.code} because you do not possess it`, 'PERMISSION_OVERRIDE_ESCALATION');
        }
        desired.set(item.permissionId, item.effect);
      }

      // Only mutate permissions the actor is entitled to administer. Existing overrides
      // outside a branch manager's own authority are preserved rather than silently cleared.
      for (const permission of profile.permissions) {
        const actorCanManage = actorIsSuper || req.user!.permissions.includes(permission.code);
        if (!actorCanManage) continue;
        const requested = desired.get(permission.id);
        const current = profile.overrides.get(permission.code);
        if (!requested && current) {
          await identityRepository.clearUserPermissionOverride(userId, permission.id, req.user!.organizationId);
        } else if (requested === 'GRANTED' && current !== 'GRANTED') {
          await identityRepository.grantUserPermission(userId, permission.id, req.user!.organizationId);
        } else if (requested === 'DENIED' && current !== 'DENIED') {
          await identityRepository.denyUserPermission(userId, permission.id, req.user!.organizationId);
        }
      }

      const updated = await permissionProfile(req, userId);
      res.json({ success: true, data: updated.data });
    } catch (error) { next(error); }
  }
);
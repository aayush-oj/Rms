import { ForbiddenError, BadRequestError } from '../../shared/errors';
import { AuthContext } from '../identity/types';

export interface ResolvedReportScope { organizationId: number; branchIds: number[]; }

export function resolveReportScope(user: AuthContext | undefined, requestedBranchId?: number, allowMultiBranch = false): ResolvedReportScope {
  if (!user?.organizationId) throw new ForbiddenError('Authenticated tenant context is missing','MISSING_TENANT_CONTEXT');
  if (requestedBranchId !== undefined && (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0)) throw new BadRequestError('Invalid branchId','INVALID_BRANCH_ID');
  const privileged = user.role === 'OWNER' || user.permissions.includes('admin:all') || user.permissions.includes('admin:branches:manage');
  if (requestedBranchId !== undefined && !privileged && !user.allowedBranchIds.includes(requestedBranchId)) throw new ForbiddenError('You do not have access to this branch','UNAUTHORIZED_BRANCH_ACCESS');
  let branchIds = requestedBranchId !== undefined ? [requestedBranchId] : allowMultiBranch ? user.allowedBranchIds : [user.activeBranchId];
  branchIds = [...new Set(branchIds.filter(id => Number.isInteger(id) && id > 0))];
  if (!branchIds.length) throw new ForbiddenError('No authorized branch scope is available','MISSING_BRANCH_CONTEXT');
  return { organizationId: user.organizationId, branchIds };
}

import { Request, Response, NextFunction } from 'express';
import { tableAllocationRepository, TableAllocationRepository } from './repository';
import { identityRepository } from '../identity/repository';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { SYSTEM_ROLES } from '../identity/types';

export class TableAllocationController {
  constructor(private repo: TableAllocationRepository = tableAllocationRepository) {}

  private getOrgId(req: Request): number {
    if (!req.user || !req.user.organizationId) {
      throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
    }
    return req.user.organizationId;
  }

  private getBranchId(req: Request): number {
    if (!req.user || !req.user.activeBranchId) {
      throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
    }
    return req.user.activeBranchId;
  }

  private async ensureBranchAccess(req: Request, branchId: number): Promise<void> {
    if (!req.user) {
      throw new ForbiddenError('Authentication required', 'AUTH_REQUIRED');
    }
    const branch = await identityRepository.findBranchById(req.user.organizationId, branchId);
    if (!branch) {
      throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    }
    if (
      req.user.role === SYSTEM_ROLES.OWNER ||
      req.user.permissions.includes('admin:all') ||
      req.user.permissions.includes('admin:branches:manage')
    ) {
      return;
    }
    if (!req.user.allowedBranchIds.includes(branchId)) {
      throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    }
  }

  listAllocations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);

      // Waiters can only see their own allocations
      if (req.user!.role === SYSTEM_ROLES.WAITER) {
        const allocations = await this.repo.listByUser(orgId, req.user!.id, { isActive: true });
        const response: ApiSuccessResponse = { success: true, data: allocations };
        res.status(200).json(response);
        return;
      }

      const allocations = await this.repo.listByBranch(orgId, branchId, { isActive: true });
      const response: ApiSuccessResponse = { success: true, data: allocations };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  createAllocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);

      const allocation = await this.repo.create(orgId, branchId, req.body, req.user!.id);
      const response: ApiSuccessResponse = { success: true, data: allocation };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  getAllocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);

      const allocationId = parseInt(req.params.id, 10);
      if (isNaN(allocationId)) {
        throw new BadRequestError('Valid allocation ID is required', 'INVALID_ALLOCATION_ID');
      }

      const allocation = await this.repo.findById(allocationId, orgId, branchId);
      if (!allocation) {
        throw new NotFoundError('Allocation not found', 'ALLOCATION_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: allocation };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  updateAllocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);

      const allocationId = parseInt(req.params.id, 10);
      if (isNaN(allocationId)) {
        throw new BadRequestError('Valid allocation ID is required', 'INVALID_ALLOCATION_ID');
      }

      const allocation = await this.repo.reassign(orgId, branchId, allocationId, req.body, req.user!.id);
      const response: ApiSuccessResponse = { success: true, data: allocation };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  deactivateAllocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);

      const allocationId = parseInt(req.params.id, 10);
      if (isNaN(allocationId)) {
        throw new BadRequestError('Valid allocation ID is required', 'INVALID_ALLOCATION_ID');
      }

      const allocation = await this.repo.deactivate(orgId, branchId, allocationId);
      const response: ApiSuccessResponse = { success: true, data: allocation };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };
}

export const tableAllocationController = new TableAllocationController();

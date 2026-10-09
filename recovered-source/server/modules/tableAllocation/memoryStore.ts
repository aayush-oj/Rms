import { TableAllocation, CreateTableAllocationInput, UpdateTableAllocationInput, ListTableAllocationsParams } from './types';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { administrationRepository } from '../administration/repository';
import { identityRepository } from '../identity/repository';

export class TableAllocationMemoryStore {
  private allocations = new Map<number, TableAllocation>();
  private nextId = 1;

  public async create(
    organizationId: number,
    branchId: number,
    input: CreateTableAllocationInput,
    createdBy: number
  ): Promise<TableAllocation> {
    // 1. Validate dining table exists in same org+branch
    const table = await administrationRepository.findTableById(input.diningTableId, organizationId);
    if (!table || table.branchId !== branchId || !table.isActive) {
      throw new NotFoundError('Dining table not found in this branch', 'DINING_TABLE_NOT_FOUND');
    }

    // 2. Validate target user exists, is active, has WAITER role, and has branch access
    const user = await identityRepository.findUserById(organizationId, input.userId);
    if (!user) {
      throw new NotFoundError('Target user not found or does not have WAITER role', 'USER_NOT_FOUND_OR_INVALID_ROLE');
    }
    const role = await identityRepository.getRoleById(user.roleId, organizationId);
    if (!role || role.name !== 'WAITER') {
      throw new NotFoundError('Target user not found or does not have WAITER role', 'USER_NOT_FOUND_OR_INVALID_ROLE');
    }
    if (!user.isActive) {
      throw new BadRequestError('Target user is inactive', 'USER_INACTIVE');
    }

    // Check user has branch access
    const allowedBranches = await identityRepository.getUserAllowedBranchIds(input.userId, organizationId);
    if (!allowedBranches.includes(branchId)) {
      throw new ForbiddenError('Target user does not have access to this branch', 'USER_NO_BRANCH_ACCESS');
    }

    // Check for existing active allocation on this table in this branch
    for (const alloc of this.allocations.values()) {
      if (
        alloc.organizationId === organizationId &&
        alloc.branchId === branchId &&
        alloc.diningTableId === input.diningTableId &&
        alloc.isActive
      ) {
        throw new ConflictError('Table already has an active allocation', 'TABLE_ALREADY_ALLOCATED');
      }
    }

    const now = new Date().toISOString();
    const id = this.nextId++;
    const record: TableAllocation = {
      id,
      organizationId,
      branchId,
      diningTableId: input.diningTableId,
      userId: input.userId,
      isActive: true,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    this.allocations.set(id, record);
    return { ...record };
  }

  public async reassign(
    organizationId: number,
    branchId: number,
    allocationId: number,
    input: UpdateTableAllocationInput,
    updatedBy: number
  ): Promise<TableAllocation> {
    const existing = this.allocations.get(allocationId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError(`Allocation #${allocationId} not found`, 'ALLOCATION_NOT_FOUND');
    }
    if (existing.branchId !== branchId) {
      throw new ForbiddenError('Allocation does not belong to this branch', 'BRANCH_MISMATCH');
    }
    if (!existing.isActive) {
      throw new BadRequestError('Cannot reassign inactive allocation', 'ALLOCATION_INACTIVE');
    }

    // Idempotent: if same waiter, return unchanged
    if (existing.userId === input.userId) {
      return { ...existing };
    }

    // Validate target user exists, is active, has WAITER role, and has branch access
    const user = await identityRepository.findUserById(organizationId, input.userId);
    if (!user) {
      throw new NotFoundError('Target user not found or does not have WAITER role', 'USER_NOT_FOUND_OR_INVALID_ROLE');
    }
    const role = await identityRepository.getRoleById(user.roleId, organizationId);
    if (!role || role.name !== 'WAITER') {
      throw new NotFoundError('Target user not found or does not have WAITER role', 'USER_NOT_FOUND_OR_INVALID_ROLE');
    }
    if (!user.isActive) {
      throw new BadRequestError('Target user is inactive', 'USER_INACTIVE');
    }

    const allowedBranches = await identityRepository.getUserAllowedBranchIds(input.userId, organizationId);
    if (!allowedBranches.includes(branchId)) {
      throw new ForbiddenError('Target user does not have access to this branch', 'USER_NO_BRANCH_ACCESS');
    }

    const now = new Date().toISOString();
    existing.isActive = false;
    existing.updatedAt = now;

    const id = this.nextId++;
    const record: TableAllocation = {
      id,
      organizationId,
      branchId,
      diningTableId: existing.diningTableId,
      userId: input.userId,
      isActive: true,
      createdBy: updatedBy,
      createdAt: now,
      updatedAt: now,
    };
    this.allocations.set(id, record);
    return { ...record };
  }

  public async findById(id: number, organizationId: number, branchId?: number): Promise<TableAllocation | null> {
    const alloc = this.allocations.get(id);
    if (!alloc || alloc.organizationId !== organizationId) return null;
    if (branchId != null && alloc.branchId !== branchId) return null;
    return { ...alloc };
  }

  public async listByBranch(
    organizationId: number,
    branchId: number,
    params: ListTableAllocationsParams = {}
  ): Promise<TableAllocation[]> {
    return Array.from(this.allocations.values())
      .filter((a) => {
        if (a.organizationId !== organizationId || a.branchId !== branchId) return false;
        if (params.isActive !== undefined && a.isActive !== params.isActive) return false;
        return true;
      })
      .sort((a, b) => a.id - b.id)
      .map((a) => ({ ...a }));
  }

  public async listByUser(
    organizationId: number,
    userId: number,
    params: ListTableAllocationsParams = {}
  ): Promise<TableAllocation[]> {
    return Array.from(this.allocations.values())
      .filter((a) => {
        if (a.organizationId !== organizationId || a.userId !== userId) return false;
        if (params.isActive !== undefined && a.isActive !== params.isActive) return false;
        return true;
      })
      .sort((a, b) => a.id - b.id)
      .map((a) => ({ ...a }));
  }

  public async deactivate(organizationId: number, branchId: number, allocationId: number): Promise<TableAllocation> {
    const existing = this.allocations.get(allocationId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError(`Allocation #${allocationId} not found`, 'ALLOCATION_NOT_FOUND');
    }
    if (existing.branchId !== branchId) {
      throw new NotFoundError(`Allocation #${allocationId} not found`, 'ALLOCATION_NOT_FOUND');
    }
    if (!existing.isActive) {
      throw new BadRequestError('Allocation is already inactive', 'ALLOCATION_ALREADY_INACTIVE');
    }
    existing.isActive = false;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  }

  public async deactivateAllByOrg(organizationId: number): Promise<void> {
    for (const alloc of this.allocations.values()) {
      if (alloc.organizationId === organizationId) {
        alloc.isActive = false;
        alloc.updatedAt = new Date().toISOString();
      }
    }
  }

  public clear(): void {
    this.allocations.clear();
    this.nextId = 1;
  }
}

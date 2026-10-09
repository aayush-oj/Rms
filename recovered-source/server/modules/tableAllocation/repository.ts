import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { TableAllocation, CreateTableAllocationInput, UpdateTableAllocationInput, ListTableAllocationsParams } from './types';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { getDatabasePool, isDatabaseAvailable } from '../../db/pool';
import { TableAllocationMemoryStore } from './memoryStore';

const ER_DUP_ENTRY = 1062;

function mapAllocationRow(row: RowDataPacket): TableAllocation {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    diningTableId: Number(row.dining_table_id),
    userId: Number(row.user_id),
    isActive: Boolean(row.is_active),
    createdBy: Number(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export class TableAllocationRepository {
  private memoryStore = new TableAllocationMemoryStore();

  public getMemoryStore(): TableAllocationMemoryStore {
    return this.memoryStore;
  }

  private pool() {
    return getDatabasePool();
  }

  private async canUseDatabase(): Promise<boolean> {
    return isDatabaseAvailable();
  }

  async create(
    organizationId: number,
    branchId: number,
    input: CreateTableAllocationInput,
    createdBy: number
  ): Promise<TableAllocation> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.create(organizationId, branchId, input, createdBy);
    }

    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      // Validate dining table exists in same org+branch
      const [tables] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ? AND is_active = TRUE',
        [input.diningTableId, organizationId, branchId]
      );
      if (tables.length === 0) {
        throw new NotFoundError('Dining table not found in this branch', 'DINING_TABLE_NOT_FOUND');
      }

      // Validate target user exists, is active, has WAITER role, and has branch access
      const [users] = await conn.execute<RowDataPacket[]>(
        `SELECT u.id, u.is_active, r.name AS role_name
         FROM users u
         INNER JOIN roles r ON u.role_id = r.id
         WHERE u.id = ? AND u.organization_id = ? AND r.name = 'WAITER'`,
        [input.userId, organizationId]
      );
      if (users.length === 0) {
        throw new NotFoundError('Target user not found or does not have WAITER role', 'USER_NOT_FOUND_OR_INVALID_ROLE');
      }
      if (!users[0].is_active) {
        throw new BadRequestError('Target user is inactive', 'USER_INACTIVE');
      }

      // Check user has branch access
      const [branchAccess] = await conn.execute<RowDataPacket[]>(
        'SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ?',
        [input.userId, branchId]
      );
      if (branchAccess.length === 0) {
        throw new ForbiddenError('Target user does not have access to this branch', 'USER_NO_BRANCH_ACCESS');
      }

      // Check for existing active allocation on this table in this branch
      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM table_allocations WHERE dining_table_id = ? AND branch_id = ? AND is_active = TRUE',
        [input.diningTableId, branchId]
      );
      if (existing.length > 0) {
        throw new ConflictError('Table already has an active allocation', 'TABLE_ALREADY_ALLOCATED');
      }

      // Insert new allocation
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO table_allocations (organization_id, branch_id, dining_table_id, user_id, is_active, created_by)
         VALUES (?, ?, ?, ?, TRUE, ?)`,
        [organizationId, branchId, input.diningTableId, input.userId, createdBy]
      );

      await conn.commit();

      // Fetch and return the created allocation
      const created = await this.findById(result.insertId, organizationId, branchId);
      if (!created) {
        throw new NotFoundError('Created allocation not found', 'ALLOCATION_NOT_FOUND');
      }
      return created;
    } catch (err) {
      await conn.rollback();
      if ((err as any).code === ER_DUP_ENTRY) {
        throw new ConflictError('Table already has an active allocation', 'TABLE_ALREADY_ALLOCATED');
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  async reassign(
    organizationId: number,
    branchId: number,
    allocationId: number,
    input: UpdateTableAllocationInput,
    updatedBy: number
  ): Promise<TableAllocation> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.reassign(organizationId, branchId, allocationId, input, updatedBy);
    }

    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      // Lock the existing allocation row
      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM table_allocations WHERE id = ? AND organization_id = ? FOR UPDATE',
        [allocationId, organizationId]
      );
      if (existing.length === 0) {
        throw new NotFoundError(`Allocation #${allocationId} not found`, 'ALLOCATION_NOT_FOUND');
      }
      const allocation = existing[0];
      if (allocation.branch_id !== branchId) {
        throw new ForbiddenError('Allocation does not belong to this branch', 'BRANCH_MISMATCH');
      }
      if (!allocation.is_active) {
        throw new BadRequestError('Cannot reassign inactive allocation', 'ALLOCATION_INACTIVE');
      }

      // Idempotent: if same waiter, return unchanged
      if (Number(allocation.user_id) === input.userId) {
        await conn.commit();
        return mapAllocationRow(allocation);
      }

      // Validate target user exists, is active, has WAITER role, and has branch access
      const [users] = await conn.execute<RowDataPacket[]>(
        `SELECT u.id, u.is_active, r.name AS role_name
         FROM users u
         INNER JOIN roles r ON u.role_id = r.id
         WHERE u.id = ? AND u.organization_id = ? AND r.name = 'WAITER'`,
        [input.userId, organizationId]
      );
      if (users.length === 0) {
        throw new NotFoundError('Target user not found or does not have WAITER role', 'USER_NOT_FOUND_OR_INVALID_ROLE');
      }
      if (!users[0].is_active) {
        throw new BadRequestError('Target user is inactive', 'USER_INACTIVE');
      }

      // Check user has branch access
      const [branchAccess] = await conn.execute<RowDataPacket[]>(
        'SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ?',
        [input.userId, branchId]
      );
      if (branchAccess.length === 0) {
        throw new ForbiddenError('Target user does not have access to this branch', 'USER_NO_BRANCH_ACCESS');
      }

      // Deactivate old allocation
      await conn.execute(
        'UPDATE table_allocations SET is_active = FALSE, updated_at = NOW() WHERE id = ?',
        [allocationId]
      );

      // Create new allocation
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO table_allocations (organization_id, branch_id, dining_table_id, user_id, is_active, created_by)
         VALUES (?, ?, ?, ?, TRUE, ?)`,
        [organizationId, branchId, allocation.dining_table_id, input.userId, updatedBy]
      );

      await conn.commit();

      const created = await this.findById(result.insertId, organizationId, branchId);
      if (!created) {
        throw new NotFoundError('Created allocation not found', 'ALLOCATION_NOT_FOUND');
      }
      return created;
    } catch (err) {
      await conn.rollback();
      if ((err as any).code === ER_DUP_ENTRY) {
        throw new ConflictError('Concurrent allocation conflict', 'CONCURRENT_ALLOCATION_CONFLICT');
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  async findById(id: number, organizationId: number, branchId?: number): Promise<TableAllocation | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findById(id, organizationId, branchId);
    }
    const conditions = 'id = ? AND organization_id = ?' + (branchId != null ? ' AND branch_id = ?' : '');
    const params: any[] = branchId != null ? [id, organizationId, branchId] : [id, organizationId];
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT * FROM table_allocations WHERE ${conditions}`,
      params
    );
    return rows.length > 0 ? mapAllocationRow(rows[0]) : null;
  }

  async listByBranch(
    organizationId: number,
    branchId: number,
    params: ListTableAllocationsParams = {}
  ): Promise<TableAllocation[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listByBranch(organizationId, branchId, params);
    }
    let sql = 'SELECT * FROM table_allocations WHERE organization_id = ? AND branch_id = ?';
    const bindValues: any[] = [organizationId, branchId];

    if (params.isActive !== undefined) {
      sql += ' AND is_active = ?';
      bindValues.push(params.isActive);
    }

    sql += ' ORDER BY id ASC';

    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, bindValues);
    return rows.map(mapAllocationRow);
  }

  async listByUser(
    organizationId: number,
    userId: number,
    params: ListTableAllocationsParams = {}
  ): Promise<TableAllocation[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listByUser(organizationId, userId, params);
    }
    let sql = 'SELECT * FROM table_allocations WHERE organization_id = ? AND user_id = ?';
    const bindValues: any[] = [organizationId, userId];

    if (params.isActive !== undefined) {
      sql += ' AND is_active = ?';
      bindValues.push(params.isActive);
    }

    sql += ' ORDER BY id ASC';

    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, bindValues);
    return rows.map(mapAllocationRow);
  }

  async deactivate(organizationId: number, branchId: number, allocationId: number): Promise<TableAllocation> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deactivate(organizationId, branchId, allocationId);
    }
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM table_allocations WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
        [allocationId, organizationId, branchId]
      );
      if (existing.length === 0) {
        throw new NotFoundError(`Allocation #${allocationId} not found`, 'ALLOCATION_NOT_FOUND');
      }
      if (!existing[0].is_active) {
        throw new BadRequestError('Allocation is already inactive', 'ALLOCATION_ALREADY_INACTIVE');
      }

      await conn.execute(
        'UPDATE table_allocations SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
        [allocationId, organizationId, branchId]
      );

      await conn.commit();

      const updated = await this.findById(allocationId, organizationId, branchId);
      if (!updated) {
        throw new NotFoundError('Allocation not found after deactivation', 'ALLOCATION_NOT_FOUND');
      }
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async deactivateAllByOrg(organizationId: number): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deactivateAllByOrg(organizationId);
    }
    await this.pool().execute(
      'UPDATE table_allocations SET is_active = FALSE WHERE organization_id = ?',
      [organizationId]
    );
  }
}

export const tableAllocationRepository = new TableAllocationRepository();

import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { Department, Customer, Membership } from './types';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapDepartment(row: RowDataPacket): Department {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), branchId: row.branch_id == null ? null : Number(row.branch_id),
    name: String(row.name), code: row.code == null ? null : String(row.code), description: row.description == null ? null : String(row.description),
    displayOrder: Number(row.display_order), isActive: Boolean(row.is_active), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapCustomer(row: RowDataPacket): Customer {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), name: String(row.name), phone: row.phone == null ? null : String(row.phone),
    email: row.email == null ? null : String(row.email), notes: row.notes == null ? null : String(row.notes), creditLimit: Number(row.credit_limit || 0), isActive: Boolean(row.is_active),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapMembership(row: RowDataPacket): Membership {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), customerId: Number(row.customer_id), membershipNumber: String(row.membership_number),
    tier: String(row.tier), startDate: row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : String(row.start_date),
    endDate: row.end_date == null ? null : (row.end_date instanceof Date ? row.end_date.toISOString().slice(0, 10) : String(row.end_date)),
    benefitDiscountRate: Number(row.benefit_discount_rate),
    benefits: typeof row.benefits === 'string' ? (() => { try { return JSON.parse(row.benefits); } catch { return {}; } })() : (row.benefits || {}),
    status: row.status as Membership['status'], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

export class ManagementRepository {
  private pool() { return getDatabasePool(); }

  async listDepartments(orgId: number, branchId?: number): Promise<Department[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT * FROM departments WHERE organization_id = ? AND (branch_id IS NULL OR branch_id = ?) ORDER BY display_order, name, id`,
      [orgId, branchId ?? null]
    );
    return rows.map(mapDepartment);
  }

  private async validateBranch(conn: PoolConnection, orgId: number, branchId: number): Promise<void> {
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT id FROM branches WHERE id = ? AND organization_id = ?', [branchId, orgId]);
    if (!rows.length) throw new NotFoundError('Branch not found in this organization', 'BRANCH_NOT_FOUND');
  }

  async createDepartment(orgId: number, input: { branchId?: number | null; name: string; code?: string; description?: string; displayOrder: number; isActive: boolean }): Promise<Department> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      if (input.branchId != null) await this.validateBranch(conn, orgId, input.branchId);
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO departments (organization_id, branch_id, name, code, description, display_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orgId, input.branchId ?? null, input.name, input.code || null, input.description || null, input.displayOrder, input.isActive ? 1 : 0]
      );
      await conn.commit();
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM departments WHERE id = ? AND organization_id = ?', [result.insertId, orgId]);
      return mapDepartment(rows[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async updateDepartment(orgId: number, id: number, input: Partial<{ branchId: number | null; name: string; code: string; description: string | null; displayOrder: number; isActive: boolean }>): Promise<Department> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [found] = await conn.execute<RowDataPacket[]>('SELECT * FROM departments WHERE id = ? AND organization_id = ? FOR UPDATE', [id, orgId]);
      if (!found.length) throw new NotFoundError('Department not found', 'DEPARTMENT_NOT_FOUND');
      if (input.branchId != null) await this.validateBranch(conn, orgId, input.branchId);
      const current = found[0];
      await conn.execute(
        `UPDATE departments SET branch_id = ?, name = ?, code = ?, description = ?, display_order = ?, is_active = ? WHERE id = ? AND organization_id = ?`,
        [input.branchId !== undefined ? input.branchId : current.branch_id, input.name ?? current.name, input.code !== undefined ? (input.code || null) : current.code,
          input.description !== undefined ? input.description : current.description, input.displayOrder ?? current.display_order, input.isActive === undefined ? current.is_active : input.isActive ? 1 : 0, id, orgId]
      );
      await conn.commit();
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM departments WHERE id = ? AND organization_id = ?', [id, orgId]);
      return mapDepartment(rows[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async setMenuItemDepartment(orgId: number, itemId: number, departmentId: number | null, prepTimeMinutes?: number | null): Promise<void> {
    const [items] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM menu_items WHERE id = ? AND organization_id = ?', [itemId, orgId]);
    if (!items.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
    if (departmentId != null) {
      const [deps] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? AND organization_id = ?', [departmentId, orgId]);
      if (!deps.length) throw new NotFoundError('Department not found', 'DEPARTMENT_NOT_FOUND');
    }
    const field = prepTimeMinutes === undefined ? 'department_id = ?' : 'department_id = ?, prep_time_minutes = ?';
    const params = prepTimeMinutes === undefined ? [departmentId, itemId, orgId] : [departmentId, prepTimeMinutes, itemId, orgId];
    await this.pool().execute(`UPDATE menu_items SET ${field}, updated_at = NOW() WHERE id = ? AND organization_id = ?`, params);
  }

  async listCustomers(orgId: number, search?: string): Promise<Customer[]> {
    let sql = 'SELECT * FROM customers WHERE organization_id = ?'; const params: any[] = [orgId];
    if (search?.trim()) { sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)'; const q = `%${search.trim()}%`; params.push(q, q, q); }
    sql += ' ORDER BY name, id';
    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, params); return rows.map(mapCustomer);
  }

  async createCustomer(orgId: number, input: Partial<Customer> & { name: string }): Promise<Customer> {
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO customers (organization_id, name, phone, email, notes, credit_limit, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orgId, input.name, input.phone ?? null, input.email ?? null, input.notes ?? null, input.creditLimit ?? 0, input.isActive === false ? 0 : 1]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM customers WHERE id = ? AND organization_id = ?', [result.insertId, orgId]); return mapCustomer(rows[0]);
    } catch (err: any) { if (err?.errno === 1062) throw new ConflictError('A customer with this phone already exists', 'CUSTOMER_DUPLICATE'); throw err; }
  }

  async updateCustomer(orgId: number, id: number, input: Partial<Customer>): Promise<Customer> {
    const [existing] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM customers WHERE id = ? AND organization_id = ?', [id, orgId]);
    if (!existing.length) throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
    const row = existing[0];
    await this.pool().execute(
      `UPDATE customers SET name = ?, phone = ?, email = ?, notes = ?, credit_limit = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?`,
      [input.name ?? row.name, input.phone !== undefined ? input.phone : row.phone, input.email !== undefined ? input.email : row.email, input.notes !== undefined ? input.notes : row.notes,
        input.creditLimit === undefined ? Number(row.credit_limit || 0) : input.creditLimit, input.isActive === undefined ? row.is_active : input.isActive ? 1 : 0, id, orgId]
    );
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM customers WHERE id = ? AND organization_id = ?', [id, orgId]); return mapCustomer(rows[0]);
  }

  async customerOrders(orgId: number, customerId: number) {
    const [customer] = await this.pool().execute<RowDataPacket[]>(
      'SELECT id FROM customers WHERE id = ? AND organization_id = ?', [customerId, orgId]
    );
    if (!customer.length) throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT id, order_number, branch_id, dining_table_id, order_status, payment_status, grand_total, created_at
       FROM orders WHERE organization_id = ? AND customer_id = ? ORDER BY created_at DESC`,
      [orgId, customerId]
    );
    return rows.map(r => ({ id: Number(r.id), orderNumber: String(r.order_number), branchId: Number(r.branch_id), diningTableId: r.dining_table_id == null ? null : Number(r.dining_table_id), orderStatus: String(r.order_status), paymentStatus: String(r.payment_status), grandTotal: Number(r.grand_total), createdAt: iso(r.created_at) }));
  }

  async customerMemberships(orgId: number, customerId: number): Promise<Membership[]> {
    const [customerRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT id FROM customers WHERE id = ? AND organization_id = ? AND is_active = 1', [customerId, orgId]
    );
    if (!customerRows.length) throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
    return this.listMemberships(orgId, customerId);
  }

  async listMemberships(orgId: number, customerId?: number): Promise<Membership[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>(`SELECT * FROM memberships WHERE organization_id = ? ${customerId ? 'AND customer_id = ?' : ''} ORDER BY created_at DESC, id DESC`, customerId ? [orgId, customerId] : [orgId]);
    return rows.map(mapMembership);
  }

  async createMembership(orgId: number, input: any): Promise<Membership> {
    const [customer] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM customers WHERE id = ? AND organization_id = ?', [input.customerId, orgId]);
    if (!customer.length) throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO memberships (organization_id, customer_id, membership_number, tier, start_date, end_date, benefit_discount_rate, benefits, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orgId, input.customerId, input.membershipNumber, input.tier, input.startDate, input.endDate ?? null, input.benefitDiscountRate ?? 0, JSON.stringify(input.benefits ?? {}), input.status ?? 'ACTIVE']
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM memberships WHERE id = ? AND organization_id = ?', [result.insertId, orgId]); return mapMembership(rows[0]);
    } catch (err: any) { if (err?.errno === 1062) throw new ConflictError('Membership number already exists', 'MEMBERSHIP_DUPLICATE'); throw err; }
  }

  async updateMembership(orgId: number, id: number, input: any): Promise<Membership> {
    const [existing] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM memberships WHERE id = ? AND organization_id = ?', [id, orgId]);
    if (!existing.length) throw new NotFoundError('Membership not found', 'MEMBERSHIP_NOT_FOUND');
    const r = existing[0];
    await this.pool().execute(
      `UPDATE memberships SET membership_number = ?, tier = ?, start_date = ?, end_date = ?, benefit_discount_rate = ?, benefits = ?, status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?`,
      [input.membershipNumber ?? r.membership_number, input.tier ?? r.tier, input.startDate ?? r.start_date, input.endDate !== undefined ? input.endDate : r.end_date,
        input.benefitDiscountRate ?? r.benefit_discount_rate, JSON.stringify(input.benefits ?? (typeof r.benefits === 'string' ? JSON.parse(r.benefits || '{}') : r.benefits || {})), input.status ?? r.status, id, orgId]
    );
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM memberships WHERE id = ? AND organization_id = ?', [id, orgId]); return mapMembership(rows[0]);
  }

  async listMembershipUsage(orgId: number, membershipId: number) {
    const [membership] = await this.pool().execute<RowDataPacket[]>(
      'SELECT id FROM memberships WHERE id = ? AND organization_id = ?', [membershipId, orgId]
    );
    if (!membership.length) throw new NotFoundError('Membership not found', 'MEMBERSHIP_NOT_FOUND');
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT id, membership_id, customer_id, order_id, benefit_type, benefit_amount, notes, used_at, created_by, created_at
       FROM membership_usages WHERE organization_id = ? AND membership_id = ? ORDER BY used_at DESC, id DESC`,
      [orgId, membershipId]
    );
    return rows.map(row => ({
      id: Number(row.id), membershipId: Number(row.membership_id), customerId: Number(row.customer_id),
      orderId: row.order_id == null ? null : Number(row.order_id), benefitType: String(row.benefit_type),
      benefitAmount: Number(row.benefit_amount), notes: row.notes == null ? null : String(row.notes),
      usedAt: iso(row.used_at), createdBy: row.created_by == null ? null : Number(row.created_by), createdAt: iso(row.created_at),
    }));
  }

  async recordMembershipUsage(orgId: number, membershipId: number, input: { benefitType: string; benefitAmount: number; notes?: string | null; orderId?: number | null; createdBy: number }) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT id, customer_id, status FROM memberships WHERE id = ? AND organization_id = ? FOR UPDATE', [membershipId, orgId]
      );
      if (!rows.length) throw new NotFoundError('Membership not found', 'MEMBERSHIP_NOT_FOUND');
      if (rows[0].status !== 'ACTIVE') throw new BadRequestError('Only active memberships can record usage', 'MEMBERSHIP_INACTIVE');
      if (input.orderId != null) {
        const [orders] = await conn.execute<RowDataPacket[]>(
          'SELECT id, customer_id FROM orders WHERE id = ? AND organization_id = ?', [input.orderId, orgId]
        );
        if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
        if (orders[0].customer_id != null && Number(orders[0].customer_id) !== Number(rows[0].customer_id)) throw new BadRequestError('Usage order belongs to a different customer', 'MEMBERSHIP_CUSTOMER_MISMATCH');
      }
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO membership_usages (organization_id, membership_id, customer_id, order_id, benefit_type, benefit_amount, notes, used_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [orgId, membershipId, Number(rows[0].customer_id), input.orderId ?? null, input.benefitType, input.benefitAmount, input.notes ?? null, input.createdBy]
      );
      await conn.commit();
      return { id: Number(result.insertId), membershipId, customerId: Number(rows[0].customer_id), orderId: input.orderId ?? null, benefitType: input.benefitType, benefitAmount: input.benefitAmount, notes: input.notes ?? null };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async listAccess(orgId: number, userId: number, branchId?: number, visibleBranchIds?: number[]) {
    const scoped = visibleBranchIds && visibleBranchIds.length > 0;
    const branchFilter = scoped ? `AND branch_id IN (${visibleBranchIds!.map(() => '?').join(',')})` : '';
    const baseParams = scoped ? [orgId, userId, ...visibleBranchIds!] : [orgId, userId];
    const [branches] = await this.pool().execute<RowDataPacket[]>(
      `SELECT branch_id FROM user_branches WHERE organization_id = ? AND user_id = ? ${branchFilter} ORDER BY branch_id`, baseParams);
    const scopeClause = scoped ? `AND usa.branch_id IN (${visibleBranchIds!.map(() => '?').join(',')})` : '';
    const scopeTableClause = scoped ? `AND uta.branch_id IN (${visibleBranchIds!.map(() => '?').join(',')})` : '';
    const branchClause = branchId ? 'AND usa.branch_id = ?' : '';
    const branchTableClause = branchId ? 'AND uta.branch_id = ?' : '';
    const sectionParams = [orgId, userId, ...(visibleBranchIds || []), ...(branchId ? [branchId] : [])];
    const tableParams = [orgId, userId, ...(visibleBranchIds || []), ...(branchId ? [branchId] : [])];
    const [sections] = await this.pool().execute<RowDataPacket[]>(
      `SELECT usa.branch_id, usa.section_id, s.name, s.floor_id
       FROM user_section_access usa
       JOIN sections s ON s.id = usa.section_id
       WHERE usa.organization_id = ? AND usa.user_id = ? ${scopeClause} ${branchClause}
       ORDER BY usa.branch_id, s.name`, sectionParams);
    const [tables] = await this.pool().execute<RowDataPacket[]>(
      `SELECT uta.branch_id, uta.dining_table_id, t.table_number, t.section_id
       FROM user_table_access uta
       JOIN dining_tables t ON t.id = uta.dining_table_id
       WHERE uta.organization_id = ? AND uta.user_id = ? ${scopeTableClause} ${branchTableClause}
       ORDER BY uta.branch_id, t.table_number`, tableParams);
    return {
      branchIds: branches.map(r => Number(r.branch_id)),
      sections: sections.map(r => ({ branchId: Number(r.branch_id), id: Number(r.section_id), name: String(r.name), floorId: Number(r.floor_id) })),
      tables: tables.map(r => ({ branchId: Number(r.branch_id), id: Number(r.dining_table_id), tableNumber: String(r.table_number), sectionId: Number(r.section_id) })),
      sectionIds: sections.map(r => Number(r.section_id)),
      tableIds: tables.map(r => Number(r.dining_table_id)),
    };
  }

  async setAccess(orgId: number, userId: number, branchIds: number[], sectionIds: number[], tableIds: number[], actorUserId: number, actorAllowedBranchIds: number[], actorIsPrivileged: boolean): Promise<void> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [target] = await conn.execute<RowDataPacket[]>('SELECT id, default_branch_id FROM users WHERE id = ? AND organization_id = ? FOR UPDATE', [userId, orgId]);
      if (!target.length) throw new NotFoundError('Staff member not found', 'USER_NOT_FOUND');
      const uniqueBranches = [...new Set(branchIds)];
      if (!uniqueBranches.includes(Number(target[0].default_branch_id))) uniqueBranches.push(Number(target[0].default_branch_id));
      if (!actorIsPrivileged && uniqueBranches.some(id => !actorAllowedBranchIds.includes(id))) {
        throw new ForbiddenError('You cannot grant branch access outside your authorized branches', 'FORBIDDEN_BRANCH_ASSIGNMENT');
      }
      for (const branchId of uniqueBranches) await this.validateBranch(conn, orgId, branchId);
      const uniqueSections = [...new Set(sectionIds)];
      const uniqueTables = [...new Set(tableIds)];
      const [allSections] = await conn.execute<RowDataPacket[]>(`SELECT id, branch_id FROM sections WHERE organization_id = ? AND id IN (${uniqueSections.length ? uniqueSections.map(() => '?').join(',') : 'NULL'})`, [orgId, ...uniqueSections]);
      if (allSections.length !== uniqueSections.length) throw new BadRequestError('One or more rooms/areas are outside this organization', 'INVALID_SECTION_ACCESS');
      if (allSections.some(r => !uniqueBranches.includes(Number(r.branch_id)))) throw new BadRequestError('Room access requires branch access', 'SECTION_BRANCH_ACCESS_MISSING');
      const [allTables] = await conn.execute<RowDataPacket[]>(`SELECT id, branch_id FROM dining_tables WHERE organization_id = ? AND id IN (${uniqueTables.length ? uniqueTables.map(() => '?').join(',') : 'NULL'})`, [orgId, ...uniqueTables]);
      if (allTables.length !== uniqueTables.length) throw new BadRequestError('One or more tables are outside this organization', 'INVALID_TABLE_ACCESS');
      if (allTables.some(r => !uniqueBranches.includes(Number(r.branch_id)))) throw new BadRequestError('Table access requires branch access', 'TABLE_BRANCH_ACCESS_MISSING');

      await conn.execute('DELETE FROM user_branches WHERE user_id = ? AND organization_id = ?', [userId, orgId]);
      for (const branchId of uniqueBranches) await conn.execute('INSERT INTO user_branches (user_id, organization_id, branch_id) VALUES (?, ?, ?)', [userId, orgId, branchId]);
      await conn.execute('DELETE FROM user_section_access WHERE user_id = ? AND organization_id = ?', [userId, orgId]);
      for (const row of allSections) await conn.execute('INSERT INTO user_section_access (user_id, organization_id, branch_id, section_id) VALUES (?, ?, ?, ?)', [userId, orgId, Number(row.branch_id), Number(row.id)]);
      await conn.execute('DELETE FROM user_table_access WHERE user_id = ? AND organization_id = ?', [userId, orgId]);
      for (const row of allTables) await conn.execute('INSERT INTO user_table_access (user_id, organization_id, branch_id, dining_table_id) VALUES (?, ?, ?, ?)', [userId, orgId, Number(row.branch_id), Number(row.id)]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    void actorUserId;
  }

  async canAccessSection(orgId: number, userId: number, branchId: number, sectionId: number, permissions: string[]): Promise<boolean> {
    const [section] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM sections WHERE id = ? AND organization_id = ? AND branch_id = ?', [sectionId, orgId, branchId]);
    if (!section.length) return false;
    if (permissions.includes('admin:all') || permissions.includes('admin:tables:manage') || permissions.includes('admin:access:manage')) return true;
    const [branch] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_branches WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [userId, orgId, branchId]);
    if (!branch.length) return false;
    const [explicitTable] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_table_access WHERE user_id = ? AND organization_id = ? AND branch_id = ? LIMIT 1', [userId, orgId, branchId]);
    if (explicitTable.length) {
      const [match] = await this.pool().execute<RowDataPacket[]>(`SELECT 1 FROM user_table_access uta JOIN dining_tables t ON t.id = uta.dining_table_id WHERE uta.user_id = ? AND uta.organization_id = ? AND uta.branch_id = ? AND t.section_id = ?`, [userId, orgId, branchId, sectionId]);
      return match.length > 0;
    }
    const [explicitSection] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_section_access WHERE user_id = ? AND organization_id = ? AND branch_id = ? LIMIT 1', [userId, orgId, branchId]);
    if (explicitSection.length) {
      const [match] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_section_access WHERE user_id = ? AND organization_id = ? AND branch_id = ? AND section_id = ?', [userId, orgId, branchId, sectionId]);
      return match.length > 0;
    }
    return true;
  }

  async accessibleTableIds(orgId: number, userId: number, branchId: number, permissions: string[]): Promise<number[]> {
    if (permissions.includes('admin:all') || permissions.includes('admin:tables:manage') || permissions.includes('admin:access:manage')) {
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM dining_tables WHERE organization_id = ? AND branch_id = ? AND is_active = 1', [orgId, branchId]);
      return rows.map(row => Number(row.id));
    }
    const [branch] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_branches WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [userId, orgId, branchId]);
    if (!branch.length) return [];
    const [explicitTables] = await this.pool().execute<RowDataPacket[]>('SELECT dining_table_id FROM user_table_access WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [userId, orgId, branchId]);
    if (explicitTables.length) return explicitTables.map(row => Number(row.dining_table_id));
    const [explicitSections] = await this.pool().execute<RowDataPacket[]>('SELECT section_id FROM user_section_access WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [userId, orgId, branchId]);
    if (explicitSections.length) {
      const placeholders = explicitSections.map(() => '?').join(',');
      const [tables] = await this.pool().execute<RowDataPacket[]>(`SELECT id FROM dining_tables WHERE organization_id = ? AND branch_id = ? AND section_id IN (${placeholders}) AND is_active = 1`, [orgId, branchId, ...explicitSections.map(row => Number(row.section_id))]);
      return tables.map(row => Number(row.id));
    }
    const [tables] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM dining_tables WHERE organization_id = ? AND branch_id = ? AND is_active = 1', [orgId, branchId]);
    return tables.map(row => Number(row.id));
  }

  async canAccessTable(orgId: number, userId: number, branchId: number, tableId: number, permissions: string[]): Promise<boolean> {
    const [table] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ?', [tableId, orgId, branchId]);
    if (!table.length) return false;
    if (permissions.includes('admin:all') || permissions.includes('admin:tables:manage') || permissions.includes('admin:access:manage')) return true;
    const [branch] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_branches WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [userId, orgId, branchId]);
    if (!branch.length) return false;
    const [explicitTable] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_table_access WHERE user_id = ? AND organization_id = ? AND branch_id = ? LIMIT 1', [userId, orgId, branchId]);
    if (explicitTable.length) {
      const [match] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_table_access WHERE user_id = ? AND organization_id = ? AND branch_id = ? AND dining_table_id = ?', [userId, orgId, branchId, tableId]);
      return match.length > 0;
    }
    const [explicitSection] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_section_access WHERE user_id = ? AND organization_id = ? AND branch_id = ? LIMIT 1', [userId, orgId, branchId]);
    if (explicitSection.length) {
      const [match] = await this.pool().execute<RowDataPacket[]>(`SELECT 1 FROM dining_tables t JOIN user_section_access usa ON usa.section_id = t.section_id AND usa.user_id = ? AND usa.organization_id = ? AND usa.branch_id = ? WHERE t.id = ? AND t.organization_id = ? AND t.branch_id = ?`, [userId, orgId, branchId, tableId, orgId, branchId]);
      return match.length > 0;
    }
    return true;
  }

  async assignTableWaiter(orgId: number, branchId: number, tableId: number, waiterId: number | null) {
    const [table] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ?', [tableId, orgId, branchId]);
    if (!table.length) throw new NotFoundError('Table not found in branch', 'DINING_TABLE_NOT_FOUND');
    if (waiterId != null) {
      const [waiter] = await this.pool().execute<RowDataPacket[]>(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.organization_id = ? AND u.is_active = 1 AND r.name = 'WAITER'`, [waiterId, orgId]);
      if (!waiter.length) throw new BadRequestError('Assigned staff member must be an active WAITER', 'INVALID_WAITER');
      const [access] = await this.pool().execute<RowDataPacket[]>('SELECT 1 FROM user_branches WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [waiterId, orgId, branchId]);
      if (!access.length) throw new BadRequestError('Waiter does not have branch access', 'WAITER_NO_BRANCH_ACCESS');
    }
    await this.pool().execute('UPDATE dining_tables SET assigned_waiter_id = ? WHERE id = ? AND organization_id = ? AND branch_id = ?', [waiterId, tableId, orgId, branchId]);
  }

  async createRole(orgId: number, name: string, description: string | null, permissionIds: number[], actorPermissions: string[]) {
    const [systemRole] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM roles WHERE organization_id IS NULL AND LOWER(name) = LOWER(?)', [name]);
    if (systemRole.length) throw new BadRequestError('System role names are reserved', 'SYSTEM_ROLE_IMMUTABLE');
    if (!actorPermissions.includes('admin:all') && !actorPermissions.includes('admin:roles:manage')) throw new ForbiddenError('Role management permission required', 'FORBIDDEN_PERMISSION');
    const [perms] = await this.pool().execute<RowDataPacket[]>('SELECT id, code FROM permissions WHERE id IN (' + (permissionIds.length ? permissionIds.map(() => '?').join(',') : 'NULL') + ')', permissionIds);
    const allowed = new Set(actorPermissions);
    if (!actorPermissions.includes('admin:all') && perms.some(p => !allowed.has(String(p.code)))) throw new ForbiddenError('You cannot grant a permission you do not possess', 'ROLE_PERMISSION_ESCALATION');
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [existing] = await conn.execute<RowDataPacket[]>('SELECT id FROM roles WHERE organization_id = ? AND LOWER(name) = LOWER(?)', [orgId, name]);
      if (existing.length) throw new ConflictError('Role name already exists', 'ROLE_DUPLICATE');
      const [result] = await conn.execute<ResultSetHeader>('INSERT INTO roles (organization_id, name, description, is_system) VALUES (?, ?, ?, FALSE)', [orgId, name, description]);
      for (const row of perms) await conn.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [result.insertId, Number(row.id)]);
      await conn.commit();
      return Number(result.insertId);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async setRolePermissions(orgId: number, roleId: number, permissionIds: number[], actorPermissions: string[]) {
    if (!actorPermissions.includes('admin:all') && !actorPermissions.includes('admin:roles:manage')) throw new ForbiddenError('Role management permission required', 'FORBIDDEN_PERMISSION');
    const [role] = await this.pool().execute<RowDataPacket[]>('SELECT id, is_system, organization_id FROM roles WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)', [roleId, orgId]);
    if (!role.length) throw new NotFoundError('Role not found', 'ROLE_NOT_FOUND');
    if (Boolean(role[0].is_system)) throw new BadRequestError('System roles cannot be modified', 'SYSTEM_ROLE_IMMUTABLE');
    const [perms] = await this.pool().execute<RowDataPacket[]>('SELECT id, code FROM permissions WHERE id IN (' + (permissionIds.length ? permissionIds.map(() => '?').join(',') : 'NULL') + ')', permissionIds);
    if (!actorPermissions.includes('admin:all') && perms.some(p => !actorPermissions.includes(String(p.code)))) throw new ForbiddenError('You cannot grant a permission you do not possess', 'ROLE_PERMISSION_ESCALATION');
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
      for (const row of perms) await conn.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, Number(row.id)]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }
}

export const managementRepository = new ManagementRepository();

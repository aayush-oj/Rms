import { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getDatabasePool, isDatabaseAvailable } from '../../db/pool';
import { logger } from '../../lib/logger';
import { IdentityMemoryStore } from './memoryStore';
import bcrypt from 'bcryptjs';
import { ConflictError } from '../../shared/errors';
import {
  Organization,
  Branch,
  Role,
  Permission,
  User,
  UserWithSecrets,
  SYSTEM_ROLES,
  SYSTEM_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from './types';

const BOOTSTRAP_PIN = '1234';
const BOOTSTRAP_PIN_SALT_ROUNDS = 10;

function organizationHandleBase(name: unknown): string {
  let clean = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  if (!/^[a-z]/.test(clean)) clean = `rms${clean}`;
  if (clean.length < 3) clean = `${clean}rms`;
  return clean.slice(0, 15);
}

function toDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function toBool(val: unknown): boolean {
  return val === true || val === 1 || val === '1';
}

function parseSettings(val: unknown): Record<string, unknown> {
  if (!val) return {};
  if (typeof val === 'object') return val as Record<string, unknown>;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return {};
}

export class IdentityRepository {
  private memoryStore = new IdentityMemoryStore();

  private pool(): Pool {
    return getDatabasePool();
  }

  private async canUseDatabase(): Promise<boolean> {
    return isDatabaseAvailable();
  }

  private async availableOrganizationHandle(
    name: string,
    requestedHandle?: string,
    connection?: PoolConnection,
  ): Promise<string> {
    const normalizedRequested = String(requestedHandle ?? '').trim().toLowerCase();
    const base = /^[a-z][a-z0-9]{2,14}$/.test(normalizedRequested)
      ? normalizedRequested
      : organizationHandleBase(name);
    const db = connection ?? this.pool();

    for (let suffix = 1; suffix < 10000; suffix += 1) {
      const suffixText = suffix === 1 ? '' : String(suffix);
      const candidate = suffix === 1
        ? base
        : `${base.slice(0, Math.max(3, 15 - suffixText.length))}${suffixText}`;
      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM organizations WHERE handle = ? LIMIT 1',
        [candidate],
      );
      if (rows.length === 0) return candidate;
    }

    throw new ConflictError('Unable to generate a unique restaurant handle');
  }

  public async initialize(): Promise<void> {
    if (!(await this.canUseDatabase())) {
      this.memoryStore.initialize();
      logger.info('[IdentityRepository] In-memory identity store initialized (MySQL unavailable).');
      return;
    }

    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      // Seed permissions
      for (const p of SYSTEM_PERMISSIONS) {
        await conn.execute(
          'INSERT IGNORE INTO permissions (code, module, description) VALUES (?, ?, ?)',
          [p.code, p.module, p.description]
        );
      }

      // Seed system roles
      for (const [roleKey, roleName] of Object.entries(SYSTEM_ROLES)) {
        await conn.execute(
          'INSERT IGNORE INTO roles (organization_id, name, description, is_system) VALUES (NULL, ?, ?, TRUE)',
          [roleName, `Standard system ${roleName} role`]
        );
      }

      // Map roles and permissions for role_permissions seeding
      const [roleRows] = await conn.execute<RowDataPacket[]>(
        'SELECT id, name FROM roles WHERE organization_id IS NULL'
      );
      const [permRows] = await conn.execute<RowDataPacket[]>(
        'SELECT id, code FROM permissions'
      );

      const roleIdMap = new Map<string, number>();
      for (const r of roleRows) roleIdMap.set(r.name as string, Number(r.id));

      const permIdMap = new Map<string, number>();
      for (const p of permRows) permIdMap.set(p.code as string, Number(p.id));

      // Seed role_permissions
      for (const [roleKey, roleName] of Object.entries(SYSTEM_ROLES)) {
        const roleId = roleIdMap.get(roleName);
        if (!roleId) {
          logger.warn(`[IdentityRepository] Role ID not found for system role: ${roleName}`);
          continue;
        }
        const perms = ROLE_DEFAULT_PERMISSIONS[roleKey] || [];
        for (const permCode of perms) {
          const permId = permIdMap.get(permCode);
          if (permId) {
            await conn.execute(
              'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
              [roleId, permId]
            );
          } else {
            logger.warn(`[IdentityRepository] Permission ID not found for code: ${permCode} (for role ${roleName})`);
          }
        }
      }

      // 4. Bootstrap OWNER repair: create a bootstrap OWNER for any org with zero OWNER users
      const [orgRows] = await conn.execute<RowDataPacket[]>(
        `SELECT o.id, o.name, b.id AS default_branch_id
         FROM organizations o
         INNER JOIN branches b ON b.organization_id = o.id AND b.is_active = 1
         WHERE o.status = ?`,
        ['ACTIVE']
      );
      const ownerRoleId = roleIdMap.get(SYSTEM_ROLES.OWNER);
      if (ownerRoleId && orgRows.length > 0) {
        for (const org of orgRows) {
          const orgId = Number(org.id);
          const defaultBranchId = Number(org.default_branch_id);

          // Check if org already has at least one OWNER user
          const [ownerCount] = await conn.execute<RowDataPacket[]>(
            "SELECT COUNT(*) AS cnt FROM users u JOIN roles r ON r.id = u.role_id WHERE u.organization_id = ? AND r.name = 'OWNER'",
            [orgId]
          );
          if (Number(ownerCount[0].cnt) > 0) {
            continue; // OWNER exists — do nothing
          }

          // No OWNER — create a bootstrap OWNER
          const bootstrapPinHash = await bcrypt.hash(BOOTSTRAP_PIN, BOOTSTRAP_PIN_SALT_ROUNDS);
          await conn.execute(
            `INSERT IGNORE INTO users (organization_id, default_branch_id, role_id, name, username, password_hash, pin_hash, is_active, must_change_pin)
             VALUES (?, ?, ?, ?, ?, '', ?, 1, TRUE)`,
            [orgId, defaultBranchId, ownerRoleId, `${org.name} Owner`, 'owner', bootstrapPinHash]
          );

          // Ensure branch access for the bootstrap OWNER
          const [insertedUser] = await conn.execute<RowDataPacket[]>(
            'SELECT id FROM users WHERE organization_id = ? AND role_id = ? LIMIT 1',
            [orgId, ownerRoleId]
          );
          if (insertedUser.length) {
            const bootstrapUserId = Number(insertedUser[0].id);
            await conn.execute(
              'INSERT IGNORE INTO user_branches (user_id, organization_id, branch_id) VALUES (?, ?, ?)',
              [bootstrapUserId, orgId, defaultBranchId]
            );
          }

          logger.info(`[IdentityRepository] Bootstrap OWNER created for organization "${org.name}" (org #${orgId})`);
        }
      }

      await conn.commit();
      logger.info('[IdentityRepository] System roles and permissions initialized in MySQL');
    } catch (err) {
      await conn.rollback();
      logger.error('[IdentityRepository] Failed to initialize system roles and permissions, rolling back:', { error: err });
      throw err;
    } finally {
      conn.release();
    }
  }

  // ==========================================
  // ORGANIZATIONS
  // ==========================================

  public async findOrganizationById(id: number): Promise<Organization | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findOrganizationById(id);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM organizations WHERE id = ?',
      [id]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      name: r.name,
      legalName: r.legal_name,
      taxIdentifier: r.tax_identifier,
      currencyCode: r.currency_code,
      status: r.status,
      settings: parseSettings(r.settings),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  public async findOrganizationByName(name: string): Promise<Organization | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findOrganizationByName(name);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM organizations WHERE LOWER(name) = LOWER(?)',
      [name]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      name: r.name,
      legalName: r.legal_name,
      taxIdentifier: r.tax_identifier,
      currencyCode: r.currency_code,
      status: r.status,
      settings: parseSettings(r.settings),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  public async createOrganization(data: {
    name: string;
    handle?: string;
    legalName?: string;
    taxIdentifier?: string;
    currencyCode?: string;
    settings?: Record<string, unknown>;
  }): Promise<Organization> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createOrganization({
        name: data.name,
        legalName: data.legalName,
        taxIdentifier: data.taxIdentifier,
        currencyCode: data.currencyCode,
        settings: data.settings,
      });
    }
    const handle = await this.availableOrganizationHandle(data.name, data.handle);
    const [result] = await this.pool().execute<ResultSetHeader>(
      `INSERT INTO organizations (handle, name, legal_name, tax_identifier, currency_code, status, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        handle,
        data.name,
        data.legalName || null,
        data.taxIdentifier || null,
        data.currencyCode || 'NPR',
        'ACTIVE',
        JSON.stringify(data.settings || {}),
      ]
    );

    const org = await this.findOrganizationById(Number(result.insertId));
    if (!org) throw new Error('Failed to retrieve created organization');
    return org;
  }

  public async updateOrganization(
    id: number,
    data: Partial<Pick<Organization, 'name' | 'legalName' | 'taxIdentifier' | 'currencyCode' | 'status' | 'settings'>>
  ): Promise<Organization | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateOrganization(id, data);
    }
    const existing = await this.findOrganizationById(id);
    if (!existing) return null;

    const updated = {
      name: data.name !== undefined ? data.name : existing.name,
      legalName: data.legalName !== undefined ? data.legalName : existing.legalName,
      taxIdentifier: data.taxIdentifier !== undefined ? data.taxIdentifier : existing.taxIdentifier,
      currencyCode: data.currencyCode !== undefined ? data.currencyCode : existing.currencyCode,
      status: data.status !== undefined ? data.status : existing.status,
      settings: data.settings ? { ...existing.settings, ...data.settings } : existing.settings,
    };

    await this.pool().execute(
      `UPDATE organizations SET name = ?, legal_name = ?, tax_identifier = ?, currency_code = ?, status = ?, settings = ?, updated_at = NOW() WHERE id = ?`,
      [
        updated.name,
        updated.legalName,
        updated.taxIdentifier,
        updated.currencyCode,
        updated.status,
        JSON.stringify(updated.settings),
        id,
      ]
    );

    return this.findOrganizationById(id);
  }

  public async deleteOrganizationCascade(orgId: number): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteOrganizationCascade(orgId);
    }
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'DELETE s FROM sessions s INNER JOIN users u ON s.user_id = u.id WHERE u.organization_id = ?',
        [orgId]
      );
      await conn.execute('DELETE FROM user_branches WHERE organization_id = ?', [orgId]);
      await conn.execute('DELETE FROM users WHERE organization_id = ?', [orgId]);
      await conn.execute('DELETE FROM branches WHERE organization_id = ?', [orgId]);
      await conn.execute('DELETE FROM organizations WHERE id = ?', [orgId]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // ==========================================
  // BRANCHES (Strict Tenant Scoped)
  // ==========================================

  private mapBranch(r: RowDataPacket): Branch {
    return {
      id: Number(r.id),
      organizationId: Number(r.organization_id),
      name: r.name,
      code: r.code,
      address: r.address,
      latitude: r.latitude == null ? null : Number(r.latitude),
      longitude: r.longitude == null ? null : Number(r.longitude),
      phone: r.phone,
      email: r.email,
      billPrefix: r.bill_prefix,
      timezone: String(r.timezone || 'Asia/Kathmandu'),
      isActive: toBool(r.is_active),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  public async findBranchesByOrgId(organizationId: number): Promise<Branch[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findBranchesByOrgId(organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM branches WHERE organization_id = ?',
      [organizationId]
    );
    return rows.map(r => this.mapBranch(r));
  }

  public async findBranchById(organizationId: number, branchId: number): Promise<Branch | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findBranchById(organizationId, branchId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM branches WHERE id = ? AND organization_id = ?',
      [branchId, organizationId]
    );
    if (!rows.length) return null;
    return this.mapBranch(rows[0]);
  }

  public async findBranchByCode(organizationId: number, code: string): Promise<Branch | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findBranchByCode(organizationId, code);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM branches WHERE organization_id = ? AND UPPER(code) = UPPER(?)',
      [organizationId, code]
    );
    if (!rows.length) return null;
    return this.mapBranch(rows[0]);
  }

  public async createBranch(data: {
    organizationId: number;
    name: string;
    code: string;
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    phone?: string;
    email?: string;
    billPrefix?: string;
    timezone?: string;
  }): Promise<Branch> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createBranch(data);
    }
    const [result] = await this.pool().execute<ResultSetHeader>(
      `INSERT INTO branches (
         organization_id,
         name,
         code,
         address,
         latitude,
         longitude,
         phone,
         email,
         bill_prefix,
         timezone,
         is_active
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.organizationId,
        data.name,
        data.code.toUpperCase(),
        data.address || null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.phone || null,
        data.email || null,
        data.billPrefix || 'FH-',
        data.timezone || 'Asia/Kathmandu',
        1,
      ]
    );

    const branch = await this.findBranchById(data.organizationId, Number(result.insertId));
    if (!branch) throw new Error('Failed to retrieve created branch');
    return branch;
  }

  public async updateBranch(
    organizationId: number,
    branchId: number,
    data: Partial<Pick<Branch, 'name' | 'code' | 'address' | 'latitude' | 'longitude' | 'phone' | 'email' | 'billPrefix' | 'timezone' | 'isActive'>>
  ): Promise<Branch | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateBranch(organizationId, branchId, data);
    }
    const existing = await this.findBranchById(organizationId, branchId);
    if (!existing) return null;

    const updated = {
      name: data.name !== undefined ? data.name : existing.name,
      code: data.code ? data.code.toUpperCase() : existing.code,
      address: data.address !== undefined ? data.address : existing.address,
      latitude: data.latitude !== undefined ? data.latitude : existing.latitude,
      longitude: data.longitude !== undefined ? data.longitude : existing.longitude,
      phone: data.phone !== undefined ? data.phone : existing.phone,
      email: data.email !== undefined ? data.email : existing.email,
      billPrefix: data.billPrefix !== undefined ? data.billPrefix : existing.billPrefix,
      timezone: data.timezone !== undefined ? data.timezone : existing.timezone,
      isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
    };

    await this.pool().execute(
      `UPDATE branches
          SET name = ?,
              code = ?,
              address = ?,
              latitude = ?,
              longitude = ?,
              phone = ?,
              email = ?,
              bill_prefix = ?,
              timezone = ?,
              is_active = ?,
              updated_at = NOW()
        WHERE id = ?
          AND organization_id = ?`,
      [
        updated.name,
        updated.code,
        updated.address,
        updated.latitude,
        updated.longitude,
        updated.phone,
        updated.email,
        updated.billPrefix,
        updated.timezone,
        updated.isActive ? 1 : 0,
        branchId,
        organizationId,
      ]
    );

    return this.findBranchById(organizationId, branchId);
  }

  // ==========================================
  // ROLES & PERMISSIONS
  // ==========================================

  public async getRoles(organizationId?: number): Promise<Role[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getRoles(organizationId);
    }
    let sql: string;
    let params: any[];

    if (organizationId) {
      sql = `SELECT r.id, r.organization_id, r.name, r.description, r.is_system,
               COALESCE(GROUP_CONCAT(p.code ORDER BY p.code), '') AS permission_codes
             FROM roles r
             LEFT JOIN role_permissions rp ON rp.role_id = r.id
             LEFT JOIN permissions p ON p.id = rp.permission_id
             WHERE r.organization_id IS NULL OR r.organization_id = ?
             GROUP BY r.id, r.organization_id, r.name, r.description, r.is_system`;
      params = [organizationId];
    } else {
      sql = `SELECT r.id, r.organization_id, r.name, r.description, r.is_system,
               COALESCE(GROUP_CONCAT(p.code ORDER BY p.code), '') AS permission_codes
             FROM roles r
             LEFT JOIN role_permissions rp ON rp.role_id = r.id
             LEFT JOIN permissions p ON p.id = rp.permission_id
             GROUP BY r.id, r.organization_id, r.name, r.description, r.is_system`;
      params = [];
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, params);
    return rows.map(r => ({
      id: Number(r.id),
      organizationId: r.organization_id != null ? Number(r.organization_id) : null,
      name: r.name,
      description: r.description,
      isSystem: toBool(r.is_system),
      permissions: r.permission_codes ? (r.permission_codes as string).split(',') : [],
    }));
  }

  public async getRoleById(roleId: number, organizationId?: number): Promise<Role | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getRoleById(roleId, organizationId);
    }
    const sql = `SELECT r.id, r.organization_id, r.name, r.description, r.is_system,
                   COALESCE(GROUP_CONCAT(p.code ORDER BY p.code), '') AS permission_codes
                 FROM roles r
                 LEFT JOIN role_permissions rp ON rp.role_id = r.id
                 LEFT JOIN permissions p ON p.id = rp.permission_id
                 WHERE r.id = ?
                 GROUP BY r.id, r.organization_id, r.name, r.description, r.is_system`;
    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, [roleId]);
    if (!rows.length) return null;
    const r = rows[0];
    if (r.organization_id != null && organizationId && Number(r.organization_id) !== organizationId) {
      return null;
    }
    return {
      id: Number(r.id),
      organizationId: r.organization_id != null ? Number(r.organization_id) : null,
      name: r.name,
      description: r.description,
      isSystem: toBool(r.is_system),
      permissions: r.permission_codes ? (r.permission_codes as string).split(',') : [],
    };
  }

  public async getRoleByName(name: string, organizationId?: number): Promise<Role | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getRoleByName(name, organizationId);
    }
    let sql: string;
    let params: any[];

    if (organizationId) {
      sql = `SELECT r.id, r.organization_id, r.name, r.description, r.is_system,
               COALESCE(GROUP_CONCAT(p.code ORDER BY p.code), '') AS permission_codes
             FROM roles r
             LEFT JOIN role_permissions rp ON rp.role_id = r.id
             LEFT JOIN permissions p ON p.id = rp.permission_id
             WHERE UPPER(r.name) = UPPER(?) AND (r.organization_id IS NULL OR r.organization_id = ?)
             GROUP BY r.id, r.organization_id, r.name, r.description, r.is_system`;
      params = [name, organizationId];
    } else {
      sql = `SELECT r.id, r.organization_id, r.name, r.description, r.is_system,
               COALESCE(GROUP_CONCAT(p.code ORDER BY p.code), '') AS permission_codes
             FROM roles r
             LEFT JOIN role_permissions rp ON rp.role_id = r.id
             LEFT JOIN permissions p ON p.id = rp.permission_id
             WHERE UPPER(r.name) = UPPER(?)
             GROUP BY r.id, r.organization_id, r.name, r.description, r.is_system`;
      params = [name];
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, params);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      organizationId: r.organization_id != null ? Number(r.organization_id) : null,
      name: r.name,
      description: r.description,
      isSystem: toBool(r.is_system),
      permissions: r.permission_codes ? (r.permission_codes as string).split(',') : [],
    };
  }

  public async getPermissions(): Promise<Permission[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getPermissions();
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM permissions ORDER BY code'
    );
    return rows.map(r => ({
      id: Number(r.id),
      code: r.code,
      module: r.module,
      description: r.description,
    }));
  }

  // ==========================================
  // USERS (Strict Tenant Scoped)
  // ==========================================

  private mapUser(r: RowDataPacket): User {
    return {
      id: Number(r.id),
      organizationId: Number(r.organization_id),
      defaultBranchId: Number(r.default_branch_id),
      roleId: Number(r.role_id),
      roleName: r.role_name || r.roleName || '',
      name: r.name,
      username: r.username,
      email: r.email,
      avatarUrl: r.avatar_url,
      isActive: toBool(r.is_active),
      mustChangePin: toBool(r.must_change_pin),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  private mapUserWithSecrets(r: RowDataPacket): UserWithSecrets {
    const user = this.mapUser(r);
    return {
      ...user,
      passwordHash: r.password_hash,
      pinHash: r.pin_hash,
    };
  }

  private userBaseSql(): string {
    return `SELECT u.*, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id`;
  }

  public async findUsersByOrgId(organizationId: number): Promise<User[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUsersByOrgId(organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `${this.userBaseSql()} WHERE u.organization_id = ?`,
      [organizationId]
    );
    return rows.map(r => this.mapUser(r));
  }

  public async findUserById(organizationId: number, userId: number): Promise<UserWithSecrets | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUserById(organizationId, userId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `${this.userBaseSql()} WHERE u.id = ? AND u.organization_id = ?`,
      [userId, organizationId]
    );
    if (!rows.length) return null;
    return this.mapUserWithSecrets(rows[0]);
  }

  public async findUserByIdGlobal(userId: number): Promise<UserWithSecrets | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUserByIdGlobal(userId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `${this.userBaseSql()} WHERE u.id = ?`,
      [userId]
    );
    if (!rows.length) return null;
    return this.mapUserWithSecrets(rows[0]);
  }

  public async findUserByUsername(organizationId: number, username: string): Promise<UserWithSecrets | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUserByUsername(organizationId, username);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `${this.userBaseSql()} WHERE u.organization_id = ? AND LOWER(u.username) = LOWER(?)`,
      [organizationId, username]
    );
    if (!rows.length) return null;
    return this.mapUserWithSecrets(rows[0]);
  }

  public async findUserByUsernameOrEmailGlobal(identifier: string): Promise<UserWithSecrets | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUserByUsernameOrEmailGlobal(identifier);
    }
    const query = identifier.toLowerCase();
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `${this.userBaseSql()} WHERE LOWER(u.username) = LOWER(?) OR LOWER(u.email) = LOWER(?)`,
      [query, query]
    );
    if (!rows.length) return null;
    return this.mapUserWithSecrets(rows[0]);
  }

  public async findUserByPin(organizationId: number, branchId: number, verifyPinFn: (storedHash: string) => boolean): Promise<UserWithSecrets | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUserByPin(organizationId, branchId, verifyPinFn);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `${this.userBaseSql()} WHERE u.organization_id = ? AND u.is_active = 1 AND u.pin_hash IS NOT NULL`,
      [organizationId]
    );

    for (const r of rows) {
      const user = this.mapUserWithSecrets(r);
      const allowedBranches = await this.getUserAllowedBranchIds(user.id, organizationId);
      if (allowedBranches.includes(branchId) || user.defaultBranchId === branchId) {
        if (user.pinHash && verifyPinFn(user.pinHash)) {
          return user;
        }
      }
    }
    return null;
  }

  public async createUser(data: {
    organizationId: number;
    defaultBranchId: number;
    roleId: number;
    name: string;
    username: string;
    email?: string;
    passwordHash?: string;
    pinHash?: string;
    avatarUrl?: string;
    mustChangePin?: boolean;
  }): Promise<UserWithSecrets> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createUser(data);
    }
    const conn = await this.pool().getConnection();
    let userId: number; // Declare userId outside try block to be accessible in finally and for findUserById
    try {
      await conn.beginTransaction();

      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO users (organization_id, default_branch_id, role_id, name, username, email, password_hash, pin_hash, avatar_url, is_active, must_change_pin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId,
          data.defaultBranchId,
          data.roleId,
          data.name,
          data.username,
          data.email || null,
          data.passwordHash || null,
          data.pinHash || null,
          data.avatarUrl || null,
          1,
          data.mustChangePin ? 1 : 0,
        ]
      );
      userId = Number(result.insertId);

      // Pass the connection to setUserBranchAccess to ensure it's part of the same transaction
      await this.setUserBranchAccess(userId, data.organizationId, [data.defaultBranchId], conn);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const user = await this.findUserById(data.organizationId, userId);
    if (!user) throw new Error('Failed to retrieve created user'); // This case should ideally not be reached on successful commit
    return user;
  }

  public async updateUser(
    organizationId: number,
    userId: number,
    data: Partial<Pick<UserWithSecrets, 'name' | 'email' | 'roleId' | 'defaultBranchId' | 'passwordHash' | 'pinHash' | 'avatarUrl' | 'isActive'>>
  ): Promise<UserWithSecrets | null> {
    if (!(await this.canUseDatabase())) return this.memoryStore.updateUser(organizationId, userId, data);

    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [existingRows] = await conn.execute<RowDataPacket[]>(
        `SELECT u.id, u.role_id, u.is_active, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.organization_id = ? FOR UPDATE`,
        [userId, organizationId]
      );
      if (!existingRows.length) { await conn.rollback(); return null; }
      const existing = existingRows[0];
      const removesOwnerAuthority = String(existing.role_name) === 'OWNER' && (data.isActive === false || (data.roleId !== undefined && Number(data.roleId) !== Number(existing.role_id)));
      if (removesOwnerAuthority) {
        const [ownerRows] = await conn.execute<RowDataPacket[]>(
          `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.organization_id = ? AND u.is_active = TRUE AND r.name = 'OWNER' FOR UPDATE`,
          [organizationId]
        );
        if (ownerRows.length <= 1) throw new ConflictError('The final active OWNER cannot be deactivated or demoted', 'FINAL_OWNER_REQUIRED');
      }

      const fields: string[] = []; const params: any[] = [];
      if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
      if (data.email !== undefined) { fields.push('email = ?'); params.push(data.email); }
      if (data.roleId !== undefined) { fields.push('role_id = ?'); params.push(data.roleId); }
      if (data.defaultBranchId !== undefined) { fields.push('default_branch_id = ?'); params.push(data.defaultBranchId); }
      if (data.passwordHash !== undefined) { fields.push('password_hash = ?'); params.push(data.passwordHash); }
      if (data.pinHash !== undefined) { fields.push('pin_hash = ?'); params.push(data.pinHash); }
      if (data.avatarUrl !== undefined) { fields.push('avatar_url = ?'); params.push(data.avatarUrl); }
      if (data.isActive !== undefined) { fields.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
      if (fields.length) {
        fields.push('updated_at = NOW()'); params.push(userId, organizationId);
        await conn.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, params);
      }
      if (data.passwordHash !== undefined || data.pinHash !== undefined || data.isActive === false) {
        await conn.execute('UPDATE sessions SET is_revoked = TRUE, revoked_at = NOW() WHERE user_id = ? AND organization_id = ?', [userId, organizationId]);
      }
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    return this.findUserById(organizationId, userId);
  }

  // ==========================================
  // BRANCH ACCESS ASSIGNMENT
  // ==========================================

  public async getUserAllowedBranchIds(userId: number, organizationId: number): Promise<number[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getUserAllowedBranchIds(userId, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT branch_id FROM user_branches WHERE user_id = ? AND organization_id = ?',
      [userId, organizationId]
    );
    const branchIds = rows.map(r => Number(r.branch_id));

    const [userRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT default_branch_id FROM users WHERE id = ? AND organization_id = ?',
      [userId, organizationId]
    );
    if (userRows.length) {
      const defaultBranchId = Number(userRows[0].default_branch_id);
      if (!branchIds.includes(defaultBranchId)) {
        branchIds.push(defaultBranchId);
      }
    }

    return branchIds;
  }

  public async setUserBranchAccess(
    userId: number,
    organizationId: number,
    branchIds: number[],
    connection?: PoolConnection // Optional connection for shared transactions
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.setUserBranchAccess(userId, organizationId, branchIds);
    }

    const runner = connection || (await this.pool().getConnection());
    const needsRelease = !connection; // Flag to know if this method acquired the connection

    try {
      if (!connection) { // Only begin transaction if not part of an existing one
        await runner.beginTransaction();
      }

      await runner.execute(
        'DELETE FROM user_branches WHERE user_id = ? AND organization_id = ?',
        [userId, organizationId]
      );

      for (const bId of branchIds) {
        await runner.execute(
          'INSERT INTO user_branches (user_id, branch_id, organization_id) VALUES (?, ?, ?)',
          [userId, bId, organizationId]
        );
      }

      if (!connection) { // Only commit if we started the transaction
        await runner.commit();
      }
    } catch (err) {
      if (!connection) { // Only rollback if we started the transaction
        await runner.rollback();
      }
      throw err;
    } finally {
      if (needsRelease) { // Only release if we acquired the connection
        runner.release();
      }
    }
  }

  // ==========================================
  // USER PERMISSION OVERRIDES
  // ==========================================

  public async getUserPermissionOverrides(
    userId: number,
    organizationId: number
  ): Promise<Map<string, 'GRANTED' | 'DENIED'>> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getUserPermissionOverrides(userId, organizationId);
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT p.code, up.effect
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = ? AND up.organization_id = ?`,
      [userId, organizationId]
    );

    const overrides = new Map<string, 'GRANTED' | 'DENIED'>();
    for (const row of rows) {
      overrides.set(row.code as string, row.effect as 'GRANTED' | 'DENIED');
    }
    return overrides;
  }

  public async grantUserPermission(
    userId: number,
    permissionId: number,
    organizationId: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.grantUserPermission(userId, permissionId, organizationId);
    }

    await this.pool().execute(
      `INSERT INTO user_permissions (user_id, permission_id, organization_id, effect)
       VALUES (?, ?, ?, 'GRANTED')
       ON DUPLICATE KEY UPDATE effect = 'GRANTED', updated_at = NOW()`,
      [userId, permissionId, organizationId]
    );
  }

  public async denyUserPermission(
    userId: number,
    permissionId: number,
    organizationId: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.denyUserPermission(userId, permissionId, organizationId);
    }

    await this.pool().execute(
      `INSERT INTO user_permissions (user_id, permission_id, organization_id, effect)
       VALUES (?, ?, ?, 'DENIED')
       ON DUPLICATE KEY UPDATE effect = 'DENIED', updated_at = NOW()`,
      [userId, permissionId, organizationId]
    );
  }

  public async clearUserPermissionOverride(
    userId: number,
    permissionId: number,
    organizationId: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.clearUserPermissionOverride(userId, permissionId, organizationId);
    }

    await this.pool().execute(
      `DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ? AND organization_id = ?`,
      [userId, permissionId, organizationId]
    );
  }

  public async clearAllUserPermissionOverrides(
    userId: number,
    organizationId: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.clearAllUserPermissionOverrides(userId, organizationId);
    }

    await this.pool().execute(
      `DELETE FROM user_permissions WHERE user_id = ? AND organization_id = ?`,
      [userId, organizationId]
    );
  }

  // ==========================================
  // SESSION TRACKING & REVOCATION
  // ==========================================

  public async createSession(tokenId: string, userId: number, orgId: number, expiresAt: Date): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createSession(tokenId, userId, orgId, expiresAt);
    }
    await this.pool().execute(
      'INSERT INTO sessions (token_id, user_id, organization_id, expires_at) VALUES (?, ?, ?, ?)',
      [tokenId, userId, orgId, expiresAt]
    );
  }

  public async revokeSession(tokenId: string): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.revokeSession(tokenId);
    }
    await this.pool().execute(
      'UPDATE sessions SET is_revoked = TRUE, revoked_at = NOW() WHERE token_id = ?',
      [tokenId]
    );
  }

  /**
   * Revokes every currently active restaurant session for one organization.
   *
   * The current sessions table contains restaurant ACCOUNT/STAFF sessions only.
   * Future restricted ACCESS_STATUS authentication must remain outside this
   * operational-session revoker.
   */
  public async revokeOrganizationSessions(organizationId: number): Promise<number> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.revokeOrganizationSessions(organizationId);
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      `UPDATE sessions
          SET is_revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE organization_id = ?
          AND is_revoked = FALSE
          AND expires_at > NOW()`,
      [organizationId]
    );

    return result.affectedRows;
  }

  public async isSessionRevoked(tokenId: string): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.isSessionRevoked(tokenId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT is_revoked, expires_at FROM sessions WHERE token_id = ?',
      [tokenId]
    );
    if (!rows.length) return true;
    const session = rows[0];
    if (toBool(session.is_revoked)) return true;
    if (new Date() > new Date(session.expires_at)) return true;
    return false;
  }

  public async countActiveOwners(organizationId: number): Promise<number> {
    if (!(await this.canUseDatabase())) {
      const users = await this.memoryStore.findUsersByOrgId(organizationId);
      return users.filter(user => user.isActive && user.roleName === 'OWNER').length;
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id WHERE u.organization_id = ? AND u.is_active = TRUE AND r.name = 'OWNER'`,
      [organizationId]
    );
    return Number(rows[0]?.count ?? 0);
  }

  public async updateUserPin(organizationId: number, userId: number, pinHash: string, mustChangePin: boolean, keepTokenId?: string, keepAccountTokenId?: string): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateUserPin(organizationId, userId, pinHash, mustChangePin, keepTokenId, keepAccountTokenId);
    }
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
      'UPDATE users SET pin_hash = ?, must_change_pin = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [pinHash, mustChangePin ? 1 : 0, userId, organizationId]
      );
      await conn.execute('UPDATE sessions SET is_revoked = TRUE, revoked_at = NOW() WHERE user_id = ? AND organization_id = ? AND token_id NOT IN (?, ?)', [userId, organizationId, keepTokenId ?? '', keepAccountTokenId ?? '']);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }
}

export const identityRepository = new IdentityRepository();

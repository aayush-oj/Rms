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

export class IdentityMemoryStore {
  private organizations = new Map<number, Organization>();
  private branches = new Map<number, Branch>();
  private roles = new Map<number, Role>();
  private permissions = new Map<number, Permission>();
  private users = new Map<number, UserWithSecrets>();
  private userBranches = new Map<number, Set<number>>();
  private sessions = new Map<
    string,
    { tokenId: string; userId: number; orgId: number; expiresAt: Date; isRevoked: boolean }
  >();

  private nextOrgId = 1;
  private nextBranchId = 1;
  private nextRoleId = 1;
  private nextPermId = 1;
  private nextUserId = 1;

  constructor() {
    this.initialize();
  }

  public initialize(): void {
    if (this.permissions.size === 0) {
      for (const p of SYSTEM_PERMISSIONS) {
        const id = this.nextPermId++;
        this.permissions.set(id, {
          id,
          code: p.code,
          module: p.module,
          description: p.description,
        });
      }
    }

    if (this.roles.size === 0) {
      for (const [roleKey, roleName] of Object.entries(SYSTEM_ROLES)) {
        const id = this.nextRoleId++;
        const perms = ROLE_DEFAULT_PERMISSIONS[roleKey] || [];
        this.roles.set(id, {
          id,
          organizationId: null,
          name: roleName,
          description: `Standard system ${roleName} role`,
          isSystem: true,
          permissions: [...perms],
        });
      }
    }
  }

  // ==========================================
  // ORGANIZATIONS
  // ==========================================

  public async findOrganizationById(id: number): Promise<Organization | null> {
    const org = this.organizations.get(id);
    return org ? { ...org, settings: { ...org.settings } } : null;
  }

  public async findOrganizationByName(name: string): Promise<Organization | null> {
    const query = name.trim().toLowerCase();
    for (const org of this.organizations.values()) {
      if (org.name.trim().toLowerCase() === query) {
        return { ...org, settings: { ...org.settings } };
      }
    }
    return null;
  }

  public async createOrganization(data: {
    name: string;
    legalName?: string;
    taxIdentifier?: string;
    currencyCode?: string;
    settings?: Record<string, unknown>;
  }): Promise<Organization> {
    const id = this.nextOrgId++;
    const now = new Date().toISOString();
    const org: Organization = {
      id,
      name: data.name,
      legalName: data.legalName || null,
      taxIdentifier: data.taxIdentifier || null,
      currencyCode: data.currencyCode || 'NPR',
      status: 'ACTIVE',
      settings: data.settings ? { ...data.settings } : {},
      createdAt: now,
      updatedAt: now,
    };
    this.organizations.set(id, org);
    return { ...org, settings: { ...org.settings } };
  }

  public async updateOrganization(
    id: number,
    data: Partial<Pick<Organization, 'name' | 'legalName' | 'taxIdentifier' | 'currencyCode' | 'status' | 'settings'>>
  ): Promise<Organization | null> {
    const existing = this.organizations.get(id);
    if (!existing) return null;

    const updated: Organization = {
      ...existing,
      name: data.name !== undefined ? data.name : existing.name,
      legalName: data.legalName !== undefined ? data.legalName : existing.legalName,
      taxIdentifier: data.taxIdentifier !== undefined ? data.taxIdentifier : existing.taxIdentifier,
      currencyCode: data.currencyCode !== undefined ? data.currencyCode : existing.currencyCode,
      status: data.status !== undefined ? data.status : existing.status,
      settings: data.settings ? { ...existing.settings, ...data.settings } : existing.settings,
      updatedAt: new Date().toISOString(),
    };
    this.organizations.set(id, updated);
    return { ...updated, settings: { ...updated.settings } };
  }

  public async deleteOrganizationCascade(orgId: number): Promise<void> {
    // Delete sessions for users in org
    for (const [tok, s] of Array.from(this.sessions.entries())) {
      if (s.orgId === orgId) {
        this.sessions.delete(tok);
      }
    }
    // Delete user branch links and users
    for (const [uId, u] of Array.from(this.users.entries())) {
      if (u.organizationId === orgId) {
        this.userBranches.delete(uId);
        this.users.delete(uId);
      }
    }
    // Delete branches
    for (const [bId, b] of Array.from(this.branches.entries())) {
      if (b.organizationId === orgId) {
        this.branches.delete(bId);
      }
    }
    // Delete custom roles
    for (const [rId, r] of Array.from(this.roles.entries())) {
      if (r.organizationId === orgId) {
        this.roles.delete(rId);
      }
    }
    // Delete org
    this.organizations.delete(orgId);
  }

  // ==========================================
  // BRANCHES
  // ==========================================

  public async findBranchesByOrgId(organizationId: number): Promise<Branch[]> {
    const list: Branch[] = [];
    for (const b of this.branches.values()) {
      if (b.organizationId === organizationId) {
        list.push({ ...b });
      }
    }
    return list;
  }

  public async findBranchById(organizationId: number, branchId: number): Promise<Branch | null> {
    const b = this.branches.get(branchId);
    if (!b || b.organizationId !== organizationId) return null;
    return { ...b };
  }

  public async findBranchByCode(organizationId: number, code: string): Promise<Branch | null> {
    const q = code.trim().toUpperCase();
    for (const b of this.branches.values()) {
      if (b.organizationId === organizationId && b.code.toUpperCase() === q) {
        return { ...b };
      }
    }
    return null;
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
  }): Promise<Branch> {
    const id = this.nextBranchId++;
    const now = new Date().toISOString();
    const branch: Branch = {
      id,
      organizationId: data.organizationId,
      name: data.name,
      code: data.code.toUpperCase(),
      address: data.address || null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      phone: data.phone || null,
      email: data.email || null,
      billPrefix: data.billPrefix || 'FH-',
      timezone: 'Asia/Kathmandu',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.branches.set(id, branch);
    return { ...branch };
  }

  public async updateBranch(
    organizationId: number,
    branchId: number,
    data: Partial<Pick<Branch, 'name' | 'code' | 'address' | 'latitude' | 'longitude' | 'phone' | 'email' | 'billPrefix' | 'isActive'>>
  ): Promise<Branch | null> {
    const existing = this.branches.get(branchId);
    if (!existing || existing.organizationId !== organizationId) return null;

    const updated: Branch = {
      ...existing,
      name: data.name !== undefined ? data.name : existing.name,
      code: data.code ? data.code.toUpperCase() : existing.code,
      address: data.address !== undefined ? data.address : existing.address,
      latitude: data.latitude !== undefined ? data.latitude : existing.latitude,
      longitude: data.longitude !== undefined ? data.longitude : existing.longitude,
      phone: data.phone !== undefined ? data.phone : existing.phone,
      email: data.email !== undefined ? data.email : existing.email,
      billPrefix: data.billPrefix !== undefined ? data.billPrefix : existing.billPrefix,
      isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.branches.set(branchId, updated);
    return { ...updated };
  }

  // ==========================================
  // ROLES & PERMISSIONS
  // ==========================================

  public async getRoles(organizationId?: number): Promise<Role[]> {
    this.initialize();
    const list: Role[] = [];
    for (const r of this.roles.values()) {
      if (r.organizationId === null || (organizationId !== undefined && r.organizationId === organizationId)) {
        list.push({ ...r, permissions: [...r.permissions] });
      }
    }
    return list;
  }

  public async getRoleById(roleId: number, organizationId?: number): Promise<Role | null> {
    this.initialize();
    const r = this.roles.get(roleId);
    if (!r) return null;
    if (r.organizationId !== null && organizationId !== undefined && r.organizationId !== organizationId) {
      return null;
    }
    return { ...r, permissions: [...r.permissions] };
  }

  public async getRoleByName(name: string, organizationId?: number): Promise<Role | null> {
    this.initialize();
    const q = name.trim().toUpperCase();
    for (const r of this.roles.values()) {
      if (r.name.toUpperCase() === q) {
        if (r.organizationId === null || (organizationId !== undefined && r.organizationId === organizationId)) {
          return { ...r, permissions: [...r.permissions] };
        }
      }
    }
    return null;
  }

  public async getPermissions(): Promise<Permission[]> {
    this.initialize();
    return Array.from(this.permissions.values()).map(p => ({ ...p }));
  }

  // ==========================================
  // USERS
  // ==========================================

  public async findUsersByOrgId(organizationId: number): Promise<User[]> {
    const list: User[] = [];
    for (const u of this.users.values()) {
      if (u.organizationId === organizationId) {
        const { passwordHash, pinHash, ...safeUser } = u;
        list.push(safeUser);
      }
    }
    return list;
  }

  public async findUserById(organizationId: number, userId: number): Promise<UserWithSecrets | null> {
    const u = this.users.get(userId);
    if (!u || u.organizationId !== organizationId) return null;
    return { ...u };
  }

  public async findUserByIdGlobal(userId: number): Promise<UserWithSecrets | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    return { ...u };
  }

  public async findUserByUsername(organizationId: number, username: string): Promise<UserWithSecrets | null> {
    const q = username.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.organizationId === organizationId && u.username.toLowerCase() === q) {
        return { ...u };
      }
    }
    return null;
  }

  public async findUserByUsernameOrEmailGlobal(identifier: string): Promise<UserWithSecrets | null> {
    const q = identifier.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (
        u.username.toLowerCase() === q ||
        (u.email && u.email.toLowerCase() === q)
      ) {
        return { ...u };
      }
    }
    return null;
  }

  public async findUserByPin(
    organizationId: number,
    branchId: number,
    verifyPinFn: (storedHash: string) => boolean
  ): Promise<UserWithSecrets | null> {
    for (const u of this.users.values()) {
      if (u.organizationId === organizationId && u.isActive && u.pinHash) {
        const allowed = await this.getUserAllowedBranchIds(u.id, organizationId);
        if (allowed.includes(branchId) || u.defaultBranchId === branchId) {
          if (verifyPinFn(u.pinHash)) {
            return { ...u };
          }
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
    const id = this.nextUserId++;
    const role = this.roles.get(data.roleId);
    const now = new Date().toISOString();
    const user: UserWithSecrets = {
      id,
      organizationId: data.organizationId,
      defaultBranchId: data.defaultBranchId,
      roleId: data.roleId,
      roleName: role ? role.name : '',
      name: data.name,
      username: data.username,
      email: data.email || null,
      passwordHash: data.passwordHash || null,
      pinHash: data.pinHash || null,
      avatarUrl: data.avatarUrl || null,
      isActive: true,
      mustChangePin: data.mustChangePin || false,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(id, user);
    await this.setUserBranchAccess(id, data.organizationId, [data.defaultBranchId]);
    return { ...user };
  }

  public async updateUser(
    organizationId: number,
    userId: number,
    data: Partial<Pick<UserWithSecrets, 'name' | 'email' | 'roleId' | 'defaultBranchId' | 'passwordHash' | 'pinHash' | 'avatarUrl' | 'isActive'>>
  ): Promise<UserWithSecrets | null> {
    const existing = this.users.get(userId);
    if (!existing || existing.organizationId !== organizationId) return null;

    let roleName = existing.roleName;
    if (data.roleId !== undefined && data.roleId !== existing.roleId) {
      const role = this.roles.get(data.roleId);
      if (role) roleName = role.name;
    }

    const updated: UserWithSecrets = {
      ...existing,
      name: data.name !== undefined ? data.name : existing.name,
      email: data.email !== undefined ? data.email : existing.email,
      roleId: data.roleId !== undefined ? data.roleId : existing.roleId,
      roleName,
      defaultBranchId: data.defaultBranchId !== undefined ? data.defaultBranchId : existing.defaultBranchId,
      passwordHash: data.passwordHash !== undefined ? data.passwordHash : existing.passwordHash,
      pinHash: data.pinHash !== undefined ? data.pinHash : existing.pinHash,
      avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : existing.avatarUrl,
      isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(userId, updated);
    if (data.passwordHash !== undefined || data.pinHash !== undefined || data.isActive === false) {
      for (const session of this.sessions.values()) if (session.userId === userId && session.orgId === organizationId) session.isRevoked = true;
    }
    return { ...updated };
  }

  // ==========================================
  // BRANCH ACCESS
  // ==========================================

  public async getUserAllowedBranchIds(userId: number, organizationId: number): Promise<number[]> {
    const set = this.userBranches.get(userId) || new Set<number>();
    const branchIds = Array.from(set);

    const user = this.users.get(userId);
    if (user && user.organizationId === organizationId) {
      if (!branchIds.includes(user.defaultBranchId)) {
        branchIds.push(user.defaultBranchId);
      }
    }
    return branchIds;
  }

  public async setUserBranchAccess(userId: number, organizationId: number, branchIds: number[]): Promise<void> {
    this.userBranches.set(userId, new Set(branchIds));
  }

  // ==========================================
  // USER PERMISSION OVERRIDES
  // ==========================================

  private userPermissionOverrides = new Map<string, Map<string, 'GRANTED' | 'DENIED'>>();

  private getUserPermKey(userId: number, organizationId: number): string {
    return `${userId}:${organizationId}`;
  }

  public async getUserPermissionOverrides(
    userId: number,
    organizationId: number
  ): Promise<Map<string, 'GRANTED' | 'DENIED'>> {
    const key = this.getUserPermKey(userId, organizationId);
    const overrides = this.userPermissionOverrides.get(key);
    return overrides ? new Map(overrides) : new Map();
  }

  public async grantUserPermission(
    userId: number,
    permissionId: number,
    organizationId: number
  ): Promise<void> {
    const key = this.getUserPermKey(userId, organizationId);
    if (!this.userPermissionOverrides.has(key)) {
      this.userPermissionOverrides.set(key, new Map());
    }
    const overrides = this.userPermissionOverrides.get(key)!;
    overrides.set(String(permissionId), 'GRANTED');
  }

  public async denyUserPermission(
    userId: number,
    permissionId: number,
    organizationId: number
  ): Promise<void> {
    const key = this.getUserPermKey(userId, organizationId);
    if (!this.userPermissionOverrides.has(key)) {
      this.userPermissionOverrides.set(key, new Map());
    }
    const overrides = this.userPermissionOverrides.get(key)!;
    overrides.set(String(permissionId), 'DENIED');
  }

  public async clearUserPermissionOverride(
    userId: number,
    permissionId: number,
    organizationId: number
  ): Promise<void> {
    const key = this.getUserPermKey(userId, organizationId);
    const overrides = this.userPermissionOverrides.get(key);
    if (overrides) {
      overrides.delete(String(permissionId));
      if (overrides.size === 0) {
        this.userPermissionOverrides.delete(key);
      }
    }
  }

  public async clearAllUserPermissionOverrides(
    userId: number,
    organizationId: number
  ): Promise<void> {
    const key = this.getUserPermKey(userId, organizationId);
    this.userPermissionOverrides.delete(key);
  }

  // ==========================================
  // SESSIONS
  // ==========================================

  public async createSession(tokenId: string, userId: number, orgId: number, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenId, {
      tokenId,
      userId,
      orgId,
      expiresAt,
      isRevoked: false,
    });
  }

  public async revokeSession(tokenId: string): Promise<void> {
    const s = this.sessions.get(tokenId);
    if (s) {
      s.isRevoked = true;
    }
  }

  public async revokeOrganizationSessions(organizationId: number): Promise<number> {
    const now = Date.now();
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (
        session.orgId === organizationId
        && !session.isRevoked
        && new Date(session.expiresAt).getTime() > now
      ) {
        session.isRevoked = true;
        revoked += 1;
      }
    }
    return revoked;
  }

  public async isSessionRevoked(tokenId: string): Promise<boolean> {
    const s = this.sessions.get(tokenId);
    if (!s) return true;
    if (s.isRevoked) return true;
    if (new Date() > new Date(s.expiresAt)) return true;
    return false;
  }

  public async updateUserPin(organizationId: number, userId: number, pinHash: string, mustChangePin: boolean, keepTokenId?: string, keepAccountTokenId?: string): Promise<void> {
    const user = this.users.get(userId);
    if (user && user.organizationId === organizationId) {
      user.pinHash = pinHash;
      user.mustChangePin = mustChangePin;
      for (const session of this.sessions.values()) if (session.userId === userId && session.orgId === organizationId && session.tokenId !== keepTokenId && session.tokenId !== keepAccountTokenId) session.isRevoked = true;
    }
  }
}

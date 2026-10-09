export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';

export interface Organization {
  id: number;
  name: string;
  legalName: string | null;
  taxIdentifier: string | null;
  currencyCode: string;
  status: OrganizationStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: number;
  organizationId: number;
  name: string;
  code: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  billPrefix: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: number;
  organizationId: number | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export interface Permission {
  id: number;
  code: string;
  module: string;
  description: string | null;
}

export interface User {
  id: number;
  organizationId: number;
  defaultBranchId: number;
  roleId: number;
  roleName: string;
  name: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  mustChangePin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithSecrets extends User {
  passwordHash: string | null;
  pinHash: string | null;
}

export type AuthLevel = 'ACCOUNT' | 'STAFF';

export interface AuthClaims {
  userId: number;
  organizationId: number;
  activeBranchId: number;
  role: string;
  roleId: number;
  username: string;
  tokenId: string;
  authLevel: AuthLevel;
}

export interface AuthContext {
  id: number;
  organizationId: number;
  activeBranchId: number;
  allowedBranchIds: number[];
  role: string;
  roleId: number;
  permissions: string[];
  username: string;
  email: string | null;
  name: string;
  mustChangePin: boolean;
  tokenId: string;
  authLevel: AuthLevel;
}

export interface AuthResult {
  user: {
    id: number;
    organizationId: number;
    defaultBranchId: number;
    activeBranchId: number;
    role: string;
    name: string;
    username: string;
    email: string | null;
    permissions: string[];
    allowedBranchIds: number[];
    mustChangePin: boolean;
  };
  organization: {
    id: number;
    name: string;
    currencyCode: string;
    status: OrganizationStatus;
  };
  branch: {
    id: number;
    name: string;
    code: string;
    billPrefix: string;
    timezone: string;
  };
  token: string;
  expiresIn: string;
}

export interface UserPermissionOverride {
  id: number;
  userId: number;
  permissionId: number;
  permissionCode: string;
  organizationId: number;
  effect: 'GRANTED' | 'DENIED';
  createdAt: string;
  updatedAt: string;
}

export const SYSTEM_ROLES = {
  OWNER: 'OWNER',
  FB_MANAGER: 'FB_MANAGER',
  CASHIER: 'CASHIER',
  WAITER: 'WAITER',
  CHEF: 'CHEF',
} as const;

export const SYSTEM_PERMISSIONS: { code: string; module: string; description: string }[] = [
  { code: 'admin:all', module: 'admin', description: 'Full administrative access across organization' },
  { code: 'admin:org:manage', module: 'admin', description: 'Manage organization profile, settings, legal details' },
  { code: 'admin:branches:manage', module: 'admin', description: 'Create and configure restaurant branches' },
  { code: 'admin:users:manage', module: 'admin', description: 'Create and manage user accounts and branch assignments' },
  { code: 'admin:roles:manage', module: 'admin', description: 'Manage role assignments and permission policies' },
  { code: 'admin:tables:manage', module: 'admin', description: 'Create and configure floors, sections, and dining tables' },
  { code: 'admin:hardware:manage', module: 'admin', description: 'Configure thermal printers and preparation stations' },
  { code: 'admin:taxes:manage', module: 'admin', description: 'Manage branch VAT registration and pricing configuration' },
  { code: 'admin:payments:manage', module: 'admin', description: 'Configure payment methods, tenders, and QR gateways' },
  { code: 'admin:units:manage', module: 'admin', description: 'Manage units of measure, dimensions, and conversion factors' },
  { code: 'admin:settings:manage', module: 'admin', description: 'Configure organization and branch operational settings' },
  { code: 'admin:menus:manage', module: 'admin', description: 'Manage menu categories, items, modifiers, and catalog configuration' },
  { code: 'admin:system:status', module: 'admin', description: 'View system health, migrations, and internal status' },
  { code: 'admin:customers:manage', module: 'admin', description: 'Manage customer profiles and membership records' },
  { code: 'admin:departments:manage', module: 'admin', description: 'Manage operational departments and menu department assignments' },
  { code: 'admin:access:manage', module: 'admin', description: 'Manage staff branch, room, and table access assignments' },

  { code: 'dashboard:view', module: 'dashboard', description: 'View dashboard and main navigation' },

  { code: 'pos:orders:create', module: 'pos', description: 'Create and append dining room and takeaway orders' },
  { code: 'pos:orders:view', module: 'pos', description: 'View floor plans and active orders' },
  { code: 'pos:orders:void', module: 'pos', description: 'Void or cancel ordered items or tickets' },
  { code: 'pos:orders:serve', module: 'pos', description: 'Mark ready dine-in orders or dishes as served' },
  { code: 'pos:orders:complete', module: 'pos', description: 'Complete financially settled orders' },
  { code: 'pos:tables:manage', module: 'pos', description: 'Seat, transfer, merge, and clear tables' },
  { code: 'pos:tables:allocate', module: 'pos', description: 'Manage waiter table assignments and allocations' },
  { code: 'pos:billing:settle', module: 'pos', description: 'Settle checks, process cash/QR/card payments' },
  { code: 'pos:billing:reverse', module: 'pos', description: 'Reverse captured payments as a controlled financial correction' },
  { code: 'pos:discounts:apply', module: 'pos', description: 'Apply promotional or manager discounts to bills' },

  { code: 'kitchen:tickets:view', module: 'kitchen', description: 'View Kitchen Display System (KDS) order tickets' },
  { code: 'kitchen:tickets:update', module: 'kitchen', description: 'Bump ticket status (Queued -> Preparing -> Ready)' },
  { code: 'bar:tickets:view', module: 'bar', description: 'View Bar Display System order tickets' },
  { code: 'bar:tickets:update', module: 'bar', description: 'Bump beverage ticket status' },

  { code: 'inventory:view', module: 'inventory', description: 'Inspect branch ingredient and inventory stock' },
  { code: 'inventory:manage', module: 'inventory', description: 'Record adjustments, waste logs, and stock counts' },
  { code: 'inventory:items:manage', module: 'inventory', description: 'Create, edit, activate and deactivate inventory items' },
  { code: 'inventory:categories:manage', module: 'inventory', description: 'Manage branch inventory categories' },
  { code: 'inventory:locations:manage', module: 'inventory', description: 'Manage branch inventory locations' },
  { code: 'inventory:opening:manage', module: 'inventory', description: 'Record opening stock' },
  { code: 'inventory:adjust', module: 'inventory', description: 'Adjust stock quantities' },
  { code: 'inventory:count', module: 'inventory', description: 'Perform and confirm physical stock counts' },
  { code: 'inventory:transfer', module: 'inventory', description: 'Transfer stock between inventory locations' },
  { code: 'inventory:history:view', module: 'inventory', description: 'View inventory movement history and stock details' },

  { code: 'businessday:view', module: 'businessday', description: 'View current and historical business days' },
  { code: 'businessday:open', module: 'businessday', description: 'Open a branch business day' },
  { code: 'businessday:close', module: 'businessday', description: 'Close a branch business day' },
  { code: 'shift:view', module: 'shift', description: 'View cashier shifts and summaries' },
  { code: 'shift:open', module: 'shift', description: 'Open a cashier register shift' },
  { code: 'shift:close', module: 'shift', description: 'Close a cashier register shift' },
  { code: 'shift:cash:manage', module: 'shift', description: 'Record and view operational cash movements' },
  { code: 'shift:reconcile', module: 'shift', description: 'Review shift cash reconciliation and variance' },
  { code: 'admin:registers:manage', module: 'admin', description: 'Manage POS registers by branch' },

  { code: 'alerts.view', module: 'alerts', description: 'View operational alerts' },
  { code: 'alerts.acknowledge', module: 'alerts', description: 'Acknowledge operational alerts' },
  { code: 'alerts.resolve', module: 'alerts', description: 'Resolve operational alerts' },
  { code: 'alerts.dismiss', module: 'alerts', description: 'Dismiss operational alerts' },
  { code: 'alerts.settings.manage', module: 'alerts', description: 'Manage operational alert settings' },
  { code: 'alerts.security.view', module: 'alerts', description: 'View sensitive security alerts' },

  { code: 'reports:view', module: 'reports', description: 'Legacy access to branch and consolidated reports' },
  { code: 'reports.dashboard.view', module: 'reports', description: 'View management dashboard' },
  { code: 'reports.sales.view', module: 'reports', description: 'View sales and operational control reports' },
  { code: 'reports.fnb.view', module: 'reports', description: 'View F&B performance and theoretical recipe-cost metrics' },
  { code: 'reports.department.view', module: 'reports', description: 'View department performance' },
  { code: 'reports.staff.view', module: 'reports', description: 'View operational staff performance' },
  { code: 'reports.occupancy.view', module: 'reports', description: 'View occupancy and table performance' },
  { code: 'reports.payment.view', module: 'reports', description: 'View payment reports' },
  { code: 'reports.tax.view', module: 'reports', description: 'View internal tax reports' },
  { code: 'reports.shift.view', module: 'reports', description: 'View shift and cash reports' },
  { code: 'reports.inventory.view', module: 'reports', description: 'View inventory reports' },
  { code: 'reports.purchasing.view', module: 'reports', description: 'View purchasing reports' },
  { code: 'reports.expense.view', module: 'reports', description: 'View expense reports' },
  { code: 'reports.branch.view', module: 'reports', description: 'View authorized branch comparisons' },
  { code: 'reports.export', module: 'reports', description: 'Export authorized reports' },
];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  OWNER: ['admin:all'],
  FB_MANAGER: [
    'admin:org:manage','admin:branches:manage','admin:users:manage','admin:tables:manage','admin:hardware:manage','admin:taxes:manage','admin:payments:manage','admin:units:manage','admin:settings:manage','admin:menus:manage','admin:system:status','admin:customers:manage','admin:departments:manage','admin:access:manage',
    'dashboard:view',
    'alerts.view','alerts.acknowledge','alerts.resolve','alerts.dismiss','alerts.settings.manage','alerts.security.view',
    'pos:orders:create','pos:orders:view','pos:orders:void','pos:orders:serve','pos:orders:complete','pos:tables:manage','pos:tables:allocate','pos:billing:settle','pos:billing:reverse','pos:discounts:apply',
    'kitchen:tickets:view','kitchen:tickets:update','bar:tickets:view','bar:tickets:update',
    'inventory:view','inventory:manage','inventory:items:manage','inventory:categories:manage','inventory:locations:manage','inventory:opening:manage','inventory:adjust','inventory:count','inventory:transfer','inventory:history:view',
    'reports:view','reports.dashboard.view','reports.sales.view','reports.fnb.view','reports.department.view','reports.staff.view','reports.occupancy.view','reports.payment.view','reports.tax.view','reports.shift.view','reports.inventory.view','reports.purchasing.view','reports.expense.view','reports.branch.view','reports.export',
    'businessday:view','shift:view','shift:open','shift:close','shift:cash:manage',
  ],
  CASHIER: [
    'alerts.view','alerts.acknowledge',
    'pos:orders:create','pos:orders:view','pos:tables:manage','pos:orders:complete','pos:billing:settle',
    'reports:view','reports.dashboard.view','reports.sales.view','reports.payment.view','reports.shift.view',
    'businessday:view','shift:view','shift:open','shift:close','shift:cash:manage',
  ],
  WAITER: [
    'alerts.view','alerts.acknowledge',
    'pos:orders:create','pos:orders:view','pos:orders:serve','pos:tables:manage',
  ],
  CHEF: [
    'alerts.view','alerts.acknowledge',
    'kitchen:tickets:view','kitchen:tickets:update',
    'inventory:view',
  ],
};

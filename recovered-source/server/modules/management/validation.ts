import { z } from 'zod';

export const createDepartmentSchema = z.object({
  branchId: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(50).optional(),
  description: z.string().trim().max(255).optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  creditLimit: z.coerce.number().min(0).max(99999999.9999).default(0),
  isActive: z.boolean().default(true),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const createMembershipSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  membershipNumber: z.string().trim().min(1).max(50),
  tier: z.string().trim().min(1).max(50),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  benefitDiscountRate: z.number().min(0).max(1).default(0),
  benefits: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']).default('ACTIVE'),
});

export const updateMembershipSchema = createMembershipSchema.partial().omit({ customerId: true });

// Keep the historical payload contract so older clients/tests can still submit
// sectionIds/tableIds. Authorization remains branch-wide; these two arrays are
// compatibility/operational-assignment fields and must not be treated as security scope.
export const accessAssignmentSchema = z.object({
  branchIds: z.array(z.coerce.number().int().positive()).default([]),
  sectionIds: z.array(z.coerce.number().int().positive()).default([]),
  tableIds: z.array(z.coerce.number().int().positive()).default([]),
});

export const updateRolePermissionsSchema = z.object({
  permissionIds: z.array(z.coerce.number().int().positive()).default([]),
});

export const createCustomRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(255).nullable().optional(),
  permissionIds: z.array(z.coerce.number().int().positive()).default([]),
});

export const membershipUsageSchema = z.object({
  benefitType: z.string().trim().min(1).max(100),
  benefitAmount: z.number().min(0).max(100000000),
  notes: z.string().trim().max(2000).nullable().optional(),
  orderId: z.coerce.number().int().positive().nullable().optional(),
});

export const menuItemDepartmentAssignmentSchema = z.object({
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  prepTimeMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
}).strict();

export const tableWaiterAssignmentSchema = z.object({
  waiterId: z.coerce.number().int().positive().nullable(),
}).strict();
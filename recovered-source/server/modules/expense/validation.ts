import { z } from 'zod';

const positiveId = z.coerce.number().int().positive();
const money = z.coerce.number().refine(v => Number.isFinite(v) && v > 0 && v <= 9999999999.9999, 'Amount must be a positive finite value');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(255),
  displayOrder: z.coerce.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
});

export const updateExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalText(255),
  displayOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const createExpenseSchema = z.object({
  businessDayId: positiveId,
  shiftId: positiveId.nullable().optional(),
  expenseCategoryId: positiveId,
  departmentId: positiveId.nullable().optional(),
  paymentMethodId: positiveId,
  amount: money,
  reference: optionalText(150),
  description: z.string().trim().min(1).max(255),
  notes: optionalText(5000),
  expenseDate: z.coerce.date(),
  requestKey: z.string().trim().min(8).max(100).optional(),
});

export const updateExpenseSchema = z.object({
  businessDayId: positiveId.optional(),
  shiftId: positiveId.nullable().optional(),
  expenseCategoryId: positiveId.optional(),
  departmentId: positiveId.nullable().optional(),
  paymentMethodId: positiveId.optional(),
  amount: money.optional(),
  reference: optionalText(150),
  description: z.string().trim().min(1).max(255).optional(),
  notes: optionalText(5000),
  expenseDate: z.coerce.date().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const voidExpenseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const listExpenseQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT','POSTED','VOIDED']).optional(),
  categoryId: positiveId.optional(),
  departmentId: positiveId.optional(),
  paymentMethodId: positiveId.optional(),
  businessDayId: positiveId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

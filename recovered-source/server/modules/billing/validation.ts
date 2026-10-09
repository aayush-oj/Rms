import { z } from 'zod';

export const createBillSchema = z.object({
  orderId: z.coerce.number().int().positive(),
});

export const paymentSchema = z.object({
  paymentMethodId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().finite(),
  tenderAmount: z.coerce.number().positive().finite().optional(),
  externalReference: z.string().trim().max(150).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const discountSchema = z.object({
  type: z.enum(['NONE', 'PERCENTAGE', 'AMOUNT']),
  value: z.coerce.number().finite().min(0).max(99999999.9999).default(0),
}).superRefine((value, ctx) => {
  if (value.type === 'PERCENTAGE' && value.value > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Percentage discount cannot exceed 100%' });
  }
});

const mixedPaymentLineSchema = z.object({
  paymentMethodId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().finite(),
  tenderAmount: z.coerce.number().positive().finite().optional(),
  externalReference: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(500).optional(),
});

const creditSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().finite(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD').nullable().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const mixedSettlementSchema = z.object({
  payments: z.array(mixedPaymentLineSchema).max(10).default([]),
  credit: creditSchema.nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).superRefine((value, ctx) => {
  if (value.payments.length === 0 && !value.credit) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payments'], message: 'Add a payment method or customer credit' });
  }
});

export const billingCustomerSearchSchema = z.object({
  search: z.string().trim().max(100).optional().default(''),
});

export const quickBillingCustomerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(7).max(50),
});

export const creditRepaymentSchema = z.object({
  paymentMethodId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().finite(),
  tenderAmount: z.coerce.number().positive().finite().optional(),
  externalReference: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const itemAllocationSchema = z.object({
  orderItemId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().finite().max(100000),
});

export const splitBillSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ITEM'),
    bills: z.array(z.object({ allocations: z.array(itemAllocationSchema).min(1) }).strict()).min(2).max(20),
  }),
  z.object({
    mode: z.literal('EVEN'),
    billCount: z.coerce.number().int().min(2).max(20),
  }),
]);

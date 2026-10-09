import { z } from 'zod';

const orderTypeEnum = z.enum(['DINE_IN', 'TAKEAWAY']);
// Generic status updates are intentionally limited to operational preparation states.
// SERVED, COMPLETED and CANCELLED have dedicated endpoints because those transitions
// perform additional transactional side effects (KOT closure, settlement/table release,
// inventory reversal and cancellation audit metadata) that must never be bypassed.
const mutableOrderStatusEnum = z.enum(['PREPARING', 'READY']);
const listableOrderStatusEnum = z.enum(['PLACED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED', 'MERGED']);
const paymentStatusEnum = z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']);

export const modifierSelectionSchema = z.object({
  modifierGroupId: z.coerce.number().int().positive(),
  options: z.array(z.object({
    optionId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().max(20).optional(),
  })).max(20),
});

export const createOrderItemSchema = z.object({
  menuItemId: z.coerce.number().int().positive('Menu item ID is required'),
  variantId: z.coerce.number().int().positive().nullable().optional(),
  modifiers: z.array(modifierSelectionSchema).max(20).superRefine((values, ctx) => {
    const seen = new Set<number>();
    for (let index = 0; index < values.length; index += 1) {
      if (seen.has(values[index].modifierGroupId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'modifierGroupId'], message: 'Modifier group may only be submitted once' });
      }
      seen.add(values[index].modifierGroupId);
    }
  }).optional(),
  quantity: z.coerce.number().int().positive('Quantity must be at least 1').max(1000),
  expectedUnitPrice: z.coerce.number().finite().min(0).max(99999999.9999).optional(),
  notes: z.string().max(255, 'Notes must be 255 characters or less').optional(),
  isComplimentary: z.boolean().optional().default(false),
  complimentaryReason: z.string().trim().max(500, 'Complimentary reason must be 500 characters or less').optional(),
}).superRefine((value, ctx) => {
  if (value.isComplimentary && !value.complimentaryReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['complimentaryReason'], message: 'A reason is required for complimentary items' });
  }
});

export const createOrderSchema = z.object({
  orderType: orderTypeEnum.default('DINE_IN'),
  diningTableId: z.coerce.number().int().positive().nullable().optional(),
  diningTableIds: z.array(z.coerce.number().int().positive()).min(1).max(20).optional(),
  customerId: z.coerce.number().int().positive().nullable().optional(),
  membershipId: z.coerce.number().int().positive().nullable().optional(),
  waiterId: z.coerce.number().int().positive().nullable().optional(),
  discount: z.coerce.number().min(0, 'Discount cannot be negative').default(0),
  items: z
    .array(createOrderItemSchema)
    .min(1, 'Order must contain at least one item')
    .max(50, 'Order cannot contain more than 50 items'),
}).superRefine((value, ctx) => {
  if (value.orderType === 'DINE_IN' && value.diningTableId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['diningTableId'],
      message: 'Dine-in orders require a dining table',
    });
  }
  if (value.orderType === 'DINE_IN' && value.diningTableIds) {
    const uniqueIds = new Set(value.diningTableIds);
    if (uniqueIds.size !== value.diningTableIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['diningTableIds'], message: 'Each dining table may only be selected once' });
    }
    if (value.diningTableId != null && !uniqueIds.has(value.diningTableId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['diningTableIds'], message: 'The primary dining table must be included in diningTableIds' });
    }
  }
  if (value.orderType === 'TAKEAWAY' && (value.diningTableId != null || (value.diningTableIds?.length ?? 0) > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['diningTableId'],
      message: 'Takeaway orders cannot be assigned to dining tables',
    });
  }
});

export const updateOrderStatusSchema = z.object({
  orderStatus: mutableOrderStatusEnum,
});

export const cancelOrderSchema = z.object({
  cancellationReason: z.string().max(500, 'Reason must be 500 characters or less').optional(),
});

export const listOrdersQuerySchema = z.object({
  orderStatus: listableOrderStatusEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  diningTableId: z.coerce.number().int().positive().optional(),
  waiterId: z.coerce.number().int().positive().optional(),
  orderNumber: z.string().max(50).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const reportFiltersSchema = z.object({
  branchId: positiveInt,
  roomId: positiveInt,
  tableId: positiveInt,
  timeFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm').optional(),
  timeTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm').optional(),
  businessDayId: positiveInt,
  from: date,
  to: date,
  shiftId: positiveInt,
  registerId: positiveInt,
  staffId: positiveInt,
  departmentId: positiveInt,
  categoryId: positiveInt,
  itemId: positiveInt,
  paymentMethodId: positiveInt,
  orderType: z.enum(['DINE_IN', 'TAKEAWAY']).optional(),
  grouping: z.enum(['hour', 'day', 'week', 'month']).optional(),
}).superRefine((v, ctx) => {
  if (v.timeFrom && v.timeTo && v.timeFrom >= v.timeTo) ctx.addIssue({ code: 'custom', path: ['timeTo'], message: 'timeTo must be later than timeFrom; overnight windows are not supported' });
  if (v.from && v.to && v.from > v.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be on or after from' });
});

export const transactionHistoryFiltersSchema = z.object({
  branchId: positiveInt,
  from: date,
  to: date,
  billNumber: z.string().trim().max(80).optional(),
  orderNumber: z.string().trim().max(80).optional(),
  tableId: positiveInt,
  paymentMethodId: positiveInt,
  staffId: positiveInt,
  settlementStatus: z.enum(['OPEN', 'PARTIAL', 'SETTLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine((v, ctx) => {
  if (v.from && v.to && v.from > v.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be on or after from' });
});

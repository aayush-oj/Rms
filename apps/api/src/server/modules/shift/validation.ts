import { z } from 'zod';

export const openBusinessDaySchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

export const closeBusinessDaySchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

export const registerCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(1).max(50).toUpperCase(),
});

export const registerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  code: z.string().trim().min(1).max(50).toUpperCase().optional(),
  isActive: z.boolean().optional(),
});

export const openShiftSchema = z.object({
  registerId: z.coerce.number().int().positive(),
  openingCash: z.coerce.number().finite().min(0).max(999999999),
  notes: z.string().trim().max(500).optional(),
});

export const closeShiftSchema = z.object({
  countedCash: z.coerce.number().finite().min(0).max(999999999),
  notes: z.string().trim().max(500).optional(),
});

export const cashMovementSchema = z.object({
  movementType: z.enum(['CASH_IN', 'CASH_OUT', 'CASH_DROP']),
  amount: z.coerce.number().finite().positive().max(999999999),
  reason: z.string().trim().min(1).max(255),
  notes: z.string().trim().max(500).optional(),
});

import { z } from 'zod';

export const transferSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  destinationTableId: z.coerce.number().int().positive(),
});

export const swapSchema = z.object({
  sourceTableId: z.coerce.number().int().positive(),
  destinationTableId: z.coerce.number().int().positive(),
}).refine((value) => value.sourceTableId !== value.destinationTableId, {
  message: 'Source and destination tables must be different',
  path: ['destinationTableId'],
});

export const mergeSchema = swapSchema;

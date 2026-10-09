import { z } from 'zod';

export const createTableAllocationSchema = z.object({
  diningTableId: z.coerce.number().int().positive('Dining table ID is required'),
  userId: z.coerce.number().int().positive('User ID is required'),
});

export const updateTableAllocationSchema = z.object({
  userId: z.coerce.number().int().positive('User ID is required'),
});

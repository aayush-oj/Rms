import { z } from 'zod';

const nonNegative = z.coerce.number().finite().min(0).max(999999999999);
const positive = z.coerce.number().finite().positive().max(999999999999);

export const createCategorySchema = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().max(50).optional(), isActive: z.boolean().default(true) });
export const updateCategorySchema = createCategorySchema.partial();
export const createLocationSchema = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(50).toUpperCase(), notes: z.string().trim().max(500).nullable().optional(), isActive: z.boolean().default(true) });
export const updateLocationSchema = createLocationSchema.partial();
export const createItemSchema = z.object({ name: z.string().trim().min(1).max(180), sku: z.string().trim().max(80).nullable().optional(), categoryId: z.coerce.number().int().positive().nullable().optional(), unitId: z.coerce.number().int().positive(), costPerUnit: nonNegative.default(0), reorderPoint: nonNegative.default(0), reorderQuantity: nonNegative.default(0), isActive: z.boolean().default(true), notes: z.string().trim().max(1000).nullable().optional() });
export const updateItemSchema = createItemSchema.partial();
export const openingStockSchema = z.object({ inventoryItemId: z.coerce.number().int().positive(), locationId: z.coerce.number().int().positive(), quantity: positive, reason: z.string().trim().min(1).max(255), notes: z.string().trim().max(500).nullable().optional() });
export const adjustmentSchema = z.object({ inventoryItemId: z.coerce.number().int().positive(), locationId: z.coerce.number().int().positive(), deltaQuantity: z.coerce.number().finite().refine(v => v !== 0, 'Adjustment must not be zero').max(999999999999).min(-999999999999), reason: z.string().trim().min(1).max(255), notes: z.string().trim().max(500).nullable().optional() });
export const transferSchema = z.object({ inventoryItemId: z.coerce.number().int().positive(), fromLocationId: z.coerce.number().int().positive(), toLocationId: z.coerce.number().int().positive(), quantity: positive, reason: z.string().trim().min(1).max(255), notes: z.string().trim().max(500).nullable().optional() });
export const createCountSchema = z.object({ locationId: z.coerce.number().int().positive(), itemIds: z.array(z.coerce.number().int().positive()).min(1).max(1000), notes: z.string().trim().max(500).nullable().optional() });
export const confirmCountSchema = z.object({ items: z.array(z.object({ inventoryItemId: z.coerce.number().int().positive(), countedQuantity: nonNegative })).min(1).max(1000) });
export const inventoryListQuerySchema = z.object({ search: z.string().trim().max(100).optional(), categoryId: z.coerce.number().int().positive().optional(), locationId: z.coerce.number().int().positive().optional(), status: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(), activeOnly: z.coerce.boolean().default(true) });
export const movementListQuerySchema = z.object({ inventoryItemId: z.coerce.number().int().positive().optional(), locationId: z.coerce.number().int().positive().optional(), movementType: z.enum(['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT_CORRECTION']).optional(), performedBy: z.coerce.number().int().positive().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

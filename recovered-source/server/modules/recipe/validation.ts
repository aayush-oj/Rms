import { z } from 'zod';

const positiveId = z.coerce.number().int().positive();
const quantity = z.coerce.number().positive().max(999999999);

export const createRecipeSchema = z.object({
  menuItemId: positiveId,
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(5000).nullable().optional(),
  yieldQuantity: quantity.default(1),
  yieldUnitId: positiveId,
});

export const updateRecipeSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  itemClassification: z.enum(['FOOD','BEVERAGE','OTHER']).optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const createVersionSchema = z.object({
  yieldQuantity: quantity,
  yieldUnitId: positiveId,
  effectiveFrom: z.coerce.date().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export const updateVersionSchema = z.object({
  yieldQuantity: quantity.optional(),
  yieldUnitId: positiveId.optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const ingredientSchema = z.object({
  inventoryItemId: positiveId,
  locationId: positiveId,
  quantity,
  unitId: positiveId,
});

export const updateIngredientSchema = z.object({
  locationId: positiveId.optional(),
  quantity: quantity.optional(),
  unitId: positiveId.optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const directStockLinkSchema = z.object({
  inventoryItemId: positiveId,
  locationId: positiveId,
  quantityPerSale: quantity,
  unitId: positiveId,
  isActive: z.boolean().default(true),
});

export const ingredientImpactSchema = z.object({
  inventoryItemId: positiveId,
  locationId: positiveId,
  quantityDelta: z.coerce.number().refine(v => Number.isFinite(v) && v !== 0, 'Quantity delta must be non-zero'),
  unitId: positiveId,
});

export const listRecipesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT','ACTIVE','ARCHIVED']).optional(),
  classification: z.enum(['FOOD','BEVERAGE','OTHER']).optional(),
});

import { z } from 'zod';

const nullableCount = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.coerce.number().int().min(0).nullable(),
);
const nullablePackageName = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.string().trim().min(1).max(60).nullable(),
);
const nullablePackageSize = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.coerce.number().int().min(2).max(100000).nullable(),
);
const nullableImageUrl = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.string().trim().max(500).nullable(),
);

const stockItemBaseSchema = z.object({
  name: z.string().trim().min(1).max(150),
  imageUrl: nullableImageUrl.optional(),
  packageName: nullablePackageName.optional(),
  packageSize: nullablePackageSize.optional(),
  lowThreshold: nullableCount.optional(),
  criticalThreshold: nullableCount.optional(),
  isActive: z.boolean().optional(),
});

const validateThresholds = (
  value: { lowThreshold?: number | null; criticalThreshold?: number | null },
  ctx: z.RefinementCtx,
) => {
  if (value.lowThreshold != null && value.criticalThreshold != null && value.criticalThreshold > value.lowThreshold) {
    ctx.addIssue({ code: 'custom', path: ['criticalThreshold'], message: 'Critical stock level must be less than or equal to low stock level' });
  }
};

export const createStockItemSchema = stockItemBaseSchema.extend({
  initialQuantity: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().optional().default(true),
}).superRefine((value, ctx) => {
  if (Boolean(value.packageName) !== (value.packageSize != null)) {
    ctx.addIssue({ code: 'custom', path: ['packageSize'], message: 'Package name and items per package must be configured together' });
  }
  validateThresholds(value, ctx);
});

// Partial updates must be derived from an unrefined object schema. The
// repository validates the final merged package/threshold state against the
// persisted item when only one side of a pair is supplied.
export const updateStockItemSchema = stockItemBaseSchema.partial().superRefine((value, ctx) => {
  validateThresholds(value, ctx);
  if (Object.prototype.hasOwnProperty.call(value, 'packageName') && Object.prototype.hasOwnProperty.call(value, 'packageSize')) {
    if (Boolean(value.packageName) !== (value.packageSize != null)) {
      ctx.addIssue({ code: 'custom', path: ['packageSize'], message: 'Package name and items per package must be configured together' });
    }
  }
});

export const stockInSchema = z.object({
  quantity: z.coerce.number().int().min(0).optional().default(0),
  packageCount: z.coerce.number().int().min(0).optional().default(0),
  looseCount: z.coerce.number().int().min(0).optional().default(0),
  reason: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.quantity <= 0 && value.packageCount <= 0 && value.looseCount <= 0) {
    ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a quantity, package count, or loose-piece count' });
  }
});

export const adjustStockSchema = z.object({
  newQuantity: z.coerce.number().int().min(0),
  reason: z.string().trim().min(2, 'Adjustment reason is required').max(500),
});

export const setStockDependenciesSchema = z.object({
  dependencies: z.array(z.object({
    stockItemId: z.coerce.number().int().positive(),
    quantityRequired: z.coerce.number().int().positive().max(100000),
  })).max(50),
}).superRefine((value, ctx) => {
  const seen = new Set<number>();
  value.dependencies.forEach((dependency, index) => {
    if (seen.has(dependency.stockItemId)) ctx.addIssue({ code: 'custom', path: ['dependencies', index, 'stockItemId'], message: 'A stock item may only be linked once' });
    seen.add(dependency.stockItemId);
  });
});

export const setStockMenuLinksSchema = z.object({
  links: z.array(z.object({
    menuItemId: z.coerce.number().int().positive(),
    quantityRequired: z.coerce.number().int().positive().max(100000),
  })).max(500),
}).superRefine((value, ctx) => {
  const seen = new Set<number>();
  value.links.forEach((link, index) => {
    if (seen.has(link.menuItemId)) ctx.addIssue({ code: 'custom', path: ['links', index, 'menuItemId'], message: 'A menu item may only be linked once' });
    seen.add(link.menuItemId);
  });
});

export const stockHistoryQuerySchema = z.object({
  stockItemId: z.coerce.number().int().positive().optional(),
  movementType: z.enum(['STOCK_IN', 'SALE', 'CANCELLATION_RETURN', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const stockTransferSchema = z.object({
  sourceStockItemId: z.coerce.number().int().positive(),
  destinationBranchId: z.coerce.number().int().positive(),
  destinationStockItemId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  note: z.string().trim().max(500).nullable().optional(),
});
import { z } from 'zod';

export const createVariantSchema = z.object({
  menuItemId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  price: z.coerce.number().min(0).max(99999999.9999),
  priceMode: z.enum(['OVERRIDE','ADDITIONAL']).default('OVERRIDE'),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export const updateVariantSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  price: z.coerce.number().min(0).max(99999999.9999).optional(),
  priceMode: z.enum(['OVERRIDE','ADDITIONAL']).optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
const modifierGroupFields = z.object({
  name: z.string().trim().min(1).max(100),
  selectionMode: z.enum(['SINGLE','MULTI']),
  minSelections: z.coerce.number().int().min(0),
  maxSelections: z.coerce.number().int().min(1),
  pricingStrategy: z.enum(['NO_CHARGE','SHARED_PRICE','INDIVIDUAL']),
  sharedPrice: z.coerce.number().min(0),
  displayOrder: z.coerce.number().int().min(0),
  isActive: z.boolean(),
});
function validateSelectionLimits(v: Partial<z.infer<typeof modifierGroupFields>>, ctx: z.RefinementCtx) {
  if (v.minSelections !== undefined && v.maxSelections !== undefined && v.minSelections > v.maxSelections) ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Minimum cannot exceed maximum' });
  if (v.selectionMode === 'SINGLE' && v.maxSelections !== undefined && v.maxSelections !== 1) ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: 'Single-select groups must have max 1' });
}
export const createModifierGroupSchema = modifierGroupFields.extend({
  selectionMode: modifierGroupFields.shape.selectionMode.default('SINGLE'),
  minSelections: modifierGroupFields.shape.minSelections.default(0),
  maxSelections: modifierGroupFields.shape.maxSelections.default(1),
  pricingStrategy: modifierGroupFields.shape.pricingStrategy.default('INDIVIDUAL'),
  sharedPrice: modifierGroupFields.shape.sharedPrice.default(0),
  displayOrder: modifierGroupFields.shape.displayOrder.default(0),
  isActive: modifierGroupFields.shape.isActive.default(true),
}).superRefine(validateSelectionLimits);
// Cross-field rules involving omitted fields are checked against persisted values
// by updateGroup. PATCH must not inject create defaults into omitted fields.
export const updateModifierGroupSchema = modifierGroupFields.partial().superRefine(validateSelectionLimits);
export const createModifierOptionSchema = z.object({
  modifierGroupId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  priceAdjustment: z.coerce.number().min(0).max(99999999.9999).default(0),
  displayOrder: z.coerce.number().int().min(0).default(0),
  allowRepeat: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const updateModifierOptionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  priceAdjustment: z.coerce.number().min(0).max(99999999.9999).optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  allowRepeat: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const attachGroupSchema = z.object({
  modifierGroupId: z.coerce.number().int().positive(),
  displayOrder: z.coerce.number().int().min(0).default(0),
});

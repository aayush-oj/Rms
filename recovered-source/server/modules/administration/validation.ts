import { z } from 'zod';

// Floors
export const createFloorSchema = z.object({
  name: z.string().trim().min(1, 'Floor name is required').max(100),
  displayOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateFloorSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  displayOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

// Sections
export const createSectionSchema = z.object({
  floorId: z.coerce.number().int().positive('Floor ID must be a positive integer'),
  name: z.string().trim().min(1, 'Floor name is required').max(100),
  displayOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateSectionSchema = z.object({
  floorId: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  displayOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

// Dining Tables
// AVAILABLE/OCCUPIED are lifecycle projections. External CRUD must not fabricate occupancy.
export const createTableSchema = z.object({
  floorId: z.coerce.number().int().positive('Floor ID is required'),
  sectionId: z.coerce.number().int().positive('Section ID is required'),
  tableNumber: z.string().trim().min(1, 'Table number is required').max(50),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(100).default(2),
  status: z.enum(['available', 'reserved', 'cleaning', 'disabled']).default('available'),
  posX: z.coerce.number().int().default(0),
  posY: z.coerce.number().int().default(0),
  width: z.coerce.number().int().min(20).max(1000).default(100),
  height: z.coerce.number().int().min(20).max(1000).default(100),
  shape: z.enum(['square', 'rectangle', 'round']).default('square'),
  assignedWaiterId: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateTableSchema = z.object({
  floorId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  tableNumber: z.string().trim().min(1).max(50).optional(),
  capacity: z.coerce.number().int().min(1).max(100).optional(),
  // Table status is controlled by dine-in/table-operation transactions, not generic table CRUD.
  status: z.never().optional(),
  posX: z.coerce.number().int().optional(),
  posY: z.coerce.number().int().optional(),
  width: z.coerce.number().int().min(20).max(1000).optional(),
  height: z.coerce.number().int().min(20).max(1000).optional(),
  shape: z.enum(['square', 'rectangle', 'round']).optional(),
  assignedWaiterId: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
});

// Hardware Printers
export const createPrinterSchema = z.object({
  name: z.string().trim().min(1, 'Printer name is required').max(100),
  ipAddress: z.string().trim().min(1, 'IP address is required').max(45),
  port: z.coerce.number().int().min(1).max(65535).default(9100),
  paperWidth: z.enum(['58mm', '80mm']).default('80mm'),
  deviceType: z.string().trim().max(50).default('ESC_POS'),
  isActive: z.boolean().default(true),
});

export const updatePrinterSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  ipAddress: z.string().trim().min(1).max(45).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  paperWidth: z.enum(['58mm', '80mm']).optional(),
  deviceType: z.string().trim().max(50).optional(),
  isActive: z.boolean().optional(),
});

// Preparation Stations
export const createStationSchema = z.object({
  name: z.string().trim().min(1, 'Station name is required').max(100),
  type: z.enum(['kitchen', 'bar', 'counter', 'expediter']).default('kitchen'),
  primaryPrinterId: z.coerce.number().int().positive().nullable().optional(),
  backupPrinterId: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateStationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(['kitchen', 'bar', 'counter', 'expediter']).optional(),
  primaryPrinterId: z.coerce.number().int().positive().nullable().optional(),
  backupPrinterId: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Authoritative branch VAT profile
export const configureBranchTaxSchema = z.object({
  isVatRegistered: z.boolean(),
  taxRegistrationNumber: z.string().trim().min(1).max(50).nullable(),
  vatRate: z.number().min(0).max(1).optional(),
  defaultPriceEntryMode: z.enum(['VAT_INCLUDED', 'VAT_EXCLUDED']),
  roundingMethod: z.enum(['HALF_EVEN', 'HALF_UP', 'ROUND_DOWN', 'ROUND_UP']).default('HALF_EVEN'),
}).superRefine((value, ctx) => {
  if (value.isVatRegistered && !value.taxRegistrationNumber) {
    ctx.addIssue({ code: 'custom', path: ['taxRegistrationNumber'], message: 'VAT registration number is required for a VAT-registered branch' });
  }
  const expectedRate = value.isVatRegistered ? 0.13 : 0;
  if (value.vatRate !== undefined && Math.abs(value.vatRate - expectedRate) > 0.000001) {
    ctx.addIssue({ code: 'custom', path: ['vatRate'], message: value.isVatRegistered ? 'VAT rate is fixed at 13%' : 'VAT rate must be zero when VAT registration is off' });
  }
}).transform((value) => ({
  ...value,
  taxRegistrationNumber: value.isVatRegistered ? value.taxRegistrationNumber : null,
  vatRate: value.isVatRegistered ? 0.13 : 0,
}));

// Payment Methods
export const createPaymentMethodSchema = z.object({
  branchId: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1, 'Payment method name is required').max(100),
  code: z.string().trim().min(1, 'Payment method code is required').max(50).toUpperCase(),
  type: z.enum([
    'CASH',
    'CREDIT_CARD',
    'DEBIT_CARD',
    'QR_CODE',
    'MOBILE_WALLET',
    'BANK_TRANSFER',
    'HOUSE_CREDIT',
    'OTHER',
  ]).default('CASH'),
  requiresReference: z.boolean().default(false),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
});

export const updatePaymentMethodSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().trim().min(1).max(50).toUpperCase().optional(),
  type: z.enum([
    'CASH',
    'CREDIT_CARD',
    'DEBIT_CARD',
    'QR_CODE',
    'MOBILE_WALLET',
    'BANK_TRANSFER',
    'HOUSE_CREDIT',
    'OTHER',
  ]).optional(),
  requiresReference: z.boolean().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.coerce.number().int().optional(),
});

// Units of Measure
export const createUnitSchema = z.object({
  name: z.string().trim().min(1, 'Unit name is required').max(50),
  symbol: z.string().trim().min(1, 'Unit symbol is required').max(20).toLowerCase(),
  dimension: z.enum(['MASS', 'VOLUME', 'COUNT', 'LENGTH', 'TIME']),
  baseUnitSymbol: z.string().trim().min(1).max(20).toLowerCase(),
  conversionFactor: z.number().positive('Conversion factor must be positive').default(1.0),
  isActive: z.boolean().default(true),
});

export const updateUnitSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  symbol: z.string().trim().min(1).max(20).toLowerCase().optional(),
  dimension: z.enum(['MASS', 'VOLUME', 'COUNT', 'LENGTH', 'TIME']).optional(),
  baseUnitSymbol: z.string().trim().min(1).max(20).toLowerCase().optional(),
  conversionFactor: z.number().positive().optional(),
  isActive: z.boolean().optional(),
});

// Operational Settings
export const updateOperationalSettingsSchema = z.object({
  branchId: z.coerce.number().int().positive().nullable().optional(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM format').optional(),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM format').optional(),
  operatingDays: z.array(z.string().trim()).optional(),
  dineInEnabled: z.boolean().optional(),
  takeawayEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
  receiptHeader: z.string().trim().nullable().optional(),
  receiptFooter: z.string().trim().nullable().optional(),
  currencySymbol: z.string().trim().max(10).optional(),
  autoPrintKot: z.boolean().optional(),
  autoPrintBill: z.boolean().optional(),
});

// Menu Categories
export const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Menu category name is required').max(100),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  stationId: z.coerce.number().int().positive().nullable().optional(),
  displayOrder: z.coerce.number().int().default(0),
  imageUrl: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateMenuCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  stationId: z.coerce.number().int().positive().nullable().optional(),
  displayOrder: z.coerce.number().int().optional(),
  imageUrl: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
});

// Menu Items
export const createMenuItemSchema = z.object({
  categoryId: z.coerce.number().int().positive('Category ID is required'),
  defaultPrepStationId: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1, 'Menu item name is required').max(150),
  sku: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  enteredPrice: z.coerce.number().min(0, 'Price cannot be negative').max(99999999.9999),
  priceEntryMode: z.enum(['VAT_INCLUDED', 'VAT_EXCLUDED']),
  costPrice: z.coerce.number().min(0, 'Cost price cannot be negative').max(99999999.9999).default(0),
  imageUrl: z.string().trim().max(255).nullable().optional(),
  isAvailable: z.boolean().default(true),
  isCombo: z.boolean().default(false),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  prepTimeMinutes: z.coerce.number().int().min(0).nullable().optional(),
});

export const menuComboComponentsSchema = z.object({
  components: z.array(z.object({
    menuItemId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(2, 'A combo needs at least two menu items').max(50),
});

export const updateMenuItemSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  defaultPrepStationId: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(150).optional(),
  sku: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  enteredPrice: z.coerce.number().min(0).max(99999999.9999).optional(),
  priceEntryMode: z.enum(['VAT_INCLUDED', 'VAT_EXCLUDED']).optional(),
  costPrice: z.coerce.number().min(0).max(99999999.9999).optional(),
  imageUrl: z.string().trim().max(255).nullable().optional(),
  isAvailable: z.boolean().optional(),
  isCombo: z.boolean().optional(),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  prepTimeMinutes: z.coerce.number().int().min(0).nullable().optional(),
});

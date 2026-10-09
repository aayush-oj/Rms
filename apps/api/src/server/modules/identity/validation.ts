import { z } from 'zod';

const phoneSchema = z.string().trim()
  .min(7, 'Phone number is too short')
  .max(25, 'Phone number is too long')
  .regex(/^\+?[0-9][0-9\s().-]{5,23}[0-9]$/, 'Enter a valid phone number');

const restaurantHandleSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z][a-z0-9]{2,14}$/, 'Restaurant handle must be 3-15 characters, start with a letter, and use only lowercase letters or numbers');


const latitudeSchema = z.number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

const longitudeSchema = z.number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

function validateCoordinatePair(
  data: { latitude?: number | null; longitude?: number | null },
  ctx: z.RefinementCtx,
): void {
  const bothOmitted =
    data.latitude === undefined && data.longitude === undefined;
  const bothNull = data.latitude === null && data.longitude === null;
  const bothNumbers =
    typeof data.latitude === 'number'
    && typeof data.longitude === 'number';

  if (bothOmitted || bothNull || bothNumbers) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['latitude'],
    message: 'Latitude and longitude must be provided together',
  });
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['longitude'],
    message: 'Latitude and longitude must be provided together',
  });
}

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2, 'Registered restaurant name must be at least 2 characters').max(150),
  restaurantHandle: restaurantHandleSchema,
  legalName: z.string().trim().max(200).optional(),
  taxIdentifier: z.string().trim().max(50).optional(),
  currencyCode: z.string().trim().length(3).default('NPR'),
  branchName: z.string().trim().max(150).optional(),
  branchCode: z.string().trim().min(2).max(20).optional(),
  branchAddress: z.string().trim().max(500).optional(),
  ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters').max(100),
  ownerEmail: z.string().trim().email('Invalid email address').toLowerCase(),
  ownerPhone: phoneSchema,
  ownerPassword: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export const loginSchema = z.object({
  username: z.string().trim().min(5, 'Username is required').max(100).toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(100),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(100),
});

export const handleSuggestionsSchema = z.object({
  restaurantName: z.string().trim().min(2, 'Registered restaurant name must be at least 2 characters').max(150),
});

export const handleAvailabilitySchema = z.object({
  restaurantHandle: restaurantHandleSchema,
});

export const switchBranchSchema = z.object({
  targetBranchId: z.coerce.number().int().positive('Target branch ID must be a positive integer'),
});

export const updateOrgSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  legalName: z.string().trim().max(200).optional(),
  taxIdentifier: z.string().trim().max(50).optional(),
  currencyCode: z.string().trim().length(3).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const createBranchSchema = z.object({
  name: z.string().trim().min(2, 'Branch name is required').max(150),
  code: z.string().trim().min(2).max(20).toUpperCase(),
  address: z.string().trim().max(500).optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().optional(),
  billPrefix: z.string().trim().max(10).default('FH-'),
  timezone: z.string().trim().min(1).default('Asia/Kathmandu'),
}).superRefine(validateCoordinatePair);

export const updateBranchSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  code: z.string().trim().min(2).max(20).toUpperCase().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  billPrefix: z.string().trim().max(10).optional(),
  timezone: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
}).superRefine(validateCoordinatePair);

const staffCredentialSchema = z.string()
  .min(1, 'Password or PIN is required')
  .max(100)
  .refine(
    value => /^\d{4,6}$/.test(value) || value.length >= 8,
    'Use a 4-6 digit PIN or a password with at least 8 characters',
  );

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Staff name is required').max(100),
  roleId: z.coerce.number().int().positive(),
  defaultBranchId: z.coerce.number().int().positive(),
  allowedBranchIds: z.array(z.coerce.number().int().positive()).optional(),
  password: staffCredentialSchema,
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  roleId: z.coerce.number().int().positive().optional(),
  defaultBranchId: z.coerce.number().int().positive().optional(),
  allowedBranchIds: z.array(z.coerce.number().int().positive()).optional(),
  password: staffCredentialSchema.optional(),
  isActive: z.boolean().optional(),
});

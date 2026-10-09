import { z } from 'zod';

export const platformAdminLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254).toLowerCase(),
  password: z.string().min(1, 'Password is required').max(128),
});

export const platformAdminPasswordSchema = z.string()
  .min(14, 'Password must be at least 14 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/\d/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a symbol');

export const platformAdminChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: platformAdminPasswordSchema,
});

export const platformAdminForgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254).toLowerCase(),
});

export const platformAdminResetPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254).toLowerCase(),
  otp: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
  newPassword: platformAdminPasswordSchema,
});


export const platformOrganizationListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum([
    'PENDING',
    'TRIAL',
    'ACTIVE',
    'GRACE_PERIOD',
    'SUSPENDED',
    'SECURITY_SUSPENDED',
    'CANCELLED',
  ]).optional(),
  accessMode: z.enum(['NORMAL', 'GRACE', 'BLOCKED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const platformOrganizationIdParamsSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});

export const platformActivationRequestListQuerySchema = z.object({
  status: z.enum([
    'OPEN',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
  ]).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const platformActivationRequestIdParamsSchema = z.object({
  requestId: z.coerce.number().int().positive(),
});

export const platformActivationRequestApproveBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  customerMessage: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform(value => {
      if (value == null) return null;
      return value || null;
    }),
});

export const platformActivationRequestApproveUntilBodySchema =
  platformActivationRequestApproveBodySchema.extend({
    accessEndsAt: z
      .string()
      .trim()
      .refine(
        value =>
          /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
          && !Number.isNaN(Date.parse(value)),
        {
          message: 'Enter an ISO date/time with a timezone',
        },
      )
      .transform(value => new Date(value)),
  });

export const platformActivationRequestRejectBodySchema = z.object({
  reviewNote: z.string().trim().min(1).max(500),
});

const platformAuditDateQuerySchema = z
  .string()
  .trim()
  .max(64)
  .refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Enter a valid date/time',
  });

export const platformAuditListQuerySchema = z.object({
  organizationId: z.coerce.number().int().positive().optional(),
  platformAdminId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  targetType: z.string().trim().min(1).max(100).optional(),
  from: platformAuditDateQuerySchema.optional(),
  to: platformAuditDateQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const platformAuditIdParamsSchema = z.object({
  auditId: z.coerce.number().int().positive(),
});


const platformLifecycleReasonSchema = z.string().trim().min(1).max(500);

const platformLifecycleCustomerMessageSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .transform(value => {
    if (value == null) return null;
    return value || null;
  });

const platformLifecycleAccessEndsAtSchema = z
  .string()
  .trim()
  .refine(
    value =>
      /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value)),
    {
      message: 'Enter an ISO date/time with a timezone',
    },
  )
  .transform(value => new Date(value))
  .nullable();

export const platformLifecycleCommonActionBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});

export const platformLifecycleActiveActionBodySchema =
  platformLifecycleCommonActionBodySchema.extend({
    accessEndsAt: platformLifecycleAccessEndsAtSchema,
  });


export const platformAccessExpiryBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  accessEndsAt: platformLifecycleAccessEndsAtSchema,
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});


const platformGraceEndsAtSchema = z
  .string()
  .trim()
  .refine(
    value =>
      /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value)),
    {
      message: 'Enter an ISO date/time with a timezone',
    },
  )
  .transform(value => new Date(value));

export const platformStartGraceBodySchema =
  platformLifecycleCommonActionBodySchema.extend({
    graceEndsAt: platformGraceEndsAtSchema,
  });

export const platformExtendGraceBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  graceEndsAt: platformGraceEndsAtSchema,
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});

export const platformEndGraceBodySchema =
  platformLifecycleCommonActionBodySchema.extend({
    accessEndsAt: platformLifecycleAccessEndsAtSchema,
  });


const platformScheduledSuspensionAtSchema = z
  .string()
  .trim()
  .refine(
    value =>
      /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value)),
    {
      message: 'Enter an ISO date/time with a timezone',
    },
  )
  .transform(value => new Date(value));

export const platformScheduleSuspensionBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  scheduledSuspensionAt: platformScheduledSuspensionAtSchema,
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});

export const platformRescheduleSuspensionBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  scheduledSuspensionAt: platformScheduledSuspensionAtSchema,
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});

export const platformCancelScheduledSuspensionBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});


const platformSecurityConfirmationHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(100);

const platformSecurityActionBaseShape = {
  expectedVersion: z.number().int().positive(),
  confirmationHandle: platformSecurityConfirmationHandleSchema,
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
};

export const platformSecuritySuspendBodySchema = z.object(
  platformSecurityActionBaseShape,
);

const platformClearSecurityToActiveBodySchema = z.object({
  ...platformSecurityActionBaseShape,
  restoreTo: z.literal('ACTIVE'),
  accessEndsAt: platformLifecycleAccessEndsAtSchema,
});

const platformClearSecurityToSuspendedBodySchema = z.object({
  ...platformSecurityActionBaseShape,
  restoreTo: z.literal('SUSPENDED'),
  accessEndsAt: z.never().optional(),
});

export const platformClearSecuritySuspensionBodySchema =
  z.discriminatedUnion('restoreTo', [
    platformClearSecurityToActiveBodySchema,
    platformClearSecurityToSuspendedBodySchema,
  ]);


export const platformCancelOrganizationBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  confirmationText: z.string().trim().min(1).max(120),
  reason: platformLifecycleReasonSchema,
  customerMessage: platformLifecycleCustomerMessageSchema,
});

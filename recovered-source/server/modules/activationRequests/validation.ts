import { z } from 'zod';

export const submitActivationRequestSchema = z.object({
  note: z
    .string()
    .trim()
    .max(1000, 'Activation request note must be 1000 characters or fewer')
    .nullable()
    .optional()
    .transform(value => {
      if (value == null || value.length === 0) return null;
      return value;
    }),
});

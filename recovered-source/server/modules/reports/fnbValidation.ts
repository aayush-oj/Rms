import { z } from 'zod';
import { reportFiltersSchema } from './validation';

export const fnbFiltersSchema = reportFiltersSchema.safeExtend({
  classification: z.enum(['FOOD','BEVERAGE','OTHER']).optional(),
  period: z.enum(['current','previous','all']).optional(),
});

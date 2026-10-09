import { z } from 'zod';

export const alertSettingsQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
});

export const alertListQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(['OPEN','RESOLVED']).optional(),
  severity: z.enum(['INFO','WARNING','CRITICAL']).optional(),
  category: z.enum(['KITCHEN','SERVICE','TABLE','PAYMENT','SHIFT','BUSINESS_DAY','INVENTORY','PURCHASING','EXPENSE','SECURITY','SYSTEM']).optional(),
  type: z.string().trim().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const optionalMinutes=(min:number,max:number)=>z.preprocess(
  (value)=>value===''||value===undefined?undefined:value,
  z.coerce.number().int().min(min).max(max).nullable().optional(),
);

const alertSettingsFields = {
  kotDelayMinutes: optionalMinutes(1,240),
  readyNotServedMinutes: optionalMinutes(1,120),
  longTableMinutes: optionalMinutes(5,1440),
  unpaidTableMinutes: optionalMinutes(5,1440),
  shiftOpenMinutes: optionalMinutes(30,1440),
  cashVarianceWarning: z.coerce.number().min(0).max(10000000).optional(),
  cashVarianceCritical: z.coerce.number().min(0).max(10000000).optional(),
  lowStockEnabled: z.boolean().optional(),
  poOverdueEnabled: z.boolean().optional(),
};

function validateVariance(v:any,ctx:z.RefinementCtx){
  if(v.cashVarianceWarning!==undefined&&v.cashVarianceCritical!==undefined&&v.cashVarianceCritical<v.cashVarianceWarning){
    ctx.addIssue({code:'custom',path:['cashVarianceCritical'],message:'Critical variance must be greater than or equal to warning variance'});
  }
}

export const alertSettingsPatchSchema=z.object(alertSettingsFields).superRefine(validateVariance);
export const alertSettingsRequestSchema=z.object({branchId:z.coerce.number().int().positive().optional(),...alertSettingsFields}).superRefine(validateVariance);

import { Router } from 'express';
import { tableAllocationController } from './controller';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { createTableAllocationSchema, updateTableAllocationSchema } from './validation';

export const tableAllocationsRouter = Router();
tableAllocationsRouter.use(authenticate());

tableAllocationsRouter.get('/', tableAllocationController.listAllocations);
tableAllocationsRouter.post(
  '/',
  requirePermission('pos:tables:allocate'),
  validateRequest({ body: createTableAllocationSchema }),
  tableAllocationController.createAllocation
);
tableAllocationsRouter.get('/:id', tableAllocationController.getAllocation);
tableAllocationsRouter.patch(
  '/:id',
  requirePermission('pos:tables:allocate'),
  validateRequest({ body: updateTableAllocationSchema }),
  tableAllocationController.updateAllocation
);
tableAllocationsRouter.delete(
  '/:id',
  requirePermission('pos:tables:allocate'),
  tableAllocationController.deactivateAllocation
);

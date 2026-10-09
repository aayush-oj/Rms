import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { shiftController } from './controller';
import { openBusinessDaySchema, closeBusinessDaySchema, registerCreateSchema, registerUpdateSchema, openShiftSchema, closeShiftSchema, cashMovementSchema } from './validation';

export const shiftRouter = Router();
shiftRouter.use(authenticate());

shiftRouter.get('/business-days/current', requirePermission('businessday:view'), shiftController.currentBusinessDay);
shiftRouter.get('/business-days', requirePermission('businessday:view'), shiftController.listBusinessDays);
shiftRouter.get('/business-days/:id', requirePermission('businessday:view'), shiftController.getBusinessDay);
shiftRouter.post('/business-days/open', requirePermission('businessday:open'), validateRequest({body: openBusinessDaySchema}), shiftController.openBusinessDay);
shiftRouter.post('/business-days/:id/close', requirePermission('businessday:close'), validateRequest({body: closeBusinessDaySchema}), shiftController.closeBusinessDay);

shiftRouter.get('/registers', requirePermission('shift:view'), shiftController.listRegisters);
shiftRouter.post('/registers', requirePermission('admin:registers:manage'), validateRequest({body: registerCreateSchema}), shiftController.createRegister);
shiftRouter.patch('/registers/:id', requirePermission('admin:registers:manage'), validateRequest({body: registerUpdateSchema}), shiftController.updateRegister);

shiftRouter.get('/current', requirePermission('shift:view'), shiftController.currentShift);
shiftRouter.get('/', requirePermission('shift:view'), shiftController.listShifts);
shiftRouter.get('/:id', requirePermission('shift:view'), shiftController.getShift);
shiftRouter.get('/:id/summary', requirePermission('shift:view'), shiftController.summary);
shiftRouter.get('/:id/cash-movements', requirePermission('shift:cash:manage'), shiftController.listMovements);
shiftRouter.post('/:id/cash-movements', requirePermission('shift:cash:manage'), validateRequest({body: cashMovementSchema}), shiftController.addMovement);
shiftRouter.post('/:id/close', requirePermission('shift:close'), validateRequest({body: closeShiftSchema}), shiftController.closeShift);
shiftRouter.post('/', requirePermission('shift:open'), validateRequest({body: openShiftSchema}), shiftController.openShift);

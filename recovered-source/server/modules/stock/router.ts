import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { stockController } from './controller';
import {
  adjustStockSchema,
  createStockItemSchema,
  setStockDependenciesSchema,
  setStockMenuLinksSchema,
  stockHistoryQuerySchema,
  stockInSchema,
  stockTransferSchema,
  updateStockItemSchema,
} from './validation';

export const stockRouter=Router();
stockRouter.use(authenticate());

stockRouter.get('/items',requirePermission('inventory:view','inventory:items:manage'),stockController.list);
stockRouter.get('/items/:id',requirePermission('inventory:view','inventory:items:manage'),stockController.get);
stockRouter.get('/items/:id/menu-links',requirePermission('inventory:view','inventory:items:manage'),stockController.menuLinks);
stockRouter.put('/items/:id/menu-links',requirePermission('inventory:items:manage'),validateRequest({body:setStockMenuLinksSchema}),stockController.setMenuLinks);
stockRouter.post('/items',requirePermission('inventory:items:manage'),validateRequest({body:createStockItemSchema}),stockController.create);
stockRouter.patch('/items/:id',requirePermission('inventory:items:manage'),validateRequest({body:updateStockItemSchema}),stockController.update);
stockRouter.post('/items/:id/stock-in',requirePermission('inventory:adjust'),validateRequest({body:stockInSchema}),stockController.stockIn);
stockRouter.post('/items/:id/adjust',requirePermission('inventory:adjust'),validateRequest({body:adjustStockSchema}),stockController.adjust);

stockRouter.get('/availability',requirePermission('pos:orders:create','inventory:view'),stockController.availability);
stockRouter.get('/menu-items/:menuItemId/dependencies',requirePermission('inventory:view','inventory:items:manage'),stockController.dependencies);
stockRouter.put('/menu-items/:menuItemId/dependencies',requirePermission('inventory:items:manage'),validateRequest({body:setStockDependenciesSchema}),stockController.setDependencies);

stockRouter.get('/movements',requirePermission('inventory:history:view','inventory:view'),validateRequest({query:stockHistoryQuerySchema}),stockController.movements);

// Intentionally backend-only for now. No active product screen exposes transfers.
stockRouter.post('/transfers',requirePermission('inventory:transfer'),validateRequest({body:stockTransferSchema}),stockController.transfer);

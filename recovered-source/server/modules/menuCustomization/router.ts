import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { menuCustomizationController } from './controller';
import { createVariantSchema, updateVariantSchema, createModifierGroupSchema, updateModifierGroupSchema, createModifierOptionSchema, updateModifierOptionSchema, attachGroupSchema } from './validation';

export const menuCustomizationRouter = Router();
menuCustomizationRouter.use(authenticate());

menuCustomizationRouter.get('/modifier-groups', requirePermission('pos:orders:view', 'admin:menus:manage'), menuCustomizationController.listGroups);
menuCustomizationRouter.get('/items/:itemId/customizations', requirePermission('pos:orders:view', 'admin:menus:manage'), menuCustomizationController.getForMenuItem);
menuCustomizationRouter.post('/variants', requirePermission('admin:menus:manage'), validateRequest({ body: createVariantSchema }), menuCustomizationController.createVariant);
menuCustomizationRouter.patch('/variants/:id', requirePermission('admin:menus:manage'), validateRequest({ body: updateVariantSchema }), menuCustomizationController.updateVariant);
menuCustomizationRouter.post('/modifier-groups', requirePermission('admin:menus:manage'), validateRequest({ body: createModifierGroupSchema }), menuCustomizationController.createGroup);
menuCustomizationRouter.patch('/modifier-groups/:id', requirePermission('admin:menus:manage'), validateRequest({ body: updateModifierGroupSchema }), menuCustomizationController.updateGroup);
menuCustomizationRouter.post('/modifier-options', requirePermission('admin:menus:manage'), validateRequest({ body: createModifierOptionSchema }), menuCustomizationController.createOption);
menuCustomizationRouter.patch('/modifier-options/:id', requirePermission('admin:menus:manage'), validateRequest({ body: updateModifierOptionSchema }), menuCustomizationController.updateOption);
menuCustomizationRouter.post('/items/:itemId/modifier-groups', requirePermission('admin:menus:manage'), validateRequest({ body: attachGroupSchema }), menuCustomizationController.attachGroup);
menuCustomizationRouter.delete('/items/:itemId/modifier-groups/:groupId', requirePermission('admin:menus:manage'), menuCustomizationController.detachGroup);

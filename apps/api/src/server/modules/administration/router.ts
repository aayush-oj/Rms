import { Router } from 'express';
import { administrationController } from './controller';
import { authenticate, requirePermission, requireBranchAccess } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import {
  createFloorSchema,
  updateFloorSchema,
  createSectionSchema,
  updateSectionSchema,
  createTableSchema,
  updateTableSchema,
  createPrinterSchema,
  updatePrinterSchema,
  createStationSchema,
  updateStationSchema,
  configureBranchTaxSchema,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  createUnitSchema,
  updateUnitSchema,
  updateOperationalSettingsSchema,
  createMenuCategorySchema,
  updateMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  menuComboComponentsSchema,
} from './validation';

// ====================================================
// FLOORS ROUTER
// ====================================================
export const floorsRouter = Router();
floorsRouter.use(authenticate());
floorsRouter.get('/:id', administrationController.getFloor);
floorsRouter.patch(
  '/:id',
  requirePermission('admin:tables:manage'),
  validateRequest({ body: updateFloorSchema }),
  administrationController.updateFloor
);
floorsRouter.delete(
  '/:id',
  requirePermission('admin:tables:manage'),
  administrationController.deleteFloor
);

// ====================================================
// SECTIONS ROUTER
// ====================================================
export const sectionsRouter = Router();
sectionsRouter.use(authenticate());
sectionsRouter.get('/:id', administrationController.getSection);
sectionsRouter.patch(
  '/:id',
  requirePermission('admin:tables:manage'),
  validateRequest({ body: updateSectionSchema }),
  administrationController.updateSection
);
sectionsRouter.delete(
  '/:id',
  requirePermission('admin:tables:manage'),
  administrationController.deleteSection
);

// ====================================================
// DINING TABLES ROUTER
// ====================================================
export const tablesRouter = Router();
tablesRouter.use(authenticate());
tablesRouter.get('/:id', administrationController.getTable);
tablesRouter.patch(
  '/:id',
  requirePermission('admin:tables:manage', 'pos:tables:manage'),
  validateRequest({ body: updateTableSchema }),
  administrationController.updateTable
);
tablesRouter.delete(
  '/:id',
  requirePermission('admin:tables:manage'),
  administrationController.deleteTable
);

// ====================================================
// HARDWARE PRINTERS ROUTER
// ====================================================
export const printersRouter = Router();
printersRouter.use(authenticate());
printersRouter.get('/:id', administrationController.getPrinter);
printersRouter.patch(
  '/:id',
  requirePermission('admin:hardware:manage'),
  validateRequest({ body: updatePrinterSchema }),
  administrationController.updatePrinter
);
printersRouter.delete(
  '/:id',
  requirePermission('admin:hardware:manage'),
  administrationController.deletePrinter
);

// ====================================================
// PREPARATION STATIONS ROUTER
// ====================================================
export const stationsRouter = Router();
stationsRouter.use(authenticate());
stationsRouter.get('/:id', administrationController.getStation);
stationsRouter.patch(
  '/:id',
  requirePermission('admin:hardware:manage'),
  validateRequest({ body: updateStationSchema }),
  administrationController.updateStation
);
stationsRouter.delete(
  '/:id',
  requirePermission('admin:hardware:manage'),
  administrationController.deleteStation
);

// ====================================================
// MENU CATEGORIES ROUTER
// ====================================================
export const menuCategoriesRouter = Router();
menuCategoriesRouter.use(authenticate());
menuCategoriesRouter.get('/', administrationController.listMenuCategories);
menuCategoriesRouter.post(
  '/',
  requirePermission('admin:menus:manage'),
  validateRequest({ body: createMenuCategorySchema }),
  administrationController.createMenuCategory
);
menuCategoriesRouter.get('/:id', administrationController.getMenuCategory);
menuCategoriesRouter.patch(
  '/:id',
  requirePermission('admin:menus:manage'),
  validateRequest({ body: updateMenuCategorySchema }),
  administrationController.updateMenuCategory
);
menuCategoriesRouter.delete(
  '/:id',
  requirePermission('admin:menus:manage'),
  administrationController.deleteMenuCategory
);

// ====================================================
// MENU ITEMS ROUTER
// ====================================================
export const menuItemsRouter = Router();
menuItemsRouter.use(authenticate());
menuItemsRouter.get('/', administrationController.listMenuItems);
menuItemsRouter.post(
  '/',
  requirePermission('admin:menus:manage'),
  validateRequest({ body: createMenuItemSchema }),
  administrationController.createMenuItem
);
menuItemsRouter.get('/:id/combo-components', administrationController.getMenuComboComponents);
menuItemsRouter.put(
  '/:id/combo-components',
  requirePermission('admin:menus:manage'),
  validateRequest({ body: menuComboComponentsSchema }),
  administrationController.setMenuComboComponents
);
menuItemsRouter.get('/:id', administrationController.getMenuItem);
menuItemsRouter.patch(
  '/:id',
  requirePermission('admin:menus:manage'),
  validateRequest({ body: updateMenuItemSchema }),
  administrationController.updateMenuItem
);
menuItemsRouter.delete(
  '/:id',
  requirePermission('admin:menus:manage'),
  administrationController.deleteMenuItem
);

// ====================================================
// PAYMENT METHODS ROUTER
// ====================================================
export const paymentMethodsRouter = Router();
paymentMethodsRouter.use(authenticate());
paymentMethodsRouter.get('/', administrationController.listPaymentMethods);
paymentMethodsRouter.post(
  '/',
  requirePermission('admin:payments:manage'),
  validateRequest({ body: createPaymentMethodSchema }),
  administrationController.createPaymentMethod
);
paymentMethodsRouter.get('/:id', administrationController.getPaymentMethod);
paymentMethodsRouter.patch(
  '/:id',
  requirePermission('admin:payments:manage'),
  validateRequest({ body: updatePaymentMethodSchema }),
  administrationController.updatePaymentMethod
);
paymentMethodsRouter.delete(
  '/:id',
  requirePermission('admin:payments:manage'),
  administrationController.deletePaymentMethod
);

// ====================================================
// UNITS OF MEASURE ROUTER
// ====================================================
export const unitsRouter = Router();
unitsRouter.use(authenticate());
unitsRouter.get('/', administrationController.listUnits);
unitsRouter.post(
  '/',
  requirePermission('admin:units:manage'),
  validateRequest({ body: createUnitSchema }),
  administrationController.createUnit
);
unitsRouter.get('/:id', administrationController.getUnit);
unitsRouter.patch(
  '/:id',
  requirePermission('admin:units:manage'),
  validateRequest({ body: updateUnitSchema }),
  administrationController.updateUnit
);
unitsRouter.delete(
  '/:id',
  requirePermission('admin:units:manage'),
  administrationController.deleteUnit
);

// ====================================================
// OPERATIONAL SETTINGS ROUTER
// ====================================================
export const operationalSettingsRouter = Router();
operationalSettingsRouter.use(authenticate());
operationalSettingsRouter.get('/', administrationController.getOperationalSettings);
operationalSettingsRouter.patch(
  '/',
  requirePermission('admin:settings:manage'),
  validateRequest({ body: updateOperationalSettingsSchema }),
  administrationController.updateOperationalSettings
);

// ====================================================
// BRANCH SPECIFIC NESTED ROUTER
// Mounts branch-scoped operations under /api/v1/branches/:branchId/...
// ====================================================
export const branchAdministrationRouter = Router({ mergeParams: true });
branchAdministrationRouter.use(authenticate());
branchAdministrationRouter.use(requireBranchAccess);

// Floors under branch
branchAdministrationRouter.get('/floors', administrationController.listFloors);
branchAdministrationRouter.post(
  '/floors',
  requirePermission('admin:tables:manage'),
  validateRequest({ body: createFloorSchema }),
  administrationController.createFloor
);

// Sections under branch
branchAdministrationRouter.get('/sections', administrationController.listSections);
branchAdministrationRouter.post(
  '/sections',
  requirePermission('admin:tables:manage'),
  validateRequest({ body: createSectionSchema }),
  administrationController.createSection
);

// Tables under branch
branchAdministrationRouter.get('/tables', administrationController.listTables);
branchAdministrationRouter.post(
  '/tables',
  requirePermission('admin:tables:manage'),
  validateRequest({ body: createTableSchema }),
  administrationController.createTable
);

// Hardware Printers under branch
branchAdministrationRouter.get('/printers', administrationController.listPrinters);
branchAdministrationRouter.post(
  '/printers',
  requirePermission('admin:hardware:manage'),
  validateRequest({ body: createPrinterSchema }),
  administrationController.createPrinter
);

// Preparation Stations under branch
branchAdministrationRouter.get('/stations', administrationController.listStations);
branchAdministrationRouter.post(
  '/stations',
  requirePermission('admin:hardware:manage'),
  validateRequest({ body: createStationSchema }),
  administrationController.createStation
);

// Tax Configuration under branch
branchAdministrationRouter.get('/tax-config', administrationController.getBranchTaxConfig);
branchAdministrationRouter.put(
  '/tax-config',
  requirePermission('admin:taxes:manage'),
  validateRequest({ body: configureBranchTaxSchema }),
  administrationController.configureBranchTax
);

// Baseline seeder for branch
branchAdministrationRouter.post(
  '/baseline',
  requirePermission('admin:branches:manage', 'admin:all'),
  administrationController.seedBaseline
);

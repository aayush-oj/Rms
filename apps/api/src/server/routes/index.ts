import { Router, Request, Response } from 'express';
import { healthRouter } from './health';
import { menuUploadsRouter } from './menuUploads';
import { migrationRunner } from '../db/migrations';
import { ApiSuccessResponse } from '../shared/types';
import { authenticate, requirePermission } from '../modules/identity/middleware';
import { passwordResetRouter } from '../modules/identity/passwordReset';
import { platformAuthRouter } from '../modules/platformAdmin/router';
import { platformOrganizationsRouter } from '../modules/platformAdmin/organizationReadRouter';
import { platformActivationRequestsRouter } from '../modules/platformAdmin/activationRequestReadRouter';
import { platformAuditRouter } from '../modules/platformAdmin/platformAuditRouter';
import { staffPermissionsRouter } from '../modules/staffPermissions/router';
import { complimentaryOrderRouter } from '../modules/complimentary/router';
import { multiTableDiningRouter } from '../modules/multiTableDining/router';
import {
  authRouter, organizationsRouter, branchesRouter, usersRouter, rolesRouter,
  floorsRouter, sectionsRouter, tablesRouter, printersRouter, stationsRouter,
  paymentMethodsRouter, unitsRouter, operationalSettingsRouter,
  branchAdministrationRouter, menuCategoriesRouter, menuItemsRouter, tableAllocationsRouter,
  ordersRouter, kitchenRouter, billingRouter, menuCustomizationRouter, tableOperationsRouter,
  managementRouter, shiftRouter, expenseRouter, stockRouter,
  reportsRouter, alertsRouter, alertSettingsRouter, activityLogRouter, receiptSettingsRouter,
} from '../modules';

export const apiV1Router = Router();
apiV1Router.use('/', healthRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/auth', passwordResetRouter);
apiV1Router.use('/platform/auth', platformAuthRouter);
apiV1Router.use('/platform/organizations', platformOrganizationsRouter);
apiV1Router.use('/platform/activation-requests', platformActivationRequestsRouter);
apiV1Router.use('/platform/audit-logs', platformAuditRouter);
apiV1Router.use('/organizations', organizationsRouter);
apiV1Router.use('/branches', branchesRouter);
apiV1Router.use('/users', usersRouter);
apiV1Router.use('/roles', rolesRouter);
apiV1Router.use('/staff-permissions', staffPermissionsRouter);
apiV1Router.use('/branches/:branchId', branchAdministrationRouter);
apiV1Router.use('/floors', floorsRouter);
apiV1Router.use('/sections', sectionsRouter);
apiV1Router.use('/tables', tablesRouter);
apiV1Router.use('/printers', printersRouter);
apiV1Router.use('/stations', stationsRouter);
apiV1Router.use('/payment-methods', paymentMethodsRouter);
apiV1Router.use('/units', unitsRouter);
apiV1Router.use('/operational-settings', operationalSettingsRouter);
apiV1Router.use('/receipts', receiptSettingsRouter);
apiV1Router.use('/menu/categories', menuCategoriesRouter);
apiV1Router.use('/menu/items', menuItemsRouter);
apiV1Router.use('/menu/uploads', menuUploadsRouter);
apiV1Router.use('/menu', menuCustomizationRouter);
apiV1Router.use('/table-allocations', tableAllocationsRouter);
apiV1Router.use('/table-operations', tableOperationsRouter);
apiV1Router.use('/dining-sessions', multiTableDiningRouter);
apiV1Router.use('/complimentary-orders', complimentaryOrderRouter);
apiV1Router.use('/orders', ordersRouter);
apiV1Router.use('/kitchen', kitchenRouter);
apiV1Router.use('/billing', billingRouter);
apiV1Router.use('/management', managementRouter);
apiV1Router.use('/shift-ops', shiftRouter);
apiV1Router.use('/inventory', stockRouter);
// Purchasing, recipes, and the legacy unit/location inventory API remain
// dormant. Historical tables/code are preserved without exposing those heavy
// workflows in the active restaurant product.
apiV1Router.use('/expenses', expenseRouter);
apiV1Router.use('/reports', reportsRouter);
apiV1Router.use('/alerts', alertsRouter);
apiV1Router.use('/alert-settings', alertSettingsRouter);
apiV1Router.use('/activity-logs', activityLogRouter);

apiV1Router.get(
  '/system/migrations/status',
  authenticate(),
  requirePermission('admin:system:status'),
  async (_req: Request, res: Response) => {
    const status = await migrationRunner.getMigrationStatus();
    const response: ApiSuccessResponse = { success: true, data: status };
    res.status(200).json(response);
  }
);

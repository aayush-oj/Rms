import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { managementController } from './controller';
import { createCustomerSchema, createDepartmentSchema, createMembershipSchema, createCustomRoleSchema, accessAssignmentSchema, updateCustomerSchema, updateDepartmentSchema, updateMembershipSchema, updateRolePermissionsSchema, membershipUsageSchema, menuItemDepartmentAssignmentSchema, tableWaiterAssignmentSchema } from './validation';

export const managementRouter = Router();
managementRouter.use(authenticate());

managementRouter.get('/departments', managementController.listDepartments);
managementRouter.post('/departments', requirePermission('admin:departments:manage'), validateRequest({ body: createDepartmentSchema }), managementController.createDepartment);
managementRouter.patch('/departments/:id', requirePermission('admin:departments:manage'), validateRequest({ body: updateDepartmentSchema }), managementController.updateDepartment);
managementRouter.patch('/menu-items/:id/department', requirePermission('admin:menus:manage', 'admin:departments:manage'), validateRequest({ body: menuItemDepartmentAssignmentSchema }), managementController.setMenuItemDepartment);

managementRouter.get('/customers', requirePermission('admin:customers:manage', 'pos:orders:view', 'pos:orders:create'), managementController.listCustomers);
managementRouter.post('/customers', requirePermission('admin:customers:manage'), validateRequest({ body: createCustomerSchema }), managementController.createCustomer);
managementRouter.patch('/customers/:id', requirePermission('admin:customers:manage'), validateRequest({ body: updateCustomerSchema }), managementController.updateCustomer);
managementRouter.get('/customers/:id/orders', requirePermission('admin:customers:manage', 'pos:orders:view'), managementController.customerOrders);
managementRouter.get('/customers/:id/memberships', requirePermission('admin:customers:manage', 'pos:orders:view', 'pos:orders:create'), managementController.customerMemberships);

managementRouter.get('/memberships', requirePermission('admin:customers:manage'), managementController.listMemberships);
managementRouter.post('/memberships', requirePermission('admin:customers:manage'), validateRequest({ body: createMembershipSchema }), managementController.createMembership);
managementRouter.patch('/memberships/:id', requirePermission('admin:customers:manage'), validateRequest({ body: updateMembershipSchema }), managementController.updateMembership);
managementRouter.get('/memberships/:id/usage', requirePermission('admin:customers:manage'), managementController.listMembershipUsage);
managementRouter.post('/memberships/:id/usage', requirePermission('admin:customers:manage'), validateRequest({ body: membershipUsageSchema }), managementController.recordMembershipUsage);

managementRouter.get('/staff/:userId/access', requirePermission('admin:access:manage', 'admin:users:manage'), managementController.getAccess);
managementRouter.put('/staff/:userId/access', requirePermission('admin:access:manage', 'admin:users:manage'), validateRequest({ body: accessAssignmentSchema }), managementController.setAccess);
managementRouter.patch('/tables/:tableId/waiter', requirePermission('admin:access:manage', 'admin:tables:manage', 'pos:tables:allocate'), validateRequest({ body: tableWaiterAssignmentSchema }), managementController.assignTableWaiter);

managementRouter.post('/roles', requirePermission('admin:roles:manage'), validateRequest({ body: createCustomRoleSchema }), managementController.createRole);
managementRouter.put('/roles/:roleId/permissions', requirePermission('admin:roles:manage'), validateRequest({ body: updateRolePermissionsSchema }), managementController.setRolePermissions);

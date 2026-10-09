import { Router, Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { reportsController } from './controller';
import { reportFiltersSchema, transactionHistoryFiltersSchema } from './validation';
import { fnbFiltersSchema } from './fnbValidation';
import { getDatabasePool } from '../../db/pool';
import { ForbiddenError } from '../../shared/errors';
import { z } from 'zod';

export const reportsRouter = Router();
reportsRouter.use(authenticate());
const q = validateRequest({query: reportFiltersSchema});
reportsRouter.get('/dashboard', requirePermission('reports.dashboard.view','reports:view'), q, reportsController.dashboard);
reportsRouter.get('/sales', requirePermission('reports.sales.view','reports:view'), q, reportsController.sales);
reportsRouter.get('/financial', requirePermission('reports.sales.view','reports.payment.view','reports:view'), q, reportsController.financial);
reportsRouter.get('/fnb', requirePermission('reports.fnb.view'), validateRequest({query:fnbFiltersSchema}), reportsController.fnb);
reportsRouter.get('/fnb/options', requirePermission('reports.fnb.view'), q, reportsController.fnbOptions);
reportsRouter.get('/departments', requirePermission('reports.department.view'), q, reportsController.departments);
reportsRouter.get('/staff', requirePermission('reports.staff.view'), q, reportsController.staff);
reportsRouter.get('/occupancy', requirePermission('reports.occupancy.view'), q, reportsController.occupancy);
reportsRouter.get('/occupancy/options', requirePermission('reports.occupancy.view'), q, reportsController.occupancyOptions);
reportsRouter.get('/payments', requirePermission('reports.payment.view'), q, reportsController.payments);
reportsRouter.get('/transactions', requirePermission('reports.payment.view'), validateRequest({query:transactionHistoryFiltersSchema}), reportsController.transactions);
reportsRouter.get('/transactions/:billId', requirePermission('reports.payment.view'), validateRequest({params:z.object({billId:z.coerce.number().int().positive()})}), reportsController.transactionDetail);
reportsRouter.get('/tax', requirePermission('reports.tax.view'), q, reportsController.tax);
reportsRouter.get('/shifts', requirePermission('reports.shift.view','shift:view'), q, reportsController.shifts);
// Inventory and purchasing reporting are intentionally not mounted in the active product.
// The historical repository/controller implementations remain dormant for compatibility.
reportsRouter.get('/expenses', requirePermission('reports.expense.view','expenses:view'), q, reportsController.expenses);
reportsRouter.get('/controls', requirePermission('reports.sales.view','reports:view'), q, reportsController.controls);
reportsRouter.get('/branches', requirePermission('reports.branch.view','reports:view'), q, reportsController.branches);
reportsRouter.get('/complimentary', requirePermission('reports:view'), q, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.organizationId || !req.user.activeBranchId) throw new ForbiddenError('Active tenant and branch context are required', 'MISSING_TENANT_CONTEXT');
    const params = req.query as { from?: string; to?: string };
    const where = ['o.organization_id = ?', 'o.branch_id = ?', 'oi.is_complimentary = TRUE'];
    const values: Array<number | string> = [req.user.organizationId, req.user.activeBranchId];
    if (params.from) { where.push('DATE(o.created_at) >= ?'); values.push(params.from); }
    if (params.to) { where.push('DATE(o.created_at) <= ?'); values.push(params.to); }
    const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT oi.id AS order_item_id,
              DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS date_time,
              o.order_number,
              b.bill_number,
              dt.table_number,
              oi.item_name_snapshot AS item,
              oi.quantity,
              oi.original_unit_price,
              ROUND(oi.original_unit_price * oi.quantity, 2) AS complimentary_value,
              oi.complimentary_reason AS reason,
              waiter.name AS waiter,
              comped.name AS complimentary_by,
              o.order_status
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN bills b ON b.order_id = o.id AND b.organization_id = o.organization_id AND b.branch_id = o.branch_id AND b.status <> 'CANCELLED'
         LEFT JOIN dining_tables dt ON dt.id = o.dining_table_id AND dt.organization_id = o.organization_id
         LEFT JOIN users waiter ON waiter.id = o.waiter_id AND waiter.organization_id = o.organization_id
         LEFT JOIN users comped ON comped.id = oi.complimentary_by AND comped.organization_id = o.organization_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.created_at DESC, oi.id DESC`,
      values
    );
    const totalValue = rows.reduce((sum, row) => sum + Number(row.complimentary_value || 0), 0);
    const totalQuantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    res.json({
      success: true,
      data: {
        summary: { complimentaryLines: rows.length, complimentaryQuantity: totalQuantity, complimentaryValue: totalValue },
        rows: rows.map((row) => ({
          orderItemId: Number(row.order_item_id), dateTime: String(row.date_time), orderNumber: String(row.order_number),
          billNumber: row.bill_number == null ? null : String(row.bill_number), tableNumber: row.table_number == null ? null : String(row.table_number),
          item: String(row.item), quantity: Number(row.quantity), originalUnitPrice: Number(row.original_unit_price), complimentaryValue: Number(row.complimentary_value),
          reason: row.reason == null ? null : String(row.reason), waiter: row.waiter == null ? null : String(row.waiter),
          complimentaryBy: row.complimentary_by == null ? null : String(row.complimentary_by), orderStatus: String(row.order_status),
        })),
      },
    });
  } catch (error) { next(error); }
});

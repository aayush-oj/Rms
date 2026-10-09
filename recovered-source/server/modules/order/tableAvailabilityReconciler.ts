import { NextFunction, Request, Response } from 'express';
import { isDatabaseAvailable } from '../../db/pool';
import { reconcileTableOccupancy } from '../tableOperations/occupancy';

/**
 * Operational occupancy is derived from active dine-in orders. The persisted
 * dining_tables.status field is a fast projection and can be left as occupied
 * after an interrupted/legacy workflow. Reconcile that projection before a new
 * dine-in order reaches the transactional occupancy lock.
 *
 * The shared reconciler preserves intentional RESERVED/CLEANING/DISABLED states.
 */
export async function reconcileRequestedDineInTable(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.body?.orderType !== 'DINE_IN') return next();

    const tableId = Number(req.body?.diningTableId);
    const organizationId = Number(req.user?.organizationId);
    const branchId = Number(req.user?.activeBranchId);
    if (!Number.isInteger(tableId) || tableId <= 0 || !organizationId || !branchId) return next();
    if (!(await isDatabaseAvailable())) return next();

    await reconcileTableOccupancy(organizationId, branchId, tableId);
    next();
  } catch (error) {
    next(error);
  }
}

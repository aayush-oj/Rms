import { administrationRepository } from '../administration/repository';
import { reconcileTableOccupancyInTransaction } from './occupancy';

let boundaryApplied = false;

/**
 * Keep legacy order repositories on the authoritative table reconciliation rule without
 * rewriting their public API. This specifically replaces the older release helper that
 * treated MERGED orders as active by using a broad NOT IN terminal-state check.
 */
export function applyOperationalTableReconciliationBoundary(): void {
  if (boundaryApplied) return;

  administrationRepository.releaseTableIfUnoccupied = async (
    conn,
    tableId,
    organizationId,
    branchId
  ) => {
    await reconcileTableOccupancyInTransaction(conn, organizationId, branchId, tableId);
  };

  boundaryApplied = true;
}

export function operationalTableReconciliationBoundaryApplied(): boolean {
  return boundaryApplied;
}

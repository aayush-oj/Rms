import { Request, Response, NextFunction } from 'express';
import { identityRepository } from '../identity/repository';
import { ForbiddenError } from '../../shared/errors';
import { ApiSuccessResponse } from '../../shared/types';
import { tableOperationsRepository } from './repository';
import { realtimePublisher } from '../../realtime/publisher';
import { appendDomainAudit } from '../domainAudit/service';
import { reconcileTableOccupancy } from './occupancy';

function context(req: Request) {
  if (!req.user?.organizationId) throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
  if (!req.user.activeBranchId) throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
  return { organizationId: req.user.organizationId, branchId: req.user.activeBranchId, userId: req.user.id, permissions: req.user.permissions };
}

async function ensureBranchAccess(req: Request, branchId: number) {
  if (!req.user) throw new ForbiddenError('Authentication required', 'AUTH_REQUIRED');
  const branch = await identityRepository.findBranchById(req.user.organizationId, branchId);
  if (!branch) throw new ForbiddenError('Unauthorized branch access', 'UNAUTHORIZED_BRANCH_ACCESS');
  if (req.user.role === 'OWNER' || req.user.permissions.includes('admin:all') || req.user.permissions.includes('admin:branches:manage')) return;
  if (!req.user.allowedBranchIds.includes(branchId)) throw new ForbiddenError('Unauthorized branch access', 'UNAUTHORIZED_BRANCH_ACCESS');
}

async function publishReconciledTable(
  organizationId: number,
  branchId: number,
  tableId: number,
  data: Record<string, unknown>
) {
  const status = await reconcileTableOccupancy(organizationId, branchId, tableId);
  realtimePublisher.publish({
    type: 'table.status_changed',
    organizationId,
    branchId,
    entityType: 'table',
    entityId: tableId,
    data: { ...data, status: status.toUpperCase() },
  });
}

export class TableOperationsController {
  overview = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      await ensureBranchAccess(req, c.branchId);
      res.json({ success: true, data: await tableOperationsRepository.listTableSessions(c.organizationId, c.branchId, c.userId, c.permissions) } satisfies ApiSuccessResponse<any>);
    } catch (e) { next(e); }
  };

  transfer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      await ensureBranchAccess(req, c.branchId);
      const result = await tableOperationsRepository.transfer(c.organizationId, c.branchId, c.userId, c.permissions, req.body);
      realtimePublisher.publish({
        type: 'order.transferred',
        organizationId: c.organizationId,
        branchId: c.branchId,
        entityType: 'order',
        entityId: result.order.id,
        data: { fromTableId: result.sourceTableId, toTableId: result.destinationTableId, diningTableId: result.destinationTableId },
      });
      await publishReconciledTable(c.organizationId, c.branchId, result.sourceTableId, {
        orderId: result.order.id,
        fromTableId: result.sourceTableId,
        toTableId: result.destinationTableId,
      });
      await publishReconciledTable(c.organizationId, c.branchId, result.destinationTableId, {
        orderId: result.order.id,
        fromTableId: result.sourceTableId,
        toTableId: result.destinationTableId,
      });
      appendDomainAudit(req, {
        action: 'TABLE_ORDER_TRANSFERRED',
        entityType: 'order',
        entityId: result.order.id,
        after: { diningTableId: result.destinationTableId, orderStatus: result.order.order_status ?? result.order.orderStatus ?? null },
        metadata: { sourceTableId: result.sourceTableId, destinationTableId: result.destinationTableId, operationEventId: result.eventId },
      });
      res.json({ success: true, data: result } satisfies ApiSuccessResponse<any>);
    } catch (e) { next(e); }
  };

  swap = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      await ensureBranchAccess(req, c.branchId);
      const result = await tableOperationsRepository.swap(c.organizationId, c.branchId, c.userId, c.permissions, req.body);
      await publishReconciledTable(c.organizationId, c.branchId, Number(req.body.sourceTableId), { operationType: 'SWAP', result });
      await publishReconciledTable(c.organizationId, c.branchId, Number(req.body.destinationTableId), { operationType: 'SWAP', result });
      appendDomainAudit(req, {
        action: 'TABLE_ORDERS_SWAPPED',
        entityType: 'table',
        entityId: Number(req.body.sourceTableId),
        relatedEntityType: 'table',
        relatedEntityId: Number(req.body.destinationTableId),
        metadata: {
          sourceTableId: Number(req.body.sourceTableId),
          destinationTableId: Number(req.body.destinationTableId),
          sourceOrderId: result.order?.id ?? null,
          destinationOrderId: result.relatedOrder?.id ?? null,
          operationEventId: result.eventId,
        },
      });
      res.json({ success: true, data: result } satisfies ApiSuccessResponse<any>);
    } catch (e) { next(e); }
  };

  merge = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      await ensureBranchAccess(req, c.branchId);
      const result = await tableOperationsRepository.merge(c.organizationId, c.branchId, c.userId, c.permissions, req.body);
      realtimePublisher.publish({
        type: 'order.merged',
        organizationId: c.organizationId,
        branchId: c.branchId,
        entityType: 'order',
        entityId: result.order.id,
        data: {
          sourceOrderId: result.relatedOrder?.id ?? null,
          destinationOrderId: result.order.id,
          destinationTableId: result.destinationTableId,
          diningTableId: result.destinationTableId,
        },
      });
      await publishReconciledTable(c.organizationId, c.branchId, result.sourceTableId, {
        sourceOrderId: result.relatedOrder?.id ?? null,
        destinationOrderId: result.order.id,
        operationType: 'MERGE',
      });
      await publishReconciledTable(c.organizationId, c.branchId, result.destinationTableId, {
        sourceOrderId: result.relatedOrder?.id ?? null,
        destinationOrderId: result.order.id,
        operationType: 'MERGE',
      });
      appendDomainAudit(req, {
        action: 'ORDERS_MERGED',
        entityType: 'order',
        entityId: result.order.id,
        relatedEntityType: 'order',
        relatedEntityId: result.relatedOrder?.id ?? null,
        after: { destinationTableId: result.destinationTableId },
        metadata: {
          sourceTableId: result.sourceTableId,
          destinationTableId: result.destinationTableId,
          sourceOrderId: result.relatedOrder?.id ?? null,
          destinationOrderId: result.order.id,
          operationEventId: result.eventId,
        },
      });
      res.json({ success: true, data: result } satisfies ApiSuccessResponse<any>);
    } catch (e) { next(e); }
  };
}

export const tableOperationsController = new TableOperationsController();

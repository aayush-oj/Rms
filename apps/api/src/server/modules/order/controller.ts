import { Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { orderRepository } from './repository';
import { orderService } from './service';
import { identityRepository } from '../identity/repository';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { CreateOrderInput, OrderStatus } from './types';
import { managementRepository } from '../management/repository';
import { realtimePublisher } from '../../realtime/publisher';
import { kitchenRepository } from '../kitchen/repository';
import { appendDomainAudit } from '../domainAudit/service';
import { reconcileTableOccupancy } from '../tableOperations/occupancy';
import { getDatabasePool } from '../../db/pool';
import crypto from 'crypto';

export class OrderController {
  private getOrgId(req: Request): number {
    if (!req.user || !req.user.organizationId) {
      throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
    }
    return req.user.organizationId;
  }

  private getBranchId(req: Request): number {
    if (!req.user || !req.user.activeBranchId) {
      throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
    }
    return req.user.activeBranchId;
  }

  private async ensureBranchAccess(req: Request, branchId: number): Promise<void> {
    if (!req.user) throw new ForbiddenError('Authentication required', 'AUTH_REQUIRED');
    const branch = await identityRepository.findBranchById(req.user.organizationId, branchId);
    if (!branch) throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    const { SYSTEM_ROLES } = await import('../identity/types');
    if (
      req.user.role === SYSTEM_ROLES.OWNER ||
      req.user.permissions.includes('admin:all') ||
      req.user.permissions.includes('admin:branches:manage')
    ) return;
    if (!req.user.allowedBranchIds.includes(branchId)) {
      throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    }
  }

  private async orderTableIds(organizationId: number, branchId: number, orderId: number, activeOnly = false): Promise<number[]> {
    const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT DISTINCT dining_table_id FROM order_tables
        WHERE organization_id=? AND branch_id=? AND order_id=?${activeOnly ? ' AND released_at IS NULL' : ''}
        ORDER BY dining_table_id`,
      [organizationId, branchId, orderId],
    );
    return rows.map((row) => Number(row.dining_table_id));
  }

  private async ensureOrderScope(req: Request, order: { id?: number; diningTableId?: number | null }): Promise<void> {
    if (order.diningTableId == null) return;
    const privileged = req.user!.role === 'OWNER' || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:tables:manage') || req.user!.permissions.includes('admin:access:manage');
    if (privileged) return;

    const tableIds = order.id == null
      ? [Number(order.diningTableId)]
      : [...new Set([Number(order.diningTableId), ...(await this.orderTableIds(req.user!.organizationId, req.user!.activeBranchId, order.id))])];
    for (const tableId of tableIds) {
      if (await managementRepository.canAccessTable(req.user!.organizationId, req.user!.id, req.user!.activeBranchId, tableId, req.user!.permissions)) return;
    }
    throw new ForbiddenError('You do not have access to this table order', 'TABLE_ACCESS_FORBIDDEN');
  }

  private async reconcileAndPublishTableStatus(
    organizationId: number,
    branchId: number,
    tableId: number,
    orderId: number
  ): Promise<void> {
    const status = await reconcileTableOccupancy(organizationId, branchId, tableId);
    realtimePublisher.publish({
      type: 'table.status_changed',
      organizationId,
      branchId,
      entityType: 'table',
      entityId: tableId,
      data: { orderId, diningTableId: tableId, status: status.toUpperCase() },
    });
  }

  createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);

      const input: CreateOrderInput = req.body;
      const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim() : '';
      if (headerKey && (headerKey.length < 8 || headerKey.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(headerKey))) {
        throw new BadRequestError('Idempotency-Key must be 8-120 URL-safe characters', 'INVALID_IDEMPOTENCY_KEY');
      }
      const idempotency = headerKey ? { key: headerKey, hash: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex') } : undefined;
      const result = await orderService.createOrder(orgId, branchId, req.user!.id, input, req.user!.permissions, idempotency);
      const order = result.order;
      if (!result.replayed) {
        const tableIds = order.orderType === 'DINE_IN'
          ? [...new Set([order.diningTableId, ...(input.diningTableIds ?? [])].filter((value): value is number => value != null).map(Number))]
          : [];
        realtimePublisher.publish({
          type: 'order.created', organizationId: orgId, branchId, entityType: 'order', entityId: order.id,
          data: { orderNumber: order.orderNumber, orderStatus: order.orderStatus, diningTableId: order.diningTableId, diningTableIds: tableIds, orderType: order.orderType, grandTotal: order.grandTotal },
        });
        for (const tableId of tableIds) await this.reconcileAndPublishTableStatus(orgId, branchId, tableId, order.id);
        const tickets = await kitchenRepository.findTicketsByOrder(order.id, orgId, branchId);
        tickets.forEach(ticket => realtimePublisher.publish({ type: 'kot.created', organizationId: orgId, branchId, entityType: 'kot', entityId: ticket.id, data: { orderId: order.id, ticketStatus: ticket.ticketStatus, orderNumber: order.orderNumber, diningTableId: order.diningTableId } }));
        tickets.forEach(ticket => realtimePublisher.publish({ type: 'kds.ticket.created', organizationId: orgId, branchId, entityType: 'kds_ticket', entityId: ticket.id, data: { orderId: order.id, ticketStatus: ticket.ticketStatus, diningTableId: order.diningTableId } }));
        realtimePublisher.publish({ type: 'inventory.stock_changed', organizationId: orgId, branchId, entityType: 'inventory_balance', entityId: order.id, data: { source: 'ORDER_SENT', orderId: order.id } });
      }

      const response: ApiSuccessResponse = { success: true, data: order };
      res.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
      res.status(result.replayed ? 200 : 201).json(response);
    } catch (err) { next(err); }
  };

  listOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const params: any = { ...(req.query as any) };
      const privileged = req.user!.role === 'OWNER' || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:tables:manage') || req.user!.permissions.includes('admin:access:manage');
      if (!privileged) params.accessibleTableIds = await managementRepository.accessibleTableIds(orgId, req.user!.id, branchId, req.user!.permissions);
      const result = await orderRepository.list(orgId, branchId, params);
      res.status(200).json({ success: true, data: result.orders, meta: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages } } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };

  getOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req); const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const orderId = parseInt(req.params.id, 10);
      if (isNaN(orderId)) throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
      const order = await orderRepository.findById(orderId, orgId, branchId);
      if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      await this.ensureOrderScope(req, order);
      res.status(200).json({ success: true, data: order } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };

  updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req); const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const orderId = parseInt(req.params.id, 10);
      if (isNaN(orderId)) throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
      const { orderStatus } = req.body as { orderStatus: OrderStatus };
      if (orderStatus === 'SERVED' && !req.user!.permissions.includes('pos:orders:serve') && !req.user!.permissions.includes('admin:all')) throw new ForbiddenError('You do not have permission to serve orders', 'FORBIDDEN_ORDER_SERVE');
      if (orderStatus === 'COMPLETED' && !req.user!.permissions.includes('pos:orders:complete') && !req.user!.permissions.includes('admin:all')) throw new ForbiddenError('You do not have permission to complete orders', 'FORBIDDEN_ORDER_COMPLETE');
      const currentOrder = await orderRepository.findById(orderId, orgId, branchId);
      if (!currentOrder) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      await this.ensureOrderScope(req, currentOrder);
      const activeTableIds = orderStatus === 'COMPLETED' ? await this.orderTableIds(orgId, branchId, orderId, true) : [];
      orderService.validateStatusTransition(currentOrder.orderStatus, orderStatus);
      const updatedOrder = await orderRepository.updateStatus(orderId, orgId, branchId, orderStatus, req.user!.id);
      realtimePublisher.publish({ type: 'order.status_changed', organizationId: orgId, branchId, entityType: 'order', entityId: updatedOrder.id, data: { orderStatus: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId } });
      if (updatedOrder.orderStatus === 'COMPLETED') {
        for (const tableId of activeTableIds.length ? activeTableIds : (updatedOrder.diningTableId != null ? [updatedOrder.diningTableId] : [])) {
          await this.reconcileAndPublishTableStatus(orgId, branchId, tableId, updatedOrder.id);
        }
      }
      res.status(200).json({ success: true, data: updatedOrder } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };

  serveOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req); const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const orderId = parseInt(req.params.id, 10);
      if (isNaN(orderId)) throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
      const order = await orderRepository.findById(orderId, orgId, branchId);
      if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      await this.ensureOrderScope(req, order);
      orderService.validateStatusTransition(order.orderStatus, 'SERVED');
      if (order.orderType !== 'DINE_IN') throw new BadRequestError('Only dine-in orders require a served action', 'ORDER_NOT_SERVABLE');
      const updatedOrder = await orderService.serveOrder(orderId, orgId, branchId, req.user!.id);
      realtimePublisher.publish({ type: 'order.served', organizationId: orgId, branchId, entityType: 'order', entityId: updatedOrder.id, data: { orderStatus: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId, servedAt: updatedOrder.servedAt } });
      realtimePublisher.publish({ type: 'service.status_changed', organizationId: orgId, branchId, entityType: 'order', entityId: updatedOrder.id, data: { status: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId } });
      res.status(200).json({ success: true, data: updatedOrder } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };

  completeOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req); const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const orderId = parseInt(req.params.id, 10);
      if (isNaN(orderId)) throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
      const order = await orderRepository.findById(orderId, orgId, branchId);
      if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      await this.ensureOrderScope(req, order);
      const activeTableIds = await this.orderTableIds(orgId, branchId, orderId, true);
      const updatedOrder = await orderService.completeOrder(orderId, orgId, branchId, req.user!.id);
      realtimePublisher.publish({ type: 'order.completed', organizationId: orgId, branchId, entityType: 'order', entityId: updatedOrder.id, data: { orderStatus: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId } });
      for (const tableId of activeTableIds.length ? activeTableIds : (updatedOrder.diningTableId != null ? [updatedOrder.diningTableId] : [])) {
        await this.reconcileAndPublishTableStatus(orgId, branchId, tableId, updatedOrder.id);
      }
      res.status(200).json({ success: true, data: updatedOrder } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };

  cancelOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req); const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const orderId = parseInt(req.params.id, 10);
      if (isNaN(orderId)) throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
      const { cancellationReason } = req.body as { cancellationReason?: string };
      const currentOrder = await orderRepository.findById(orderId, orgId, branchId);
      if (!currentOrder) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      await this.ensureOrderScope(req, currentOrder);
      const activeTableIds = await this.orderTableIds(orgId, branchId, orderId, true);
      const updatedOrder = await orderRepository.cancel(orderId, orgId, branchId, req.user!.id, cancellationReason);
      realtimePublisher.publish({ type: 'order.cancelled', organizationId: orgId, branchId, entityType: 'order', entityId: updatedOrder.id, data: { orderStatus: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId, cancellationReason: updatedOrder.cancellationReason } });
      for (const tableId of activeTableIds.length ? activeTableIds : (updatedOrder.diningTableId != null ? [updatedOrder.diningTableId] : [])) {
        await this.reconcileAndPublishTableStatus(orgId, branchId, tableId, updatedOrder.id);
      }
      realtimePublisher.publish({ type: 'inventory.stock_changed', organizationId: orgId, branchId, entityType: 'inventory_balance', entityId: updatedOrder.id, data: { source: 'ORDER_CANCELLATION_REVERSAL', orderId: updatedOrder.id } });
      appendDomainAudit(req, {
        action: 'ORDER_CANCELLED', entityType: 'order', entityId: updatedOrder.id,
        before: { orderStatus: currentOrder.orderStatus, paymentStatus: currentOrder.paymentStatus, diningTableId: currentOrder.diningTableId, grandTotal: currentOrder.grandTotal },
        after: { orderStatus: updatedOrder.orderStatus, paymentStatus: updatedOrder.paymentStatus, diningTableId: updatedOrder.diningTableId },
        reason: updatedOrder.cancellationReason ?? cancellationReason ?? null,
      });
      res.status(200).json({ success: true, data: updatedOrder } satisfies ApiSuccessResponse);
    } catch (err) { next(err); }
  };
}

export const orderController = new OrderController();

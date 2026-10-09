import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { kitchenRepository } from './repository';
import {
  KotStatus,
  KotItemStatus,
  KitchenTicketWithItems,
  ListKitchenTicketsParams,
  KOT_VALID_TRANSITIONS,
  KOT_ITEM_VALID_TRANSITIONS,
} from './types';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import { getDatabasePool } from '../../db/pool';

export function deriveTicketStatusFromItemStatuses(currentStatus: KotStatus, itemStatuses: KotItemStatus[]): KotStatus {
  if (currentStatus === 'COMPLETED' || currentStatus === 'VOIDED') return currentStatus;
  const active = itemStatuses.filter((status) => status !== 'CANCELLED');
  if (!active.length) return currentStatus;
  if (active.every((status) => status === 'SERVED')) return 'COMPLETED';
  if (active.every((status) => status === 'READY' || status === 'SERVED')) return 'READY';
  if (currentStatus === 'NEW' && active.some((status) => status === 'PREPARING' || status === 'READY' || status === 'SERVED')) return 'PREPARING';
  return currentStatus;
}

export class KitchenService {
  async listTickets(organizationId: number, branchId: number, params: ListKitchenTicketsParams): Promise<KitchenTicketWithItems[]> {
    return kitchenRepository.list(organizationId, branchId, params);
  }

  async getTicket(id: number, organizationId: number, branchId?: number): Promise<KitchenTicketWithItems | null> {
    return kitchenRepository.findById(id, organizationId, branchId);
  }

  validateTicketTransition(currentStatus: KotStatus, newStatus: KotStatus): void {
    const allowed = KOT_VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) throw new BadRequestError(`Cannot transition kitchen ticket from ${currentStatus} to ${newStatus}`, 'INVALID_KOT_STATUS_TRANSITION', { currentStatus, newStatus, allowedTransitions: allowed ?? [] });
  }

  validateItemTransition(currentStatus: KotItemStatus, newStatus: KotItemStatus): void {
    const allowed = KOT_ITEM_VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) throw new BadRequestError(`Cannot transition kitchen ticket item from ${currentStatus} to ${newStatus}`, 'INVALID_KOT_ITEM_STATUS_TRANSITION', { currentStatus, newStatus, allowedTransitions: allowed ?? [] });
  }

  private async rollUpItemStatuses(conn: PoolConnection, ticketId: number, orderId: number, organizationId: number, branchId: number, currentTicketStatus: KotStatus): Promise<KotStatus> {
    const [itemRows] = await conn.execute<RowDataPacket[]>('SELECT item_status FROM kitchen_ticket_items WHERE kitchen_ticket_id = ? ORDER BY id FOR UPDATE', [ticketId]);
    const itemStatuses = itemRows.map((row) => String(row.item_status) as KotItemStatus);
    const nextTicketStatus = deriveTicketStatusFromItemStatuses(currentTicketStatus, itemStatuses);
    if (nextTicketStatus !== currentTicketStatus) {
      await conn.execute(`UPDATE kitchen_tickets SET ticket_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`, [nextTicketStatus, ticketId, organizationId, branchId]);
    }
    await kitchenRepository.syncOrderStatusFromKot(conn, orderId, organizationId, branchId);
    return nextTicketStatus;
  }

  async updateTicketStatus(id: number, organizationId: number, branchId: number, newStatus: KotStatus, userId: number): Promise<KitchenTicketWithItems> {
    const conn = await getDatabasePool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(`SELECT id, order_id, ticket_status FROM kitchen_tickets WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE`, [id, organizationId, branchId]);
      if (!rows.length) throw new NotFoundError('Kitchen ticket not found', 'KITCHEN_TICKET_NOT_FOUND');
      this.validateTicketTransition(String(rows[0].ticket_status) as KotStatus, newStatus);
      if (newStatus === 'VOIDED') {
        await conn.execute(`UPDATE kitchen_tickets SET ticket_status = 'VOIDED', voided_at = COALESCE(voided_at, NOW()), voided_by = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`, [userId, id, organizationId, branchId]);
        await conn.execute(`UPDATE kitchen_ticket_items SET item_status = 'CANCELLED', updated_at = NOW() WHERE kitchen_ticket_id = ? AND item_status IN ('PENDING', 'PREPARING')`, [id]);
      } else {
        await conn.execute(`UPDATE kitchen_tickets SET ticket_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`, [newStatus, id, organizationId, branchId]);
        if (newStatus === 'PREPARING') await conn.execute(`UPDATE kitchen_ticket_items SET item_status = 'PREPARING', updated_at = NOW() WHERE kitchen_ticket_id = ? AND item_status = 'PENDING'`, [id]);
        if (newStatus === 'READY') await conn.execute(`UPDATE kitchen_ticket_items SET item_status = 'READY', updated_at = NOW() WHERE kitchen_ticket_id = ? AND item_status IN ('PENDING', 'PREPARING')`, [id]);
      }
      await kitchenRepository.syncOrderStatusFromKot(conn, Number(rows[0].order_id), organizationId, branchId);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    const updated = await kitchenRepository.findById(id, organizationId, branchId);
    if (!updated) throw new NotFoundError('Kitchen ticket not found after update', 'KITCHEN_TICKET_NOT_FOUND');
    return updated;
  }

  async updateTicketItemStatus(itemId: number, organizationId: number, branchId: number, newStatus: KotItemStatus, userId: number) {
    if (newStatus === 'SERVED') throw new BadRequestError('Use the service endpoint to mark ready food served', 'SERVICE_ENDPOINT_REQUIRED');
    const conn = await getDatabasePool().getConnection();
    let ticketId: number;
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(`SELECT kti.kitchen_ticket_id, kti.item_status, kt.order_id, kt.ticket_status FROM kitchen_ticket_items kti JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id WHERE kti.id = ? AND kt.organization_id = ? AND kt.branch_id = ? FOR UPDATE`, [itemId, organizationId, branchId]);
      if (!rows.length) throw new NotFoundError('Kitchen ticket item not found', 'KITCHEN_TICKET_ITEM_NOT_FOUND');
      ticketId = Number(rows[0].kitchen_ticket_id);
      this.validateItemTransition(String(rows[0].item_status) as KotItemStatus, newStatus);
      await conn.execute('UPDATE kitchen_ticket_items SET item_status = ?, updated_at = NOW() WHERE id = ?', [newStatus, itemId]);
      await this.rollUpItemStatuses(conn, ticketId, Number(rows[0].order_id), organizationId, branchId, String(rows[0].ticket_status) as KotStatus);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    const ticket = await kitchenRepository.findById(ticketId!, organizationId, branchId);
    const updated = ticket?.items.find((item) => item.id === itemId);
    if (!updated) throw new NotFoundError('Kitchen ticket item not found after update', 'KITCHEN_TICKET_ITEM_NOT_FOUND');
    return updated;
  }

  async serveReadyItem(itemId: number, organizationId: number, branchId: number, userId: number): Promise<{ itemId: number; orderId: number; ticketId: number; orderServed: boolean }> {
    const conn = await getDatabasePool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT kti.id, kti.item_status, kti.kitchen_ticket_id, kt.order_id, kt.ticket_status, o.order_type, o.order_status
         FROM kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
         JOIN orders o ON o.id = kt.order_id
         WHERE kti.id = ? AND kt.organization_id = ? AND kt.branch_id = ? AND o.organization_id = ? AND o.branch_id = ?
         FOR UPDATE`,
        [itemId, organizationId, branchId, organizationId, branchId]
      );
      if (!rows.length) throw new NotFoundError('Ready service item not found', 'SERVICE_ITEM_NOT_FOUND');
      const row = rows[0];
      if (String(row.order_type) !== 'DINE_IN') throw new BadRequestError('Takeaway items do not use table service', 'ORDER_NOT_SERVABLE');
      if (String(row.item_status) !== 'READY') throw new BadRequestError('Only ready food can be marked served', 'SERVICE_ITEM_NOT_READY');
      if (['CANCELLED', 'COMPLETED', 'MERGED'].includes(String(row.order_status))) throw new BadRequestError('This order is no longer serviceable', 'ORDER_NOT_SERVABLE');

      await conn.execute(`UPDATE kitchen_ticket_items SET item_status = 'SERVED', served_at = COALESCE(served_at, NOW()), served_by = ?, updated_at = NOW() WHERE id = ?`, [userId, itemId]);

      const ticketId = Number(row.kitchen_ticket_id);
      const orderId = Number(row.order_id);
      const [ticketItems] = await conn.execute<RowDataPacket[]>(`SELECT item_status FROM kitchen_ticket_items WHERE kitchen_ticket_id = ? FOR UPDATE`, [ticketId]);
      const ticketStatuses = ticketItems.map((item) => String(item.item_status) as KotItemStatus);
      const nextTicketStatus = deriveTicketStatusFromItemStatuses(String(row.ticket_status) as KotStatus, ticketStatuses);
      if (nextTicketStatus !== String(row.ticket_status)) {
        await conn.execute(`UPDATE kitchen_tickets SET ticket_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`, [nextTicketStatus, ticketId, organizationId, branchId]);
      }

      const [remainingRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS remaining
         FROM kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
         WHERE kt.order_id = ? AND kt.organization_id = ? AND kt.branch_id = ?
           AND kti.item_status NOT IN ('SERVED','CANCELLED')
         FOR UPDATE`,
        [orderId, organizationId, branchId]
      );
      const orderServed = Number(remainingRows[0]?.remaining || 0) === 0;
      if (orderServed) {
        await conn.execute(`UPDATE kitchen_tickets SET ticket_status = 'COMPLETED', updated_at = NOW() WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND ticket_status <> 'VOIDED'`, [orderId, organizationId, branchId]);
        await conn.execute(`UPDATE orders SET order_status = 'SERVED', served_at = COALESCE(served_at, NOW()), served_by = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`, [userId, orderId, organizationId, branchId]);
      } else {
        await kitchenRepository.syncOrderStatusFromKot(conn, orderId, organizationId, branchId);
      }
      await conn.commit();
      return { itemId, orderId, ticketId, orderServed };
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }
}

export const kitchenService = new KitchenService();

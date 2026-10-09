import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  KitchenTicket,
  KitchenTicketItem,
  KitchenTicketWithItems,
  KotStatus,
  KotItemStatus,
  ListKitchenTicketsParams,
} from './types';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { getDatabasePool } from '../../db/pool';

function mapKitchenTicketRow(row: RowDataPacket): KitchenTicket {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    orderId: Number(row.order_id),
    orderRoundId: Number(row.order_round_id),
    kotNumber: row.kot_number,
    orderNumber: row.order_number ?? '',
    ticketStatus: row.ticket_status,
    orderType: row.order_type,
    tableLabel: row.table_label,
    waiterName: row.waiter_name,
    voidedAt: row.voided_at instanceof Date ? row.voided_at.toISOString() : row.voided_at,
    voidedBy: row.voided_by != null ? Number(row.voided_by) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapKitchenTicketItemRow(row: RowDataPacket): KitchenTicketItem {
  return {
    id: Number(row.id),
    kitchenTicketId: Number(row.kitchen_ticket_id),
    sequenceNumber: Number(row.sequence_number),
    menuItemId: Number(row.menu_item_id),
    itemNameSnapshot: row.item_name_snapshot,
    variantNameSnapshot: row.variant_name_snapshot == null ? null : String(row.variant_name_snapshot),
    modifierSummary: row.modifier_summary == null ? null : String(row.modifier_summary),
    quantity: Number(row.quantity),
    notes: row.notes,
    prepStationId: row.prep_station_id != null ? Number(row.prep_station_id) : null,
    prepStationName: row.prep_station_name,
    prepTimeMinutesSnapshot: row.prep_time_minutes_snapshot == null ? null : Number(row.prep_time_minutes_snapshot),
    itemStatus: row.item_status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export class KitchenRepository {
  private pool() {
    return getDatabasePool();
  }

  /**
   * Generate a KOT number using the same transactional counter pattern as order numbers.
   * Must be called within an existing transaction connection.
   */
  async generateKotNumber(
    conn: PoolConnection,
    organizationId: number,
    branchId: number
  ): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const yyMMDD = today.toISOString().slice(2, 4) + today.toISOString().slice(5, 7) + today.toISOString().slice(8, 10);

    const [counterRows] = await conn.execute<RowDataPacket[]>(
      `SELECT next_seq FROM kot_number_counters
       WHERE organization_id = ? AND branch_id = ? AND counter_date = ?
       FOR UPDATE`,
      [organizationId, branchId, dateStr]
    );

    let seq: number;
    if (counterRows.length > 0) {
      seq = Number(counterRows[0].next_seq);
      await conn.execute(
        'UPDATE kot_number_counters SET next_seq = next_seq + 1, updated_at = NOW() WHERE organization_id = ? AND branch_id = ? AND counter_date = ?',
        [organizationId, branchId, dateStr]
      );
    } else {
      seq = 1;
      await conn.execute(
        `INSERT INTO kot_number_counters (organization_id, branch_id, counter_date, next_seq)
         VALUES (?, ?, ?, 2)`,
        [organizationId, branchId, dateStr]
      );
    }

    const paddedSeq = String(seq).padStart(4, '0');
    return `KOT${yyMMDD}-${paddedSeq}`;
  }

  /**
   * Create a kitchen ticket with items within an existing transaction.
   * Called by orderRepository.create() to ensure atomic KOT generation.
   */
  async createKotWithItems(
    conn: PoolConnection,
    organizationId: number,
    branchId: number,
    orderId: number,
    orderRoundId: number,
    orderNumber: string,
    orderType: string,
    tableLabel: string | null,
    waiterName: string | null,
    items: {
      menuItemId: number;
      itemNameSnapshot: string;
      variantNameSnapshot?: string | null;
      modifierSummary?: string | null;
      quantity: number;
      notes?: string;
      prepStationId: number | null;
      prepStationName: string | null;
      prepTimeMinutesSnapshot: number | null;
    }[]
  ): Promise<KitchenTicketWithItems> {
    const kotNumber = await this.generateKotNumber(conn, organizationId, branchId);

    const [ticketResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO kitchen_tickets
       (organization_id, branch_id, order_id, order_round_id, kot_number, ticket_status, order_type, table_label, waiter_name)
       VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`,
      [organizationId, branchId, orderId, orderRoundId, kotNumber, orderType, tableLabel, waiterName]
    );

    const ticketId = ticketResult.insertId;

    const ticketItems: KitchenTicketItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const [itemResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO kitchen_ticket_items
         (kitchen_ticket_id, sequence_number, menu_item_id, item_name_snapshot, variant_name_snapshot, modifier_summary, quantity, notes, prep_station_id, prep_station_name, prep_time_minutes_snapshot, item_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          ticketId,
          i + 1,
          item.menuItemId,
          item.itemNameSnapshot,
          item.variantNameSnapshot ?? null,
          item.modifierSummary ?? null,
          item.quantity,
          item.notes ?? null,
          item.prepStationId,
          item.prepStationName,
          item.prepTimeMinutesSnapshot,
        ]
      );

      ticketItems.push({
        id: itemResult.insertId,
        kitchenTicketId: ticketId,
        sequenceNumber: i + 1,
        menuItemId: item.menuItemId,
        itemNameSnapshot: item.itemNameSnapshot,
        variantNameSnapshot: item.variantNameSnapshot ?? null,
        modifierSummary: item.modifierSummary ?? null,
        quantity: item.quantity,
        notes: item.notes ?? null,
        prepStationId: item.prepStationId,
        prepStationName: item.prepStationName,
        prepTimeMinutesSnapshot: item.prepTimeMinutesSnapshot,
        itemStatus: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      id: ticketId,
      organizationId,
      branchId,
      orderId,
      orderRoundId,
      kotNumber,
      orderNumber,
      ticketStatus: 'NEW',
      orderType: orderType as any,
      tableLabel,
      waiterName,
      voidedAt: null,
      voidedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: ticketItems,
    };
  }

  /**
   * Void all active kitchen tickets for an order within an existing transaction.
   * Called by orderRepository.cancel() to ensure atomic cancellation.
   */
  async voidActiveTicketsForOrder(
    conn: PoolConnection,
    orderId: number,
    voidedBy: number
  ): Promise<void> {
    await conn.execute(
      `UPDATE kitchen_tickets
       SET ticket_status = 'VOIDED', voided_at = NOW(), voided_by = ?, updated_at = NOW()
       WHERE order_id = ? AND ticket_status IN ('NEW', 'PREPARING', 'READY')`,
      [voidedBy, orderId]
    );
  }

  async voidActiveTicketsForRound(
    conn: PoolConnection,
    orderId: number,
    orderRoundId: number,
    voidedBy: number,
  ): Promise<void> {
    await conn.execute(
      `UPDATE kitchen_tickets
          SET ticket_status = 'VOIDED', voided_at = NOW(), voided_by = ?, updated_at = NOW()
        WHERE order_id = ? AND order_round_id = ? AND ticket_status IN ('NEW', 'PREPARING', 'READY')`,
      [voidedBy, orderId, orderRoundId],
    );
    await conn.execute(
      `UPDATE kitchen_ticket_items kti
       JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
          SET kti.item_status = 'CANCELLED', kti.updated_at = NOW()
        WHERE kt.order_id = ? AND kt.order_round_id = ?
          AND kti.item_status IN ('PENDING', 'PREPARING', 'READY')`,
      [orderId, orderRoundId],
    );
  }

  async findById(id: number, organizationId: number, branchId?: number): Promise<KitchenTicketWithItems | null> {
    const conditions = 'kt.id = ? AND kt.organization_id = ?' + (branchId != null ? ' AND kt.branch_id = ?' : '');
    const params: any[] = branchId != null ? [id, organizationId, branchId] : [id, organizationId];
    const [ticketRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT kt.*, o.order_number FROM kitchen_tickets kt
       LEFT JOIN orders o ON o.id = kt.order_id
       WHERE ${conditions}`,
      params
    );

    if (ticketRows.length === 0) return null;

    const ticket = mapKitchenTicketRow(ticketRows[0]);

    const [itemRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM kitchen_ticket_items WHERE kitchen_ticket_id = ? ORDER BY sequence_number ASC',
      [id]
    );

    return {
      ...ticket,
      items: itemRows.map(mapKitchenTicketItemRow),
    };
  }

  async list(
    organizationId: number,
    branchId: number,
    params: ListKitchenTicketsParams
  ): Promise<KitchenTicketWithItems[]> {
    const conditions: string[] = ['kt.organization_id = ?', 'kt.branch_id = ?'];
    const bindValues: any[] = [organizationId, branchId];

    if (params.ticketStatus) {
      conditions.push('kt.ticket_status = ?');
      bindValues.push(params.ticketStatus);
    }
    if (params.stationId) {
      conditions.push('EXISTS (SELECT 1 FROM kitchen_ticket_items kti WHERE kti.kitchen_ticket_id = kt.id AND kti.prep_station_id = ?)');
      bindValues.push(params.stationId);
    }
    if (params.orderType) {
      conditions.push('kt.order_type = ?');
      bindValues.push(params.orderType);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [ticketRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT kt.*, o.order_number FROM kitchen_tickets kt
       LEFT JOIN orders o ON o.id = kt.order_id
       ${whereClause} ORDER BY kt.created_at ASC`,
      bindValues
    );

    const tickets: KitchenTicketWithItems[] = [];
    for (const row of ticketRows) {
      const ticket = mapKitchenTicketRow(row);
      const [itemRows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM kitchen_ticket_items WHERE kitchen_ticket_id = ? ORDER BY sequence_number ASC',
        [ticket.id]
      );
      tickets.push({
        ...ticket,
        items: itemRows.map(mapKitchenTicketItemRow),
      });
    }

    return tickets;
  }

  async findTicketsByOrder(orderId: number, organizationId: number, branchId: number): Promise<KitchenTicket[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM kitchen_tickets WHERE order_id = ? AND organization_id = ? AND branch_id = ? ORDER BY id',
      [orderId, organizationId, branchId]
    );
    return rows.map(mapKitchenTicketRow);
  }

  async updateTicketStatus(
    id: number,
    organizationId: number,
    branchId: number,
    newStatus: KotStatus,
    userId: number
  ): Promise<KitchenTicket> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM kitchen_tickets WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
        [id, organizationId, branchId]
      );

      if (existing.length === 0) {
        throw new NotFoundError('Kitchen ticket not found', 'KITCHEN_TICKET_NOT_FOUND');
      }

      const ticket = existing[0];
      const currentStatus = ticket.ticket_status;

      if (currentStatus === 'VOIDED') {
        throw new BadRequestError('Cannot change status of a voided ticket', 'TICKET_VOIDED');
      }
      if (currentStatus === 'COMPLETED') {
        throw new BadRequestError('Cannot change status of a completed ticket', 'TICKET_COMPLETED');
      }

      await conn.execute(
        'UPDATE kitchen_tickets SET ticket_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
        [newStatus, id, organizationId, branchId]
      );

      // Synchronize parent order status within the same transaction
      await this.syncOrderStatusFromKot(conn, ticket.order_id, organizationId, branchId);

      await conn.commit();

      const updated = await this.findById(id, organizationId, branchId);
      if (!updated) {
        throw new NotFoundError('Kitchen ticket not found after update', 'KITCHEN_TICKET_NOT_FOUND');
      }
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateTicketItemStatus(
    itemId: number,
    organizationId: number,
    branchId: number,
    newStatus: KotItemStatus,
    userId: number
  ): Promise<KitchenTicketItem> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [existingItem] = await conn.execute<RowDataPacket[]>(
        `SELECT kti.* FROM kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
         WHERE kti.id = ? AND kt.organization_id = ? AND kt.branch_id = ? FOR UPDATE`,
        [itemId, organizationId, branchId]
      );

      if (existingItem.length === 0) {
        throw new NotFoundError('Kitchen ticket item not found', 'KITCHEN_TICKET_ITEM_NOT_FOUND');
      }

      const item = existingItem[0];
      const currentStatus = item.item_status;

      if (currentStatus === 'READY') {
        throw new BadRequestError('Cannot change status of a ready item', 'ITEM_READY');
      }
      if (currentStatus === 'CANCELLED') {
        throw new BadRequestError('Cannot change status of a cancelled item', 'ITEM_CANCELLED');
      }

      await conn.execute(
        'UPDATE kitchen_ticket_items SET item_status = ?, updated_at = NOW() WHERE id = ?',
        [newStatus, itemId]
      );

      await conn.commit();

      const [updatedRows] = await conn.execute<RowDataPacket[]>(
        `SELECT kti.* FROM kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
         WHERE kti.id = ? AND kt.organization_id = ? AND kt.branch_id = ?`,
        [itemId, organizationId, branchId]
      );

      return mapKitchenTicketItemRow(updatedRows[0]);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Synchronize order status based on kitchen ticket statuses.
   * Must be called within an existing transaction (uses the same conn).
   *
   * Rules (forward-only):
   *   - Any KOT → PREPARING: if order is PLACED → PREPARING
   *   - All KOTs terminal (READY/COMPLETED/VOIDED): if order is PLACED/PREPARING → READY
   *   - No auto SERVED or COMPLETED
   *   - Idempotent: repeated calls with same state produce no change
   */
  async syncOrderStatusFromKot(
    conn: PoolConnection,
    orderId: number,
    organizationId: number,
    branchId: number
  ): Promise<void> {
    // Lock the order row to prevent concurrent status updates
    const [orderRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, order_status FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [orderId, organizationId, branchId]
    );
    if (orderRows.length === 0) return;

    const orderStatus = orderRows[0].order_status as string;

    // Terminal statuses: do not modify
    if (orderStatus === 'SERVED' || orderStatus === 'COMPLETED' || orderStatus === 'CANCELLED') {
      return;
    }

    // Get all KOT statuses for this order
    const [kotRows] = await conn.execute<RowDataPacket[]>(
      `SELECT ticket_status FROM kitchen_tickets
       WHERE order_id = ? AND organization_id = ? AND branch_id = ?`,
      [orderId, organizationId, branchId]
    );

    if (kotRows.length === 0) return;

    const statuses = kotRows.map((r: any) => r.ticket_status as string);

    // Classify: active = NEW or PREPARING, terminal = READY/COMPLETED/VOIDED
    const hasActive = statuses.some((s) => s === 'NEW' || s === 'PREPARING');
    const hasPreparing = statuses.some((s) => s === 'PREPARING');
    const allTerminal = statuses.every((s) => s === 'READY' || s === 'COMPLETED' || s === 'VOIDED');

    let newOrderStatus: string | null = null;

    if (orderStatus === 'PLACED') {
      if (allTerminal) {
        // All KOTs done → READY
        newOrderStatus = 'READY';
      } else if (hasPreparing) {
        // At least one KOT is PREPARING → PREPARING
        newOrderStatus = 'PREPARING';
      }
    } else if (orderStatus === 'PREPARING') {
      if (allTerminal) {
        // All KOTs done → READY
        newOrderStatus = 'READY';
      }
      // If has active but not all terminal: stay at PREPARING (no change)
    }

    if (newOrderStatus && newOrderStatus !== orderStatus) {
      if (newOrderStatus === 'READY') {
        await conn.execute(
          `UPDATE orders SET order_status = 'READY', ready_at = COALESCE(ready_at, NOW()), updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [orderId, organizationId, branchId]
        );
      } else {
        await conn.execute(
          'UPDATE orders SET order_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
          [newOrderStatus, orderId, organizationId, branchId]
        );
      }
    }
  }
}

export const kitchenRepository = new KitchenRepository();

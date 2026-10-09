export type KotStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'VOIDED';

export type KotItemStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

export type KitchenOrderType = 'DINE_IN' | 'TAKEAWAY';

export interface KitchenTicket {
  id: number;
  organizationId: number;
  branchId: number;
  orderId: number;
  orderRoundId?: number;
  kotNumber: string;
  orderNumber: string;
  ticketStatus: KotStatus;
  orderType: KitchenOrderType;
  tableLabel: string | null;
  waiterName: string | null;
  voidedAt: string | null;
  voidedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenTicketItem {
  id: number;
  kitchenTicketId: number;
  sequenceNumber: number;
  menuItemId: number;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  modifierSummary: string | null;
  quantity: number;
  notes: string | null;
  prepStationId: number | null;
  prepStationName: string | null;
  prepTimeMinutesSnapshot: number | null;
  itemStatus: KotItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenTicketWithItems extends KitchenTicket {
  items: KitchenTicketItem[];
}

export interface ListKitchenTicketsParams {
  ticketStatus?: KotStatus;
  stationId?: number;
  orderType?: KitchenOrderType;
}

export interface UpdateTicketStatusInput {
  ticketStatus: KotStatus;
}

export interface UpdateTicketItemStatusInput {
  itemStatus: KotItemStatus;
}

// The operational KDS is intentionally one-tap: NEW -> READY.
// PREPARING remains supported for backwards compatibility and future detailed tracking,
// but kitchen staff do not have to press Start before marking food ready.
export const KOT_VALID_TRANSITIONS: Record<KotStatus, KotStatus[]> = {
  NEW: ['PREPARING', 'READY', 'VOIDED'],
  PREPARING: ['READY', 'VOIDED'],
  READY: ['COMPLETED', 'VOIDED'],
  COMPLETED: [],
  VOIDED: [],
};

export const KOT_ITEM_VALID_TRANSITIONS: Record<KotItemStatus, KotItemStatus[]> = {
  PENDING: ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELLED: [],
};

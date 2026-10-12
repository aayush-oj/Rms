export type InventoryMovementType =
  | 'OPENING'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'COUNT_CORRECTION'
  | 'PURCHASE_RECEIPT';

export type InventoryStockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';

export interface InventoryCategory {
  id: number;
  organizationId: number;
  branchId: number;
  name: string;
  code: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLocation {
  id: number;
  organizationId: number;
  branchId: number;
  name: string;
  code: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: number;
  organizationId: number;
  branchId: number;
  categoryId: number | null;
  categoryName: string | null;
  unitId: number;
  unitSymbol: string;
  name: string;
  sku: string | null;
  costPerUnit: number;
  reorderPoint: number;
  reorderQuantity: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryBalance {
  inventoryItemId: number;
  locationId: number;
  itemName: string;
  sku: string | null;
  categoryName: string | null;
  unitId: number;
  unitSymbol: string;
  currentQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  status: InventoryStockStatus;
  locationName: string;
}

export interface InventoryMovement {
  id: number;
  organizationId: number;
  branchId: number;
  inventoryItemId: number;
  itemName: string;
  locationId: number;
  locationName: string;
  movementType: InventoryMovementType;
  quantity: number;
  unitId: number;
  unitSymbol: string;
  beforeQuantity: number;
  afterQuantity: number;
  reason: string;
  referenceType: string | null;
  referenceId: number | null;
  performedBy: number;
  createdAt: string;
}

export interface InventoryCountItem {
  id?: number;
  inventoryItemId: number;
  itemName: string;
  unitSymbol: string;
  systemQuantity: number;
  countedQuantity: number;
  varianceQuantity: number;
}

export interface InventoryCount {
  id: number;
  organizationId: number;
  branchId: number;
  locationId: number;
  locationName: string;
  status: 'DRAFT' | 'CONFIRMED';
  createdBy: number;
  confirmedBy: number | null;
  createdAt: string;
  confirmedAt: string | null;
  notes: string | null;
  items: InventoryCountItem[];
}

export interface InventoryOverview {
  totalItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  activeLocations: number;
  recentMovements: InventoryMovement[];
}

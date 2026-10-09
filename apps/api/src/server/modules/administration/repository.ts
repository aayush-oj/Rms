import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  Floor,
  Section,
  DiningTable,
  HardwarePrinter,
  PreparationStation,
  BranchTaxConfig,
  PaymentMethod,
  UnitOfMeasure,
  OperationalSettings,
  UnitDimension,
  MenuCategory,
  MenuItem,
  MenuComboComponent,
} from './types';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { getDatabasePool, isDatabaseAvailable } from '../../db/pool';
import { AdministrationMemoryStore } from './memoryStore';

// MySQL error codes
const ER_DUP_ENTRY = 1062;
const ER_NO_REFERENCED_ROW_2 = 1452;

// ==========================================
// Explicit Row-to-Domain Mappers
// ==========================================

function mapFloorRow(row: RowDataPacket): Floor {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    name: row.name,
    displayOrder: Number(row.display_order),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapSectionRow(row: RowDataPacket): Section {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    floorId: Number(row.floor_id),
    name: row.name,
    displayOrder: Number(row.display_order),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapTableRow(row: RowDataPacket): DiningTable {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    floorId: Number(row.floor_id),
    sectionId: Number(row.section_id),
    assignedWaiterId: row.assigned_waiter_id != null ? Number(row.assigned_waiter_id) : null,
    notes: row.notes != null ? String(row.notes) : null,
    tableNumber: row.table_number,
    capacity: Number(row.capacity),
    status: row.status as DiningTable['status'],
    posX: Number(row.pos_x),
    posY: Number(row.pos_y),
    width: Number(row.width),
    height: Number(row.height),
    shape: row.shape as DiningTable['shape'],
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapPrinterRow(row: RowDataPacket): HardwarePrinter {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    name: row.name,
    ipAddress: row.ip_address,
    port: Number(row.port),
    paperWidth: row.paper_width as HardwarePrinter['paperWidth'],
    deviceType: row.device_type,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapStationRow(row: RowDataPacket): PreparationStation {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    name: row.name,
    type: row.type as PreparationStation['type'],
    primaryPrinterId: row.primary_printer_id != null ? Number(row.primary_printer_id) : null,
    backupPrinterId: row.backup_printer_id != null ? Number(row.backup_printer_id) : null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapBranchTaxConfigRow(row: RowDataPacket): BranchTaxConfig {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    isVatRegistered: Boolean(row.is_vat_registered),
    taxRegistrationNumber: row.tax_registration_number == null ? null : String(row.tax_registration_number),
    vatRate: Number(row.vat_rate),
    defaultPriceEntryMode: row.default_price_entry_mode as BranchTaxConfig['defaultPriceEntryMode'],
    roundingMethod: row.rounding_method as BranchTaxConfig['roundingMethod'],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapPaymentMethodRow(row: RowDataPacket): PaymentMethod {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    name: row.name,
    code: row.code,
    type: row.type as PaymentMethod['type'],
    requiresReference: Boolean(row.requires_reference),
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapUnitRow(row: RowDataPacket): UnitOfMeasure {
  return {
    id: Number(row.id),
    organizationId: row.organization_id != null ? Number(row.organization_id) : null,
    name: row.name,
    symbol: row.symbol,
    dimension: row.dimension as UnitDimension,
    baseUnitSymbol: row.base_unit_symbol,
    conversionFactor: Number(row.conversion_factor),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapOperationalSettingsRow(row: RowDataPacket): OperationalSettings {
  let operatingDays: string[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  if (row.operating_days) {
    if (typeof row.operating_days === 'string') {
      try { operatingDays = JSON.parse(row.operating_days); } catch { /* keep default */ }
    } else if (Array.isArray(row.operating_days)) {
      operatingDays = row.operating_days;
    }
  }

  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    operatingDays,
    dineInEnabled: Boolean(row.dine_in_enabled),
    takeawayEnabled: Boolean(row.takeaway_enabled),
    deliveryEnabled: Boolean(row.delivery_enabled),
    receiptHeader: row.receipt_header ?? null,
    receiptFooter: row.receipt_footer ?? null,
    currencySymbol: row.currency_symbol,
    autoPrintKot: Boolean(row.auto_print_kot),
    autoPrintBill: Boolean(row.auto_print_bill),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapMenuCategoryRow(row: RowDataPacket): MenuCategory {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    parentId: row.parent_id != null ? Number(row.parent_id) : null,
    name: row.name,
    stationId: row.station_id != null ? Number(row.station_id) : null,
    displayOrder: Number(row.display_order),
    imageUrl: row.image_url != null ? String(row.image_url) : null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapMenuItemRow(row: RowDataPacket): MenuItem {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    categoryId: Number(row.category_id),
    defaultPrepStationId: row.default_prep_station_id != null ? Number(row.default_prep_station_id) : null,
    departmentId: row.department_id != null ? Number(row.department_id) : null,
    prepTimeMinutes: row.prep_time_minutes != null ? Number(row.prep_time_minutes) : null,
    name: row.name,
    sku: row.sku != null ? String(row.sku) : null,
    description: row.description != null ? String(row.description) : null,
    enteredPrice: Number(row.entered_price),
    priceEntryMode: row.price_entry_mode as MenuItem['priceEntryMode'],
    customerPrice: Number(row.entered_price),
    priceBeforeVat: Number(row.entered_price),
    vatAmount: 0,
    costPrice: Number(row.cost_price),
    imageUrl: row.image_url != null ? String(row.image_url) : null,
    isAvailable: Boolean(row.is_available),
    isCombo: Boolean(row.is_combo),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// ==========================================
// MySQL Error Handling Helper
// ==========================================

function handleMysqlError(err: unknown, context: string): never {
  const mysqlErr = err as { code?: string; errno?: number; message?: string };
  if (mysqlErr.errno === ER_DUP_ENTRY) {
    const msg = mysqlErr.message || '';
    if (msg.includes('uk_org_branch_floor_name')) {
      throw new ConflictError('Floor name already exists in this branch', 'FLOOR_DUPLICATE_NAME');
    }
    if (msg.includes('uk_org_branch_floor_section_name')) {
      throw new ConflictError('Section name already exists on this floor', 'SECTION_DUPLICATE_NAME');
    }
    if (msg.includes('uk_org_branch_table_number')) {
      throw new ConflictError('Table number already exists in this branch', 'TABLE_DUPLICATE_NUMBER');
    }
    if (msg.includes('uk_org_branch_printer_name')) {
      throw new ConflictError('Printer name already exists in this branch', 'PRINTER_DUPLICATE_NAME');
    }
    if (msg.includes('uk_org_branch_station_name')) {
      throw new ConflictError('Station name already exists in this branch', 'STATION_DUPLICATE_NAME');
    }
    if (msg.includes('uk_org_payment_code') || msg.includes('PAYMENT_DUPLICATE_CODE')) {
      throw new ConflictError('Payment method code already exists', 'PAYMENT_DUPLICATE_CODE');
    }
    if (msg.includes('uk_org_category_name')) {
      throw new ConflictError('Menu category name already exists in this organization', 'MENU_CATEGORY_DUPLICATE_NAME');
    }
    if (msg.includes('uk_org_item_sku')) {
      throw new ConflictError('Menu item SKU already exists in this organization', 'MENU_ITEM_DUPLICATE_SKU');
    }
    throw new ConflictError(`Duplicate entry: ${context}`, 'DUPLICATE_ENTRY');
  }
  if (mysqlErr.errno === ER_NO_REFERENCED_ROW_2) {
    throw new NotFoundError(`Referenced entity not found: ${context}`, 'REFERENCED_ENTITY_NOT_FOUND');
  }
  throw err;
}

// ==========================================
// Platform Default Units (seeded once)
// ==========================================

const DEFAULT_PLATFORM_UNITS: Omit<UnitOfMeasure, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Kilogram', symbol: 'kg', dimension: 'MASS', baseUnitSymbol: 'g', conversionFactor: 1000, isActive: true },
  { name: 'Gram', symbol: 'g', dimension: 'MASS', baseUnitSymbol: 'g', conversionFactor: 1, isActive: true },
  { name: 'Milligram', symbol: 'mg', dimension: 'MASS', baseUnitSymbol: 'g', conversionFactor: 0.001, isActive: true },
  { name: 'Liter', symbol: 'l', dimension: 'VOLUME', baseUnitSymbol: 'ml', conversionFactor: 1000, isActive: true },
  { name: 'Milliliter', symbol: 'ml', dimension: 'VOLUME', baseUnitSymbol: 'ml', conversionFactor: 1, isActive: true },
  { name: 'Piece', symbol: 'pcs', dimension: 'COUNT', baseUnitSymbol: 'pcs', conversionFactor: 1, isActive: true },
  { name: 'Portion', symbol: 'portion', dimension: 'COUNT', baseUnitSymbol: 'pcs', conversionFactor: 1, isActive: true },
  { name: 'Box', symbol: 'box', dimension: 'COUNT', baseUnitSymbol: 'pcs', conversionFactor: 1, isActive: true },
  { name: 'Bottle', symbol: 'bottle', dimension: 'COUNT', baseUnitSymbol: 'pcs', conversionFactor: 1, isActive: true },
  { name: 'Can', symbol: 'can', dimension: 'COUNT', baseUnitSymbol: 'pcs', conversionFactor: 1, isActive: true },
];

// ==========================================
// Repository
// ==========================================

export class AdministrationRepository {
  private platformUnitsSeeded = false;
  private memoryStore = new AdministrationMemoryStore();

  public getMemoryStore(): AdministrationMemoryStore {
    return this.memoryStore;
  }

  private pool() {
    return getDatabasePool();
  }

  private async canUseDatabase(): Promise<boolean> {
    return isDatabaseAvailable();
  }

  private async ensurePlatformUnits(): Promise<void> {
    if (this.platformUnitsSeeded) return;
    if (!(await this.canUseDatabase())) {
      this.memoryStore.ensurePlatformUnits();
      return;
    }
    const [existing] = await this.pool().execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM units_of_measure WHERE organization_id IS NULL'
    );
    if (existing[0].cnt > 0) {
      this.platformUnitsSeeded = true;
      return;
    }
    for (const u of DEFAULT_PLATFORM_UNITS) {
      await this.pool().execute(
        `INSERT INTO units_of_measure (organization_id, name, symbol, dimension, base_unit_symbol, conversion_factor, is_active)
         VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
        [u.name, u.symbol, u.dimension, u.baseUnitSymbol, u.conversionFactor, u.isActive]
      );
    }
    this.platformUnitsSeeded = true;
  }

  // ==========================================
  // FLOORS
  // ==========================================

  public async createFloor(data: {
    organizationId: number;
    branchId: number;
    name: string;
    displayOrder?: number;
    isActive?: boolean;
  }): Promise<Floor> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createFloor(data);
    }
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO floors (organization_id, branch_id, name, display_order, is_active)
         VALUES (?, ?, ?, ?, ?)`,
        [data.organizationId, data.branchId, data.name, data.displayOrder ?? 0, data.isActive ?? true]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM floors WHERE id = ?', [result.insertId]
      );
      return mapFloorRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createFloor');
    }
  }

  public async findFloorById(id: number, organizationId: number): Promise<Floor | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findFloorById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM floors WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapFloorRow(rows[0]) : null;
  }

  public async listFloorsByBranch(organizationId: number, branchId: number): Promise<Floor[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listFloorsByBranch(organizationId, branchId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM floors WHERE organization_id = ? AND branch_id = ? ORDER BY display_order ASC, id ASC',
      [organizationId, branchId]
    );
    return rows.map(mapFloorRow);
  }

  public async updateFloor(
    id: number,
    organizationId: number,
    updates: Partial<Pick<Floor, 'name' | 'displayOrder' | 'isActive'>>
  ): Promise<Floor> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateFloor(id, organizationId, updates);
    }
    const existing = await this.findFloorById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Floor #${id} not found`, 'FLOOR_NOT_FOUND');
    }

    const name = updates.name ?? existing.name;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const isActive = updates.isActive ?? existing.isActive;

    try {
      await this.pool().execute(
        `UPDATE floors SET name = ?, display_order = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [name, displayOrder, isActive, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateFloor');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM floors WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapFloorRow(rows[0]);
  }

  public async deleteFloor(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteFloor(id, organizationId);
    }
    const floor = await this.findFloorById(id, organizationId);
    if (!floor) return false;

    const [countRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM sections WHERE organization_id = ? AND floor_id = ?',
      [organizationId, id]
    );
    if (countRows[0].cnt > 0) {
      throw new ConflictError('Cannot delete floor with existing dining sections', 'FLOOR_HAS_SECTIONS');
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM floors WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // SECTIONS
  // ==========================================

  public async createSection(data: {
    organizationId: number;
    branchId: number;
    floorId: number;
    name: string;
    displayOrder?: number;
    isActive?: boolean;
  }): Promise<Section> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createSection(data);
    }
    const floor = await this.findFloorById(data.floorId, data.organizationId);
    if (!floor || floor.branchId !== data.branchId) {
      throw new NotFoundError(`Floor #${data.floorId} not found in this branch`, 'FLOOR_NOT_FOUND');
    }

    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO sections (organization_id, branch_id, floor_id, name, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [data.organizationId, data.branchId, data.floorId, data.name, data.displayOrder ?? 0, data.isActive ?? true]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM sections WHERE id = ?', [result.insertId]
      );
      return mapSectionRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createSection');
    }
  }

  public async findSectionById(id: number, organizationId: number): Promise<Section | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findSectionById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM sections WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapSectionRow(rows[0]) : null;
  }

  public async listSectionsByBranch(
    organizationId: number,
    branchId: number,
    floorId?: number
  ): Promise<Section[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listSectionsByBranch(organizationId, branchId, floorId);
    }
    if (floorId !== undefined) {
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM sections WHERE organization_id = ? AND branch_id = ? AND floor_id = ? ORDER BY display_order ASC, id ASC',
        [organizationId, branchId, floorId]
      );
      return rows.map(mapSectionRow);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM sections WHERE organization_id = ? AND branch_id = ? ORDER BY display_order ASC, id ASC',
      [organizationId, branchId]
    );
    return rows.map(mapSectionRow);
  }

  public async updateSection(
    id: number,
    organizationId: number,
    updates: Partial<Pick<Section, 'floorId' | 'name' | 'displayOrder' | 'isActive'>>
  ): Promise<Section> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateSection(id, organizationId, updates);
    }
    const existing = await this.findSectionById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Section #${id} not found`, 'SECTION_NOT_FOUND');
    }

    const targetFloorId = updates.floorId ?? existing.floorId;
    if (updates.floorId !== undefined && updates.floorId !== existing.floorId) {
      const floor = await this.findFloorById(updates.floorId, organizationId);
      if (!floor || floor.branchId !== existing.branchId) {
        throw new NotFoundError(`Target floor #${updates.floorId} not found in this branch`, 'FLOOR_NOT_FOUND');
      }
    }

    const name = updates.name ?? existing.name;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const isActive = updates.isActive ?? existing.isActive;

    try {
      await this.pool().execute(
        `UPDATE sections SET floor_id = ?, name = ?, display_order = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [targetFloorId, name, displayOrder, isActive, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateSection');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM sections WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapSectionRow(rows[0]);
  }

  public async deleteSection(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteSection(id, organizationId);
    }
    const section = await this.findSectionById(id, organizationId);
    if (!section) return false;

    const [countRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM dining_tables WHERE organization_id = ? AND section_id = ?',
      [organizationId, id]
    );
    if (countRows[0].cnt > 0) {
      throw new ConflictError('Cannot delete section with existing dining tables', 'SECTION_HAS_TABLES');
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM sections WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // DINING TABLES
  // ==========================================

  public async createTable(data: {
    organizationId: number;
    branchId: number;
    floorId: number;
    sectionId: number;
    tableNumber: string;
    capacity?: number;
    status?: DiningTable['status'];
    posX?: number;
    posY?: number;
    width?: number;
    height?: number;
    shape?: DiningTable['shape'];
    isActive?: boolean;
    assignedWaiterId?: number | null;
    notes?: string | null;
  }): Promise<DiningTable> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createTable({ ...data, capacity: data.capacity ?? 2 });
    }
    const section = await this.findSectionById(data.sectionId, data.organizationId);
    if (!section || section.branchId !== data.branchId) {
      throw new NotFoundError(`Section #${data.sectionId} not found in this branch`, 'SECTION_NOT_FOUND');
    }
    if (data.assignedWaiterId != null) {
      const [waiters] = await this.pool().execute<RowDataPacket[]>(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
         JOIN user_branches ub ON ub.user_id = u.id AND ub.organization_id = u.organization_id
         WHERE u.id = ? AND u.organization_id = ? AND u.is_active = 1 AND r.name = 'WAITER' AND ub.branch_id = ?`,
        [data.assignedWaiterId, data.organizationId, data.branchId]
      );
      if (!waiters.length) throw new BadRequestError('Assigned staff member must be an active WAITER with branch access', 'INVALID_WAITER');
    }

    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO dining_tables (organization_id, branch_id, floor_id, section_id, table_number,
          capacity, status, pos_x, pos_y, width, height, shape, is_active, assigned_waiter_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId, data.branchId, data.floorId, data.sectionId, data.tableNumber,
          data.capacity ?? 2, data.status ?? 'available',
          data.posX ?? 0, data.posY ?? 0, data.width ?? 100, data.height ?? 100,
          data.shape ?? 'square', data.isActive ?? true, data.assignedWaiterId ?? null, data.notes ?? null,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM dining_tables WHERE id = ?', [result.insertId]
      );
      return mapTableRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createTable');
    }
  }

  public async findTableById(id: number, organizationId: number): Promise<DiningTable | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findTableById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM dining_tables WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapTableRow(rows[0]) : null;
  }

  /**
   * Lock a dining table row for order creation within an existing transaction.
   * Verifies the table belongs to the org+branch and is AVAILABLE.
   * Throws if the table is not AVAILABLE.
   */
  public async lockTableForOccupancy(
    conn: PoolConnection,
    tableId: number,
    organizationId: number,
    branchId: number
  ): Promise<DiningTable> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [tableId, organizationId, branchId]
    );
    if (rows.length === 0) {
      throw new NotFoundError(`Dining table #${tableId} not found in this branch`, 'TABLE_NOT_FOUND');
    }
    const table = mapTableRow(rows[0]);
    if (table.status !== 'available') {
      throw new ConflictError(
        `Table ${table.tableNumber} is not available (current status: ${table.status})`,
        'TABLE_NOT_AVAILABLE'
      );
    }
    return table;
  }

  public async lockTableForUpdate(
    conn: PoolConnection,
    tableId: number,
    organizationId: number,
    branchId: number
  ): Promise<DiningTable> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [tableId, organizationId, branchId]
    );
    if (rows.length === 0) {
      throw new NotFoundError(`Dining table #${tableId} not found in this branch`, 'TABLE_NOT_FOUND');
    }
    return mapTableRow(rows[0]);
  }

  /**
   * Release a dining table (set to AVAILABLE) if no other active orders remain.
   * Must be called within an existing transaction.
   * Safe against concurrent releases — checks remaining active orders atomically.
   */
  public async releaseTableIfUnoccupied(
    conn: PoolConnection,
    tableId: number,
    organizationId: number,
    branchId: number
  ): Promise<void> {
    const [activeOrders] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active_count FROM orders
       WHERE dining_table_id = ? AND organization_id = ? AND branch_id = ?
       AND order_status NOT IN ('COMPLETED', 'CANCELLED')`,
      [tableId, organizationId, branchId]
    );
    const activeCount = Number(activeOrders[0].active_count);
    if (activeCount === 0) {
      await conn.execute(
        `UPDATE dining_tables SET status = 'available', updated_at = NOW()
         WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [tableId, organizationId, branchId]
      );
    }
  }

  public async listTablesByBranch(
    organizationId: number,
    branchId: number,
    filters?: { floorId?: number; sectionId?: number; status?: string }
  ): Promise<DiningTable[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listTablesByBranch(organizationId, branchId, filters as any);
    }
    let sql = 'SELECT * FROM dining_tables WHERE organization_id = ? AND branch_id = ?';
    const params: (number | string)[] = [organizationId, branchId];

    if (filters?.floorId !== undefined) {
      sql += ' AND floor_id = ?';
      params.push(filters.floorId);
    }
    if (filters?.sectionId !== undefined) {
      sql += ' AND section_id = ?';
      params.push(filters.sectionId);
    }
    if (filters?.status !== undefined) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY table_number ASC';
    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, params);
    return rows.map(mapTableRow);
  }

  public async updateTable(
    id: number,
    organizationId: number,
    updates: Partial<Omit<DiningTable, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>>
  ): Promise<DiningTable> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateTable(id, organizationId, updates);
    }
    const existing = await this.findTableById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Dining table #${id} not found`, 'TABLE_NOT_FOUND');
    }

    if (updates.sectionId !== undefined && updates.sectionId !== existing.sectionId) {
      const section = await this.findSectionById(updates.sectionId, organizationId);
      if (!section || section.branchId !== existing.branchId) {
        throw new NotFoundError(`Section #${updates.sectionId} not found in this branch`, 'SECTION_NOT_FOUND');
      }
    }

    const floorId = updates.floorId !== undefined ? updates.floorId : existing.floorId;
    const sectionId = updates.sectionId !== undefined ? updates.sectionId : existing.sectionId;
    const tableNumber = updates.tableNumber !== undefined ? updates.tableNumber : existing.tableNumber;
    const capacity = updates.capacity !== undefined ? updates.capacity : existing.capacity;
    const status = updates.status !== undefined ? updates.status : existing.status;
    const posX = updates.posX !== undefined ? updates.posX : existing.posX;
    const posY = updates.posY !== undefined ? updates.posY : existing.posY;
    const width = updates.width !== undefined ? updates.width : existing.width;
    const height = updates.height !== undefined ? updates.height : existing.height;
    const shape = updates.shape !== undefined ? updates.shape : existing.shape;
    const isActive = updates.isActive !== undefined ? updates.isActive : existing.isActive;
    const assignedWaiterId = updates.assignedWaiterId !== undefined ? updates.assignedWaiterId : existing.assignedWaiterId;
    const notes = updates.notes !== undefined ? updates.notes : existing.notes;
    if (assignedWaiterId != null) {
      const [waiters] = await this.pool().execute<RowDataPacket[]>(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
         JOIN user_branches ub ON ub.user_id = u.id AND ub.organization_id = u.organization_id
         WHERE u.id = ? AND u.organization_id = ? AND u.is_active = 1 AND r.name = 'WAITER' AND ub.branch_id = ?`,
        [assignedWaiterId, organizationId, existing.branchId]
      );
      if (!waiters.length) throw new BadRequestError('Assigned staff member must be an active WAITER with branch access', 'INVALID_WAITER');
    }

    try {
      await this.pool().execute(
        `UPDATE dining_tables SET floor_id = ?, section_id = ?, table_number = ?, capacity = ?,
          status = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, shape = ?, is_active = ?, assigned_waiter_id = ?, notes = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [floorId, sectionId, tableNumber, capacity, status, posX, posY, width, height, shape, isActive, assignedWaiterId, notes, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateTable');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM dining_tables WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapTableRow(rows[0]);
  }

  public async deleteTable(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteTable(id, organizationId);
    }
    const table = await this.findTableById(id, organizationId);
    if (!table) return false;

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM dining_tables WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // HARDWARE PRINTERS
  // ==========================================

  public async createPrinter(data: {
    organizationId: number;
    branchId: number;
    name: string;
    ipAddress: string;
    port?: number;
    paperWidth?: HardwarePrinter['paperWidth'];
    deviceType?: string;
    isActive?: boolean;
  }): Promise<HardwarePrinter> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createPrinter(data);
    }
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO hardware_printers (organization_id, branch_id, name, ip_address, port, paper_width, device_type, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId, data.branchId, data.name, data.ipAddress,
          data.port ?? 9100, data.paperWidth ?? '80mm', data.deviceType ?? 'ESC_POS', data.isActive ?? true,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM hardware_printers WHERE id = ?', [result.insertId]
      );
      return mapPrinterRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createPrinter');
    }
  }

  public async findPrinterById(id: number, organizationId: number): Promise<HardwarePrinter | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findPrinterById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM hardware_printers WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapPrinterRow(rows[0]) : null;
  }

  public async listPrintersByBranch(organizationId: number, branchId: number): Promise<HardwarePrinter[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listPrintersByBranch(organizationId, branchId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM hardware_printers WHERE organization_id = ? AND branch_id = ? ORDER BY id ASC',
      [organizationId, branchId]
    );
    return rows.map(mapPrinterRow);
  }

  public async updatePrinter(
    id: number,
    organizationId: number,
    updates: Partial<Pick<HardwarePrinter, 'name' | 'ipAddress' | 'port' | 'paperWidth' | 'deviceType' | 'isActive'>>
  ): Promise<HardwarePrinter> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updatePrinter(id, organizationId, updates);
    }
    const existing = await this.findPrinterById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Printer #${id} not found`, 'PRINTER_NOT_FOUND');
    }

    const name = updates.name ?? existing.name;
    const ipAddress = updates.ipAddress ?? existing.ipAddress;
    const port = updates.port ?? existing.port;
    const paperWidth = updates.paperWidth ?? existing.paperWidth;
    const deviceType = updates.deviceType ?? existing.deviceType;
    const isActive = updates.isActive ?? existing.isActive;

    try {
      await this.pool().execute(
        `UPDATE hardware_printers SET name = ?, ip_address = ?, port = ?, paper_width = ?, device_type = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [name, ipAddress, port, paperWidth, deviceType, isActive, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updatePrinter');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM hardware_printers WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapPrinterRow(rows[0]);
  }

  public async deletePrinter(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deletePrinter(id, organizationId);
    }
    const printer = await this.findPrinterById(id, organizationId);
    if (!printer) return false;

    const [countRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM preparation_stations
       WHERE organization_id = ? AND (primary_printer_id = ? OR backup_printer_id = ?)`,
      [organizationId, id, id]
    );
    if (countRows[0].cnt > 0) {
      throw new ConflictError('Cannot delete printer currently assigned to preparation stations', 'PRINTER_ASSIGNED_TO_STATION');
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM hardware_printers WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // PREPARATION STATIONS
  // ==========================================

  public async createStation(data: {
    organizationId: number;
    branchId: number;
    name: string;
    type?: PreparationStation['type'];
    primaryPrinterId?: number | null;
    backupPrinterId?: number | null;
    isActive?: boolean;
  }): Promise<PreparationStation> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createStation(data);
    }
    if (data.primaryPrinterId) {
      const p = await this.findPrinterById(data.primaryPrinterId, data.organizationId);
      if (!p || p.branchId !== data.branchId) {
        throw new NotFoundError(`Primary printer #${data.primaryPrinterId} not found in this branch`, 'PRINTER_NOT_FOUND');
      }
    }
    if (data.backupPrinterId) {
      const p = await this.findPrinterById(data.backupPrinterId, data.organizationId);
      if (!p || p.branchId !== data.branchId) {
        throw new NotFoundError(`Backup printer #${data.backupPrinterId} not found in this branch`, 'PRINTER_NOT_FOUND');
      }
    }

    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO preparation_stations (organization_id, branch_id, name, type, primary_printer_id, backup_printer_id, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId, data.branchId, data.name, data.type ?? 'kitchen',
          data.primaryPrinterId ?? null, data.backupPrinterId ?? null, data.isActive ?? true,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM preparation_stations WHERE id = ?', [result.insertId]
      );
      return mapStationRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createStation');
    }
  }

  public async findStationById(id: number, organizationId: number): Promise<PreparationStation | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findStationById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM preparation_stations WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapStationRow(rows[0]) : null;
  }

  public async listStationsByBranch(organizationId: number, branchId: number): Promise<PreparationStation[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listStationsByBranch(organizationId, branchId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM preparation_stations WHERE organization_id = ? AND branch_id = ? ORDER BY id ASC',
      [organizationId, branchId]
    );
    return rows.map(mapStationRow);
  }

  public async updateStation(
    id: number,
    organizationId: number,
    updates: Partial<Pick<PreparationStation, 'name' | 'type' | 'primaryPrinterId' | 'backupPrinterId' | 'isActive'>>
  ): Promise<PreparationStation> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateStation(id, organizationId, updates);
    }
    const existing = await this.findStationById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Station #${id} not found`, 'STATION_NOT_FOUND');
    }

    if (updates.primaryPrinterId !== undefined && updates.primaryPrinterId !== null) {
      const p = await this.findPrinterById(updates.primaryPrinterId, organizationId);
      if (!p || p.branchId !== existing.branchId) {
        throw new NotFoundError(`Primary printer #${updates.primaryPrinterId} not found in this branch`, 'PRINTER_NOT_FOUND');
      }
    }
    if (updates.backupPrinterId !== undefined && updates.backupPrinterId !== null) {
      const p = await this.findPrinterById(updates.backupPrinterId, organizationId);
      if (!p || p.branchId !== existing.branchId) {
        throw new NotFoundError(`Backup printer #${updates.backupPrinterId} not found in this branch`, 'PRINTER_NOT_FOUND');
      }
    }

    const name = updates.name ?? existing.name;
    const type = updates.type ?? existing.type;
    const primaryPrinterId = updates.primaryPrinterId !== undefined ? updates.primaryPrinterId : existing.primaryPrinterId;
    const backupPrinterId = updates.backupPrinterId !== undefined ? updates.backupPrinterId : existing.backupPrinterId;
    const isActive = updates.isActive !== undefined ? updates.isActive : existing.isActive;

    try {
      await this.pool().execute(
        `UPDATE preparation_stations SET name = ?, type = ?, primary_printer_id = ?, backup_printer_id = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [name, type, primaryPrinterId, backupPrinterId, isActive, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateStation');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM preparation_stations WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapStationRow(rows[0]);
  }

  public async deleteStation(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteStation(id, organizationId);
    }
    const station = await this.findStationById(id, organizationId);
    if (!station) return false;

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM preparation_stations WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // MENU CATEGORIES (Organization Level)
  // ==========================================

  public async createMenuCategory(data: {
    organizationId: number;
    parentId?: number | null;
    name: string;
    stationId?: number | null;
    displayOrder?: number;
    imageUrl?: string | null;
    isActive?: boolean;
  }): Promise<MenuCategory> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createMenuCategory(data);
    }

    if (data.parentId != null) {
      const parent = await this.findMenuCategoryById(data.parentId, data.organizationId);
      if (!parent) {
        throw new NotFoundError('Parent category not found', 'MENU_CATEGORY_PARENT_NOT_FOUND');
      }
    }

    if (data.stationId != null) {
      const station = await this.findStationById(data.stationId, data.organizationId);
      if (!station) {
        throw new NotFoundError('Preparation station not found', 'PREPARATION_STATION_NOT_FOUND');
      }
    }

    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO menu_categories (organization_id, parent_id, name, station_id, display_order, image_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId,
          data.parentId ?? null,
          data.name,
          data.stationId ?? null,
          data.displayOrder ?? 0,
          data.imageUrl ?? null,
          data.isActive ?? true,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM menu_categories WHERE id = ?', [result.insertId]
      );
      return mapMenuCategoryRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createMenuCategory');
    }
  }

  public async findMenuCategoryById(id: number, organizationId: number): Promise<MenuCategory | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findMenuCategoryById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM menu_categories WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapMenuCategoryRow(rows[0]) : null;
  }

  public async listMenuCategoriesByOrg(organizationId: number): Promise<MenuCategory[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listMenuCategoriesByOrg(organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM menu_categories WHERE organization_id = ? ORDER BY display_order ASC, id ASC',
      [organizationId]
    );
    return rows.map(mapMenuCategoryRow);
  }

  public async updateMenuCategory(
    id: number,
    organizationId: number,
    updates: Partial<Pick<MenuCategory, 'parentId' | 'name' | 'stationId' | 'displayOrder' | 'imageUrl' | 'isActive'>>
  ): Promise<MenuCategory> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateMenuCategory(id, organizationId, updates);
    }
    const existing = await this.findMenuCategoryById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Menu category #${id} not found`, 'MENU_CATEGORY_NOT_FOUND');
    }

    if (updates.parentId !== undefined && updates.parentId !== null) {
      if (updates.parentId === id) {
        throw new BadRequestError('Category cannot be its own parent', 'MENU_CATEGORY_SELF_PARENT');
      }
      const parent = await this.findMenuCategoryById(updates.parentId, organizationId);
      if (!parent) {
        throw new NotFoundError('Parent category not found', 'MENU_CATEGORY_PARENT_NOT_FOUND');
      }
    }

    if (updates.stationId !== undefined && updates.stationId !== null) {
      const station = await this.findStationById(updates.stationId, organizationId);
      if (!station) {
        throw new NotFoundError('Preparation station not found', 'PREPARATION_STATION_NOT_FOUND');
      }
    }

    const parentId = updates.parentId !== undefined ? updates.parentId : existing.parentId;
    const name = updates.name ?? existing.name;
    const stationId = updates.stationId !== undefined ? updates.stationId : existing.stationId;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const imageUrl = updates.imageUrl !== undefined ? updates.imageUrl : existing.imageUrl;
    const isActive = updates.isActive ?? existing.isActive;

    try {
      await this.pool().execute(
        `UPDATE menu_categories SET parent_id = ?, name = ?, station_id = ?, display_order = ?, image_url = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [parentId, name, stationId, displayOrder, imageUrl, isActive, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateMenuCategory');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM menu_categories WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapMenuCategoryRow(rows[0]);
  }

  public async deleteMenuCategory(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteMenuCategory(id, organizationId);
    }
    const tc = await this.findMenuCategoryById(id, organizationId);
    if (!tc) return false;

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM menu_categories WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // MENU ITEMS (Organization Level)
  // ==========================================

  public async createMenuItem(data: {
    organizationId: number;
    categoryId: number;
    defaultPrepStationId?: number | null;
    departmentId?: number | null;
    prepTimeMinutes?: number | null;
    name: string;
    sku?: string | null;
    description?: string | null;
    enteredPrice?: number;
    priceEntryMode?: MenuItem['priceEntryMode'];
    costPrice?: number;
    imageUrl?: string | null;
    isAvailable?: boolean;
    isCombo?: boolean;
  }): Promise<MenuItem> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createMenuItem(data);
    }

    const category = await this.findMenuCategoryById(data.categoryId, data.organizationId);
    if (!category) {
      throw new NotFoundError('Menu category not found', 'MENU_CATEGORY_NOT_FOUND');
    }

    if (data.defaultPrepStationId != null) {
      const station = await this.findStationById(data.defaultPrepStationId, data.organizationId);
      if (!station) {
        throw new NotFoundError('Preparation station not found', 'PREPARATION_STATION_NOT_FOUND');
      }
    }

    if (data.departmentId != null) {
      const [department] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? AND organization_id = ?', [data.departmentId, data.organizationId]);
      if (!department.length) throw new NotFoundError('Department not found', 'DEPARTMENT_NOT_FOUND');
    }

    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO menu_items (organization_id, category_id, default_prep_station_id, department_id, name, sku, description, entered_price, price_entry_mode, cost_price, image_url, is_available, is_combo, prep_time_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId,
          data.categoryId,
          data.defaultPrepStationId ?? null,
          data.departmentId ?? null,
          data.name,
          data.sku ?? null,
          data.description ?? null,
          data.enteredPrice ?? 0,
          data.priceEntryMode ?? 'VAT_INCLUDED',
          data.costPrice ?? 0,
          data.imageUrl ?? null,
          data.isAvailable ?? true,
          data.isCombo ?? false,
          data.prepTimeMinutes ?? null,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM menu_items WHERE id = ?', [result.insertId]
      );
      return mapMenuItemRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createMenuItem');
    }
  }

  public async findMenuItemById(id: number, organizationId: number): Promise<MenuItem | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findMenuItemById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM menu_items WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapMenuItemRow(rows[0]) : null;
  }

  public async listMenuItemsByOrg(organizationId: number): Promise<MenuItem[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listMenuItemsByOrg(organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM menu_items WHERE organization_id = ? ORDER BY category_id ASC, name ASC, id ASC',
      [organizationId]
    );
    return rows.map(mapMenuItemRow);
  }

  public async updateMenuItem(
    id: number,
    organizationId: number,
    updates: Partial<Pick<MenuItem, 'categoryId' | 'defaultPrepStationId' | 'departmentId' | 'prepTimeMinutes' | 'name' | 'sku' | 'description' | 'enteredPrice' | 'priceEntryMode' | 'costPrice' | 'imageUrl' | 'isAvailable' | 'isCombo'>>
  ): Promise<MenuItem> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateMenuItem(id, organizationId, updates);
    }
    const existing = await this.findMenuItemById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Menu item #${id} not found`, 'MENU_ITEM_NOT_FOUND');
    }

    if (updates.isCombo === true && !existing.isCombo) {
      const [usage] = await this.pool().execute<RowDataPacket[]>(
        'SELECT combo_menu_item_id FROM menu_combo_components WHERE organization_id = ? AND component_menu_item_id = ? LIMIT 1',
        [organizationId, id],
      );
      if (usage.length) {
        throw new ConflictError('An item used inside another combo cannot itself become a combo', 'COMBO_COMPONENT_NESTED_COMBO');
      }
    }

    if (updates.categoryId != null) {
      const category = await this.findMenuCategoryById(updates.categoryId, organizationId);
      if (!category) {
        throw new NotFoundError('Menu category not found', 'MENU_CATEGORY_NOT_FOUND');
      }
    }

    if (updates.defaultPrepStationId !== undefined && updates.defaultPrepStationId !== null) {
      const station = await this.findStationById(updates.defaultPrepStationId, organizationId);
      if (!station) {
        throw new NotFoundError('Preparation station not found', 'PREPARATION_STATION_NOT_FOUND');
      }
    }

    if (updates.departmentId !== undefined && updates.departmentId !== null) {
      const [department] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? AND organization_id = ?', [updates.departmentId, organizationId]);
      if (!department.length) throw new NotFoundError('Department not found', 'DEPARTMENT_NOT_FOUND');
    }

    const categoryId = updates.categoryId ?? existing.categoryId;
    const defaultPrepStationId = updates.defaultPrepStationId !== undefined ? updates.defaultPrepStationId : existing.defaultPrepStationId;
    const departmentId = updates.departmentId !== undefined ? updates.departmentId : existing.departmentId;
    const prepTimeMinutes = updates.prepTimeMinutes !== undefined ? updates.prepTimeMinutes : existing.prepTimeMinutes;
    const name = updates.name ?? existing.name;
    const sku = updates.sku !== undefined ? updates.sku : existing.sku;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const enteredPrice = updates.enteredPrice ?? existing.enteredPrice;
    const priceEntryMode = updates.priceEntryMode ?? existing.priceEntryMode;
    const costPrice = updates.costPrice ?? existing.costPrice;
    const imageUrl = updates.imageUrl !== undefined ? updates.imageUrl : existing.imageUrl;
    const isAvailable = updates.isAvailable ?? existing.isAvailable;
    const isCombo = updates.isCombo ?? existing.isCombo;

    try {
      await this.pool().execute(
        `UPDATE menu_items SET category_id = ?, default_prep_station_id = ?, department_id = ?, prep_time_minutes = ?, name = ?, sku = ?, description = ?, entered_price = ?, price_entry_mode = ?, cost_price = ?, image_url = ?, is_available = ?, is_combo = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [categoryId, defaultPrepStationId, departmentId, prepTimeMinutes, name, sku, description, enteredPrice, priceEntryMode, costPrice, imageUrl, isAvailable, isCombo, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateMenuItem');
    }

    if (!isCombo) {
      await this.pool().execute(
        'DELETE FROM menu_combo_components WHERE organization_id = ? AND combo_menu_item_id = ?',
        [organizationId, id],
      );
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM menu_items WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapMenuItemRow(rows[0]);
  }

  public async deleteMenuItem(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteMenuItem(id, organizationId);
    }
    const item = await this.findMenuItemById(id, organizationId);
    if (!item) return false;
    const [comboUsage] = await this.pool().execute<RowDataPacket[]>(
      'SELECT combo_menu_item_id FROM menu_combo_components WHERE organization_id = ? AND component_menu_item_id = ? LIMIT 1',
      [organizationId, id],
    );
    if (comboUsage.length) {
      throw new ConflictError('This menu item is used inside a combo. Remove it from the combo before deleting it.', 'MENU_ITEM_USED_IN_COMBO');
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM menu_items WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  public async getMenuComboComponents(comboMenuItemId: number, organizationId: number): Promise<MenuComboComponent[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getMenuComboComponents(comboMenuItemId, organizationId);
    }
    const combo = await this.findMenuItemById(comboMenuItemId, organizationId);
    if (!combo) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT cc.*, mi.name AS component_name, mi.category_id AS component_category_id, mi.is_available
         FROM menu_combo_components cc
         JOIN menu_items mi
           ON mi.id = cc.component_menu_item_id
          AND mi.organization_id = cc.organization_id
        WHERE cc.organization_id = ? AND cc.combo_menu_item_id = ?
        ORDER BY cc.display_order, cc.id`,
      [organizationId, comboMenuItemId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      organizationId: Number(row.organization_id),
      comboMenuItemId: Number(row.combo_menu_item_id),
      componentMenuItemId: Number(row.component_menu_item_id),
      componentName: String(row.component_name),
      componentCategoryId: Number(row.component_category_id),
      quantity: Number(row.quantity),
      displayOrder: Number(row.display_order),
      isAvailable: Boolean(row.is_available),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  }

  public async setMenuComboComponents(
    comboMenuItemId: number,
    organizationId: number,
    components: Array<{ menuItemId: number; quantity: number }>,
  ): Promise<MenuComboComponent[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.setMenuComboComponents(comboMenuItemId, organizationId, components);
    }
    if (components.length < 2) {
      throw new BadRequestError('A combo needs at least two menu items', 'COMBO_COMPONENTS_REQUIRED');
    }
    const componentIds = components.map((component) => Number(component.menuItemId));
    if (new Set(componentIds).size !== componentIds.length) {
      throw new BadRequestError('A menu item can only appear once in a combo', 'COMBO_COMPONENT_DUPLICATE');
    }
    if (componentIds.includes(comboMenuItemId)) {
      throw new BadRequestError('A combo cannot contain itself', 'COMBO_COMPONENT_SELF_REFERENCE');
    }

    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [comboRows] = await conn.execute<RowDataPacket[]>(
        'SELECT id, is_combo FROM menu_items WHERE id = ? AND organization_id = ? FOR UPDATE',
        [comboMenuItemId, organizationId],
      );
      if (!comboRows.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
      if (!Boolean(comboRows[0].is_combo)) {
        throw new BadRequestError('Enable Combo on the menu item before adding components', 'MENU_ITEM_NOT_COMBO');
      }
      const placeholders = componentIds.map(() => '?').join(',');
      const [componentRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, is_combo FROM menu_items
          WHERE organization_id = ? AND id IN (${placeholders})
          FOR UPDATE`,
        [organizationId, ...componentIds],
      );
      if (componentRows.length !== componentIds.length) {
        throw new NotFoundError('One or more combo items were not found', 'COMBO_COMPONENT_NOT_FOUND');
      }
      if (componentRows.some((row) => Boolean(row.is_combo))) {
        throw new BadRequestError('Nested combos are not supported', 'COMBO_COMPONENT_NESTED_COMBO');
      }

      await conn.execute(
        'DELETE FROM menu_combo_components WHERE organization_id = ? AND combo_menu_item_id = ?',
        [organizationId, comboMenuItemId],
      );
      for (let index = 0; index < components.length; index += 1) {
        await conn.execute(
          `INSERT INTO menu_combo_components
            (organization_id, combo_menu_item_id, component_menu_item_id, quantity, display_order)
           VALUES (?, ?, ?, ?, ?)`,
          [organizationId, comboMenuItemId, components[index].menuItemId, components[index].quantity, index],
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    return this.getMenuComboComponents(comboMenuItemId, organizationId);
  }

  // ==========================================
  // AUTHORITATIVE BRANCH VAT PROFILE
  // ==========================================

  public async getBranchTaxConfig(organizationId: number, branchId: number): Promise<BranchTaxConfig | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getBranchTaxConfig(organizationId, branchId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM branch_tax_configs WHERE organization_id = ? AND branch_id = ?',
      [organizationId, branchId]
    );
    return rows.length > 0 ? mapBranchTaxConfigRow(rows[0]) : null;
  }

  public async upsertBranchTaxConfig(data: {
    organizationId: number;
    branchId: number;
    isVatRegistered: boolean;
    taxRegistrationNumber: string | null;
    vatRate: number;
    defaultPriceEntryMode: BranchTaxConfig['defaultPriceEntryMode'];
    roundingMethod: BranchTaxConfig['roundingMethod'];
  }): Promise<BranchTaxConfig> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.upsertBranchTaxConfig(data);
    }
    await this.pool().execute(
      `INSERT INTO branch_tax_configs
        (organization_id, branch_id, is_vat_registered, tax_registration_number, vat_rate,
         default_price_entry_mode, rounding_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_vat_registered = VALUES(is_vat_registered),
         tax_registration_number = VALUES(tax_registration_number),
         vat_rate = VALUES(vat_rate),
         default_price_entry_mode = VALUES(default_price_entry_mode),
         rounding_method = VALUES(rounding_method),
         updated_at = NOW()`,
      [
        data.organizationId, data.branchId, data.isVatRegistered, data.isVatRegistered ? data.taxRegistrationNumber : null,
        data.isVatRegistered ? 0.13 : 0, data.defaultPriceEntryMode, data.roundingMethod,
      ]
    );
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM branch_tax_configs WHERE organization_id = ? AND branch_id = ?',
      [data.organizationId, data.branchId]
    );
    return mapBranchTaxConfigRow(rows[0]);
  }

  // ==========================================
  // PAYMENT METHODS
  // ==========================================

  public async createPaymentMethod(data: {
    organizationId: number;
    branchId?: number | null;
    name: string;
    code: string;
    type?: PaymentMethod['type'];
    requiresReference?: boolean;
    isActive?: boolean;
    displayOrder?: number;
  }): Promise<PaymentMethod> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createPaymentMethod({ ...data, type: data.type || 'CASH' });
    }
    const [existingRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT id FROM payment_methods WHERE organization_id = ? AND UPPER(code) = UPPER(?)',
      [data.organizationId, data.code]
    );
    if (existingRows.length > 0) {
      throw new ConflictError(`Payment method code "${data.code}" already exists`, 'PAYMENT_DUPLICATE_CODE');
    }

    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO payment_methods (organization_id, branch_id, name, code, type, requires_reference, is_active, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.organizationId, data.branchId ?? null, data.name, data.code.toUpperCase(),
          data.type ?? 'CASH', data.requiresReference ?? false, data.isActive ?? true, data.displayOrder ?? 0,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM payment_methods WHERE id = ?', [result.insertId]
      );
      return mapPaymentMethodRow(rows[0]);
    } catch (err) {
      handleMysqlError(err, 'createPaymentMethod');
    }
  }

  public async findPaymentMethodById(id: number, organizationId: number): Promise<PaymentMethod | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findPaymentMethodById(id, organizationId);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM payment_methods WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return rows.length > 0 ? mapPaymentMethodRow(rows[0]) : null;
  }

  public async listPaymentMethods(organizationId: number, branchId?: number): Promise<PaymentMethod[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listPaymentMethods(organizationId, branchId);
    }
    if (branchId !== undefined) {
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        `SELECT * FROM payment_methods WHERE organization_id = ?
         AND (branch_id IS NULL OR branch_id = ?)
         ORDER BY display_order ASC, id ASC`,
        [organizationId, branchId]
      );
      return rows.map(mapPaymentMethodRow);
    }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM payment_methods WHERE organization_id = ? ORDER BY display_order ASC, id ASC',
      [organizationId]
    );
    return rows.map(mapPaymentMethodRow);
  }

  public async updatePaymentMethod(
    id: number,
    organizationId: number,
    updates: Partial<Pick<PaymentMethod, 'name' | 'code' | 'type' | 'requiresReference' | 'isActive' | 'displayOrder'>>
  ): Promise<PaymentMethod> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updatePaymentMethod(id, organizationId, updates);
    }
    const existing = await this.findPaymentMethodById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Payment method #${id} not found`, 'PAYMENT_METHOD_NOT_FOUND');
    }

    const name = updates.name ?? existing.name;
    const code = updates.code !== undefined ? updates.code.toUpperCase() : existing.code;
    const type = updates.type ?? existing.type;
    const requiresReference = updates.requiresReference ?? existing.requiresReference;
    const isActive = updates.isActive ?? existing.isActive;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;

    // No pre-check needed; uniqueness is enforced by database constraint and handled by handleMysqlError
    try {
      await this.pool().execute(
        `UPDATE payment_methods SET name = ?, code = ?, type = ?, requires_reference = ?, is_active = ?, display_order = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [name, code, type, requiresReference, isActive, displayOrder, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updatePaymentMethod');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM payment_methods WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapPaymentMethodRow(rows[0]);
  }

  public async deletePaymentMethod(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deletePaymentMethod(id, organizationId);
    }
    const pm = await this.findPaymentMethodById(id, organizationId);
    if (!pm) return false;

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM payment_methods WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // UNITS OF MEASURE (Platform Defaults + Org Customs)
  // ==========================================

  public async createUnit(data: {
    organizationId: number;
    name: string;
    symbol: string;
    dimension: UnitDimension;
    baseUnitSymbol: string;
    conversionFactor?: number;
    isActive?: boolean;
  }): Promise<UnitOfMeasure> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.createUnit(data);
    }
    await this.ensurePlatformUnits();

    // Check for duplicate symbol across platform + org
    const [existingRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT id FROM units_of_measure
       WHERE (organization_id IS NULL OR organization_id = ?) AND LOWER(symbol) = LOWER(?)`,
      [data.organizationId, data.symbol]
    );
    if (existingRows.length > 0) {
      throw new ConflictError(`Unit symbol "${data.symbol}" already exists`, 'UNIT_DUPLICATE_SYMBOL');
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      `INSERT INTO units_of_measure (organization_id, name, symbol, dimension, base_unit_symbol, conversion_factor, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.organizationId, data.name, data.symbol.toLowerCase(), data.dimension,
        data.baseUnitSymbol.toLowerCase(), data.conversionFactor ?? 1.0, data.isActive ?? true,
      ]
    );
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM units_of_measure WHERE id = ?', [result.insertId]
    );
    return mapUnitRow(rows[0]);
  }

  public async findUnitById(id: number, organizationId?: number): Promise<UnitOfMeasure | null> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.findUnitById(id, organizationId);
    }
    await this.ensurePlatformUnits();
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM units_of_measure WHERE id = ?', [id]
    );
    if (rows.length === 0) return null;
    const unit = mapUnitRow(rows[0]);
    if (unit.organizationId !== null && organizationId !== undefined && unit.organizationId !== organizationId) {
      return null;
    }
    return unit;
  }

  public async listUnits(organizationId?: number, dimension?: UnitDimension): Promise<UnitOfMeasure[]> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.listUnits(organizationId, dimension);
    }
    await this.ensurePlatformUnits();

    let sql: string;
    let params: (number | string)[];

    if (organizationId !== undefined) {
      if (dimension) {
        sql = 'SELECT * FROM units_of_measure WHERE (organization_id IS NULL OR organization_id = ?) AND dimension = ? ORDER BY id ASC';
        params = [organizationId, dimension];
      } else {
        sql = 'SELECT * FROM units_of_measure WHERE (organization_id IS NULL OR organization_id = ?) ORDER BY id ASC';
        params = [organizationId];
      }
    } else {
      if (dimension) {
        sql = 'SELECT * FROM units_of_measure WHERE dimension = ? ORDER BY id ASC';
        params = [dimension];
      } else {
        sql = 'SELECT * FROM units_of_measure ORDER BY id ASC';
        params = [];
      }
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(sql, params);
    return rows.map(mapUnitRow);
  }

  public async updateUnit(
    id: number,
    organizationId: number,
    updates: Partial<Pick<UnitOfMeasure, 'name' | 'symbol' | 'dimension' | 'baseUnitSymbol' | 'conversionFactor' | 'isActive'>>
  ): Promise<UnitOfMeasure> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.updateUnit(id, organizationId, updates);
    }
    const existing = await this.findUnitById(id, organizationId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError(`Custom unit #${id} not found`, 'UNIT_NOT_FOUND');
    }

    const name = updates.name ?? existing.name;
    const symbol = updates.symbol !== undefined ? updates.symbol.toLowerCase() : existing.symbol;
    const dimension = updates.dimension ?? existing.dimension;
    const baseUnitSymbol = updates.baseUnitSymbol !== undefined ? updates.baseUnitSymbol.toLowerCase() : existing.baseUnitSymbol;
    const conversionFactor = updates.conversionFactor ?? existing.conversionFactor;
    const isActive = updates.isActive ?? existing.isActive;

    // No pre-check needed; uniqueness is enforced by database constraint and handled by handleMysqlError
    try {
      await this.pool().execute(
        `UPDATE units_of_measure SET name = ?, symbol = ?, dimension = ?, base_unit_symbol = ?,
          conversion_factor = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ?`,
        [name, symbol, dimension, baseUnitSymbol, conversionFactor, isActive, id, organizationId]
      );
    } catch (err) {
      handleMysqlError(err, 'updateUnit');
    }

    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM units_of_measure WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return mapUnitRow(rows[0]);
  }

  public async deleteUnit(id: number, organizationId: number): Promise<boolean> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.deleteUnit(id, organizationId);
    }
    const unit = await this.findUnitById(id, organizationId);
    if (!unit || unit.organizationId !== organizationId) return false;

    const [result] = await this.pool().execute<ResultSetHeader>(
      'DELETE FROM units_of_measure WHERE id = ? AND organization_id = ?', [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  // ==========================================
  // OPERATIONAL SETTINGS
  // ==========================================

  public async getOperationalSettings(organizationId: number, branchId?: number | null): Promise<OperationalSettings> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.getOperationalSettings(organizationId, branchId);
    }
    // Try branch-specific first
    if (branchId) {
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM operational_settings WHERE organization_id = ? AND branch_id = ?',
        [organizationId, branchId]
      );
      if (rows.length > 0) return mapOperationalSettingsRow(rows[0]);
    }

    // Fall back to org-level
    const [orgRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM operational_settings WHERE organization_id = ? AND branch_id IS NULL',
      [organizationId]
    );
    if (orgRows.length > 0) return mapOperationalSettingsRow(orgRows[0]);

    // Return hardcoded defaults
    const now = new Date().toISOString();
    return {
      id: 0,
      organizationId,
      branchId: branchId ?? null,
      openingTime: '08:00',
      closingTime: '23:00',
      operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      dineInEnabled: true,
      takeawayEnabled: true,
      deliveryEnabled: false,
      receiptHeader: null,
      receiptFooter: 'Thank you for dining with us!',
      currencySymbol: 'रू',
      autoPrintKot: true,
      autoPrintBill: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async upsertOperationalSettings(
    organizationId: number,
    branchId: number | null,
    updates: Partial<Omit<OperationalSettings, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>>
  ): Promise<OperationalSettings> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.upsertOperationalSettings({ organizationId, branchId, ...updates });
    }
    const current = await this.getOperationalSettings(organizationId, branchId);

    const openingTime = updates.openingTime ?? current.openingTime;
    const closingTime = updates.closingTime ?? current.closingTime;
    const operatingDays = updates.operatingDays ?? current.operatingDays;
    const dineInEnabled = updates.dineInEnabled !== undefined ? updates.dineInEnabled : current.dineInEnabled;
    const takeawayEnabled = updates.takeawayEnabled !== undefined ? updates.takeawayEnabled : current.takeawayEnabled;
    const deliveryEnabled = updates.deliveryEnabled !== undefined ? updates.deliveryEnabled : current.deliveryEnabled;
    const receiptHeader = updates.receiptHeader !== undefined ? updates.receiptHeader : current.receiptHeader;
    const receiptFooter = updates.receiptFooter !== undefined ? updates.receiptFooter : current.receiptFooter;
    const currencySymbol = updates.currencySymbol ?? current.currencySymbol;
    const autoPrintKot = updates.autoPrintKot !== undefined ? updates.autoPrintKot : current.autoPrintKot;
    const autoPrintBill = updates.autoPrintBill !== undefined ? updates.autoPrintBill : current.autoPrintBill;
    const operatingDaysJson = JSON.stringify(operatingDays);

    if (current.id > 0) {
      await this.pool().execute(
        `UPDATE operational_settings SET
          opening_time = ?, closing_time = ?, operating_days = ?,
          dine_in_enabled = ?, takeaway_enabled = ?, delivery_enabled = ?,
          receipt_header = ?, receipt_footer = ?, currency_symbol = ?,
          auto_print_kot = ?, auto_print_bill = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          openingTime, closingTime, operatingDaysJson,
          dineInEnabled, takeawayEnabled, deliveryEnabled,
          receiptHeader, receiptFooter, currencySymbol,
          autoPrintKot, autoPrintBill, current.id,
        ]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM operational_settings WHERE id = ?', [current.id]
      );
      return mapOperationalSettingsRow(rows[0]);
    }

    const [result] = await this.pool().execute<ResultSetHeader>(
      `INSERT INTO operational_settings
        (organization_id, branch_id, opening_time, closing_time, operating_days,
         dine_in_enabled, takeaway_enabled, delivery_enabled,
         receipt_header, receipt_footer, currency_symbol,
         auto_print_kot, auto_print_bill)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        organizationId, branchId, openingTime, closingTime, operatingDaysJson,
        dineInEnabled, takeawayEnabled, deliveryEnabled,
        receiptHeader, receiptFooter, currencySymbol,
        autoPrintKot, autoPrintBill,
      ]
    );
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT * FROM operational_settings WHERE id = ?', [result.insertId]
    );
    return mapOperationalSettingsRow(rows[0]);
  }

  // ==========================================
  // AUTOMATED BASELINE SEEDER
  // ==========================================

  public async seedOrganizationDefaults(organizationId: number): Promise<void> {
    if (!(await this.canUseDatabase())) return;

    await this.ensurePlatformUnits();
    const conn: PoolConnection = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const paymentMethods = [
        { name: 'Cash', code: 'CASH', type: 'CASH', requiresReference: false, displayOrder: 1 },
        { name: 'Credit / Debit Card', code: 'CARD', type: 'CREDIT_CARD', requiresReference: true, displayOrder: 2 },
        { name: 'Fonepay QR', code: 'QR_FONEPAY', type: 'QR_CODE', requiresReference: true, displayOrder: 3 },
      ] as const;

      for (const method of paymentMethods) {
        await conn.execute(
          `INSERT INTO payment_methods
            (organization_id, branch_id, name, code, type, requires_reference, is_active, display_order)
           SELECT ?, NULL, ?, ?, ?, ?, TRUE, ?
           FROM DUAL
           WHERE NOT EXISTS (
             SELECT 1 FROM payment_methods WHERE organization_id = ? AND code = ? LIMIT 1
           )`,
          [
            organizationId,
            method.name,
            method.code,
            method.type,
            method.requiresReference,
            method.displayOrder,
            organizationId,
            method.code,
          ]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  public async seedBranchDefaults(
    organizationId: number,
    branchId: number,
    openedByUserId?: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.seedOrganizationBaseline(organizationId, branchId);
    }

    const conn: PoolConnection = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [branchRows] = await conn.execute<RowDataPacket[]>(
        'SELECT id, timezone FROM branches WHERE id = ? AND organization_id = ? LIMIT 1',
        [branchId, organizationId]
      );
      if (!branchRows.length) {
        throw new NotFoundError(`Branch #${branchId} not found`, 'BRANCH_NOT_FOUND');
      }

      // Nepal VAT is 13% only after the restaurant explicitly marks the branch as VAT registered.
      await conn.execute(
        `INSERT INTO branch_tax_configs
          (organization_id, branch_id, is_vat_registered, tax_registration_number, vat_rate,
           default_price_entry_mode, rounding_method)
         VALUES (?, ?, FALSE, NULL, 0, 'VAT_INCLUDED', 'HALF_EVEN')
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [organizationId, branchId]
      );

      const [floorCount] = await conn.execute<RowDataPacket[]>(
        'SELECT COUNT(*) AS cnt FROM floors WHERE organization_id = ? AND branch_id = ?',
        [organizationId, branchId]
      );
      if (Number(floorCount[0]?.cnt || 0) === 0) {
        const [floorResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO floors (organization_id, branch_id, name, display_order, is_active)
           VALUES (?, ?, 'Ground Floor', 1, TRUE)`,
          [organizationId, branchId]
        );
        const floorId = Number(floorResult.insertId);

        const [sectionResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO sections (organization_id, branch_id, floor_id, name, display_order, is_active)
           VALUES (?, ?, ?, 'Main Dining Hall', 1, TRUE)`,
          [organizationId, branchId, floorId]
        );
        const sectionId = Number(sectionResult.insertId);

        for (let i = 1; i <= 4; i += 1) {
          await conn.execute(
            `INSERT INTO dining_tables
              (organization_id, branch_id, floor_id, section_id, table_number, capacity, status,
               pos_x, pos_y, width, height, shape, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 'available', ?, 20, 100, 100, 'square', TRUE)`,
            [
              organizationId,
              branchId,
              floorId,
              sectionId,
              `T-0${i}`,
              i === 4 ? 6 : 4,
              (i - 1) * 120 + 20,
            ]
          );
        }
      }

      await conn.execute(
        `INSERT INTO preparation_stations
          (organization_id, branch_id, name, type, is_active)
         SELECT ?, ?, 'Main Kitchen', 'kitchen', TRUE
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM preparation_stations
           WHERE organization_id = ? AND branch_id = ? AND name = 'Main Kitchen'
           LIMIT 1
         )`,
        [organizationId, branchId, organizationId, branchId]
      );

      const operatingDays = JSON.stringify(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      await conn.execute(
        `INSERT INTO operational_settings
          (organization_id, branch_id, opening_time, closing_time, operating_days,
           dine_in_enabled, takeaway_enabled, delivery_enabled,
           receipt_header, receipt_footer, currency_symbol,
           auto_print_kot, auto_print_bill)
         VALUES (?, ?, '08:00', '23:00', ?, TRUE, TRUE, FALSE, NULL, NULL, 'रू', TRUE, TRUE)
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [organizationId, branchId, operatingDays]
      );

      await conn.execute(
        `INSERT INTO registers (organization_id, branch_id, name, code, is_active)
         VALUES (?, ?, 'Main Counter', 'POS-01', TRUE)
         ON DUPLICATE KEY UPDATE is_active = TRUE, updated_at = NOW()`,
        [organizationId, branchId]
      );

      let openerId = openedByUserId;
      if (openerId) {
        const [openerRows] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM users WHERE id = ? AND organization_id = ? LIMIT 1',
          [openerId, organizationId]
        );
        if (!openerRows.length) openerId = undefined;
      }
      if (!openerId) {
        const [openerRows] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM users WHERE organization_id = ? ORDER BY id ASC LIMIT 1',
          [organizationId]
        );
        openerId = openerRows.length ? Number(openerRows[0].id) : undefined;
      }

      if (openerId) {
        const timezone = String(branchRows[0]?.timezone || 'Asia/Kathmandu');
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date());
        const part = (type: string) => parts.find(value => value.type === type)?.value;
        const businessDate = `${part('year')}-${part('month')}-${part('day')}`;

        await conn.execute(
          `INSERT INTO business_days
            (organization_id, branch_id, business_date, status, opened_by, notes)
           VALUES (?, ?, ?, 'OPEN', ?, 'Initial operational business day')
           ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [organizationId, branchId, businessDate, openerId]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  public async seedOrganizationBaseline(
    organizationId: number,
    branchId: number,
    openedByUserId?: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) {
      return this.memoryStore.seedOrganizationBaseline(organizationId, branchId);
    }
    await this.seedOrganizationDefaults(organizationId);
    await this.seedBranchDefaults(organizationId, branchId, openedByUserId);
  }

  public async seedStarterSamples(
    organizationId: number,
    branchId: number,
    ownerUserId: number
  ): Promise<void> {
    if (!(await this.canUseDatabase())) return;

    await this.seedOrganizationDefaults(organizationId);
    await this.seedBranchDefaults(organizationId, branchId, ownerUserId);

    const conn: PoolConnection = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [orgRows] = await conn.execute<RowDataPacket[]>(
        'SELECT handle, settings FROM organizations WHERE id = ? FOR UPDATE',
        [organizationId]
      );
      if (!orgRows.length) throw new NotFoundError('Restaurant not found', 'ORGANIZATION_NOT_FOUND');
      const handle = String(orgRows[0].handle || 'rms').toLowerCase();

      const [stationRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM preparation_stations
         WHERE organization_id = ? AND branch_id = ? AND name = 'Main Kitchen'
         LIMIT 1`,
        [organizationId, branchId]
      );
      const mainKitchenId = stationRows.length ? Number(stationRows[0].id) : null;

      const departmentIds: number[] = [];
      const ensureDepartment = async (name: string, code: string, displayOrder: number): Promise<number> => {
        const [existing] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM departments WHERE organization_id = ? AND (code = ? OR name = ?) ORDER BY id LIMIT 1',
          [organizationId, code, name]
        );
        if (existing.length) return Number(existing[0].id);
        const [insert] = await conn.execute<ResultSetHeader>(
          `INSERT INTO departments
            (organization_id, branch_id, name, code, description, display_order, is_active)
           VALUES (?, NULL, ?, ?, ?, ?, TRUE)`,
          [organizationId, name, code, 'Starter department created by RMS', displayOrder]
        );
        return Number(insert.insertId);
      };

      const foodDepartmentId = await ensureDepartment('Food', 'FOOD', 1);
      const beverageDepartmentId = await ensureDepartment('Beverage', 'BEVERAGE', 2);
      departmentIds.push(foodDepartmentId, beverageDepartmentId);

      const categoryIds: number[] = [];
      const ensureCategory = async (name: string, displayOrder: number): Promise<number> => {
        const [existing] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM menu_categories WHERE organization_id = ? AND name = ? LIMIT 1',
          [organizationId, name]
        );
        if (existing.length) return Number(existing[0].id);
        const [insert] = await conn.execute<ResultSetHeader>(
          `INSERT INTO menu_categories
            (organization_id, parent_id, name, station_id, display_order, image_url, is_active)
           VALUES (?, NULL, ?, ?, ?, NULL, TRUE)`,
          [organizationId, name, mainKitchenId, displayOrder]
        );
        return Number(insert.insertId);
      };

      const categoryMap = new Map<string, number>();
      for (const [index, name] of ['Momo', 'Main Course', 'Snacks', 'Beverages', 'Hot Drinks', 'Desserts'].entries()) {
        const id = await ensureCategory(name, index + 1);
        categoryMap.set(name, id);
        categoryIds.push(id);
      }

      type StarterMenuItem = {
        name: string;
        category: string;
        price: number;
        departmentId: number;
        prepTimeMinutes: number;
        description: string;
      };
      const starterItems: StarterMenuItem[] = [
        { name: 'Chicken Momo', category: 'Momo', price: 180, departmentId: foodDepartmentId, prepTimeMinutes: 12, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Buff Momo', category: 'Momo', price: 160, departmentId: foodDepartmentId, prepTimeMinutes: 12, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Veg Momo', category: 'Momo', price: 140, departmentId: foodDepartmentId, prepTimeMinutes: 12, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Chicken Chowmein', category: 'Main Course', price: 200, departmentId: foodDepartmentId, prepTimeMinutes: 15, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Veg Chowmein', category: 'Main Course', price: 160, departmentId: foodDepartmentId, prepTimeMinutes: 15, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Chicken Fried Rice', category: 'Main Course', price: 220, departmentId: foodDepartmentId, prepTimeMinutes: 15, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Dal Bhat Set', category: 'Main Course', price: 350, departmentId: foodDepartmentId, prepTimeMinutes: 20, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'French Fries', category: 'Snacks', price: 150, departmentId: foodDepartmentId, prepTimeMinutes: 8, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Chicken Burger', category: 'Snacks', price: 280, departmentId: foodDepartmentId, prepTimeMinutes: 12, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Coke', category: 'Beverages', price: 100, departmentId: beverageDepartmentId, prepTimeMinutes: 1, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Mineral Water', category: 'Beverages', price: 50, departmentId: beverageDepartmentId, prepTimeMinutes: 1, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Milk Tea', category: 'Hot Drinks', price: 60, departmentId: beverageDepartmentId, prepTimeMinutes: 5, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Black Coffee', category: 'Hot Drinks', price: 100, departmentId: beverageDepartmentId, prepTimeMinutes: 5, description: 'Starter sample item — edit or replace with your own menu.' },
        { name: 'Ice Cream', category: 'Desserts', price: 150, departmentId: foodDepartmentId, prepTimeMinutes: 3, description: 'Starter sample item — edit or replace with your own menu.' },
      ];

      const menuItemIds: number[] = [];
      const menuItemByName = new Map<string, number>();
      const ensureMenuItem = async (item: StarterMenuItem): Promise<number> => {
        const [existing] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM menu_items WHERE organization_id = ? AND name = ? ORDER BY id LIMIT 1',
          [organizationId, item.name]
        );
        if (existing.length) return Number(existing[0].id);
        const categoryId = categoryMap.get(item.category);
        if (!categoryId) throw new Error(`Starter category missing: ${item.category}`);
        const [insert] = await conn.execute<ResultSetHeader>(
          `INSERT INTO menu_items
            (organization_id, category_id, default_prep_station_id, department_id, prep_time_minutes,
             name, sku, description, entered_price, price_entry_mode, cost_price, image_url, is_available, is_combo)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'VAT_INCLUDED', 0, NULL, TRUE, FALSE)`,
          [
            organizationId,
            categoryId,
            mainKitchenId,
            item.departmentId,
            item.prepTimeMinutes,
            item.name,
            item.description,
            item.price,
          ]
        );
        return Number(insert.insertId);
      };

      for (const item of starterItems) {
        const id = await ensureMenuItem(item);
        menuItemIds.push(id);
        menuItemByName.set(item.name, id);
      }

      const comboName = 'Lunch Combo';
      let comboId: number;
      const [existingCombo] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM menu_items WHERE organization_id = ? AND name = ? ORDER BY id LIMIT 1',
        [organizationId, comboName]
      );
      if (existingCombo.length) {
        comboId = Number(existingCombo[0].id);
      } else {
        const [comboInsert] = await conn.execute<ResultSetHeader>(
          `INSERT INTO menu_items
            (organization_id, category_id, default_prep_station_id, department_id, prep_time_minutes,
             name, sku, description, entered_price, price_entry_mode, cost_price, image_url, is_available, is_combo)
           VALUES (?, ?, NULL, ?, NULL, ?, NULL, ?, 399, 'VAT_INCLUDED', 0, NULL, TRUE, TRUE)`,
          [
            organizationId,
            categoryMap.get('Main Course'),
            foodDepartmentId,
            comboName,
            'Starter combo: Chicken Momo + French Fries + Coke.',
          ]
        );
        comboId = Number(comboInsert.insertId);
      }

      for (const componentName of ['Chicken Momo', 'French Fries', 'Coke']) {
        const componentId = menuItemByName.get(componentName);
        if (!componentId) continue;
        await conn.execute(
          `INSERT INTO menu_combo_components
            (organization_id, combo_menu_item_id, component_menu_item_id, quantity, display_order)
           VALUES (?, ?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), display_order = VALUES(display_order)`,
          [organizationId, comboId, componentId, ['Chicken Momo', 'French Fries', 'Coke'].indexOf(componentName) + 1]
        );
      }

      const stockItemIds: number[] = [];
      const ensureStockItem = async (name: string, quantity: number): Promise<number> => {
        const [existing] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM stock_items WHERE organization_id = ? AND branch_id = ? AND name = ? LIMIT 1',
          [organizationId, branchId, name]
        );
        if (existing.length) return Number(existing[0].id);
        const [insert] = await conn.execute<ResultSetHeader>(
          `INSERT INTO stock_items
            (organization_id, branch_id, name, image_url, current_quantity, package_name, package_size,
             low_threshold, critical_threshold, is_active, created_by, updated_by)
           VALUES (?, ?, ?, NULL, ?, NULL, NULL, 8, 4, TRUE, ?, ?)`,
          [organizationId, branchId, name, quantity, ownerUserId, ownerUserId]
        );
        return Number(insert.insertId);
      };

      const cokeStockId = await ensureStockItem('Coke', 24);
      const waterStockId = await ensureStockItem('Mineral Water', 36);
      stockItemIds.push(cokeStockId, waterStockId);

      const stockLinks: Array<[number | undefined, number]> = [
        [menuItemByName.get('Coke'), cokeStockId],
        [menuItemByName.get('Mineral Water'), waterStockId],
      ];
      for (const [menuItemId, stockItemId] of stockLinks) {
        if (!menuItemId) continue;
        await conn.execute(
          `INSERT INTO stock_dependencies
            (organization_id, branch_id, menu_item_id, stock_item_id, quantity_required, created_by)
           VALUES (?, ?, ?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE quantity_required = VALUES(quantity_required), updated_at = NOW()`,
          [organizationId, branchId, menuItemId, stockItemId, ownerUserId]
        );
      }

      const staffUserIds: number[] = [];
      const sampleStaff = [
        { name: 'Example Manager', local: 'examplemanager', role: 'FB_MANAGER' },
        { name: 'Example Cashier', local: 'examplecashier', role: 'CASHIER' },
        { name: 'Example Waiter', local: 'examplewaiter', role: 'WAITER' },
        { name: 'Example Chef', local: 'examplechef', role: 'CHEF' },
      ];

      for (const staff of sampleStaff) {
        const username = `${handle}-${staff.local}`;
        const [existing] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM users WHERE organization_id = ? AND username = ? LIMIT 1',
          [organizationId, username]
        );
        let userId: number;
        if (existing.length) {
          userId = Number(existing[0].id);
        } else {
          const [roleRows] = await conn.execute<RowDataPacket[]>(
            `SELECT id FROM roles
             WHERE name = ? AND (organization_id IS NULL OR organization_id = ?)
             ORDER BY organization_id IS NOT NULL DESC LIMIT 1`,
            [staff.role, organizationId]
          );
          if (!roleRows.length) continue;
          const [insert] = await conn.execute<ResultSetHeader>(
            `INSERT INTO users
              (organization_id, default_branch_id, role_id, name, username, email, phone,
               password_hash, pin_hash, avatar_url, is_active, must_change_pin)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE)`,
            [organizationId, branchId, Number(roleRows[0].id), staff.name, username]
          );
          userId = Number(insert.insertId);
        }
        staffUserIds.push(userId);
        await conn.execute(
          `INSERT IGNORE INTO user_branches (user_id, branch_id, organization_id)
           VALUES (?, ?, ?)`,
          [userId, branchId, organizationId]
        );
      }

      let settings: Record<string, any> = {};
      const rawSettings = orgRows[0].settings;
      if (rawSettings && typeof rawSettings === 'object') settings = { ...rawSettings };
      else if (typeof rawSettings === 'string') {
        try { settings = JSON.parse(rawSettings || '{}'); } catch { settings = {}; }
      }
      const previous = settings.starterPack && typeof settings.starterPack === 'object'
        ? settings.starterPack
        : {};

      settings.starterPack = {
        ...previous,
        version: 1,
        welcomePending: previous.version ? Boolean(previous.welcomePending) : true,
        sampleDataPresent: true,
        seededAt: previous.seededAt || new Date().toISOString(),
        sampleIds: {
          departmentIds: Array.from(new Set(departmentIds)),
          categoryIds: Array.from(new Set(categoryIds)),
          menuItemIds: Array.from(new Set(menuItemIds)),
          comboItemIds: [comboId],
          stockItemIds: Array.from(new Set(stockItemIds)),
          staffUserIds: Array.from(new Set(staffUserIds)),
        },
      };

      await conn.execute(
        'UPDATE organizations SET settings = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(settings), organizationId]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  public async dismissStarterWelcome(organizationId: number): Promise<void> {
    if (!(await this.canUseDatabase())) return;
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT settings FROM organizations WHERE id = ? LIMIT 1',
      [organizationId]
    );
    if (!rows.length) throw new NotFoundError('Restaurant not found', 'ORGANIZATION_NOT_FOUND');

    let settings: Record<string, any> = {};
    const raw = rows[0].settings;
    if (raw && typeof raw === 'object') settings = { ...raw };
    else if (typeof raw === 'string') {
      try { settings = JSON.parse(raw || '{}'); } catch { settings = {}; }
    }
    const starterPack = settings.starterPack && typeof settings.starterPack === 'object'
      ? settings.starterPack
      : {};
    settings.starterPack = { ...starterPack, welcomePending: false };

    await this.pool().execute(
      'UPDATE organizations SET settings = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(settings), organizationId]
    );
  }

  public async removeStarterSamples(organizationId: number): Promise<{
    removedMenuItems: number;
    archivedMenuItems: number;
    removedStockItems: number;
    archivedStockItems: number;
    removedStaff: number;
  }> {
    if (!(await this.canUseDatabase())) {
      return { removedMenuItems: 0, archivedMenuItems: 0, removedStockItems: 0, archivedStockItems: 0, removedStaff: 0 };
    }

    const conn: PoolConnection = await this.pool().getConnection();
    const result = {
      removedMenuItems: 0,
      archivedMenuItems: 0,
      removedStockItems: 0,
      archivedStockItems: 0,
      removedStaff: 0,
    };

    try {
      await conn.beginTransaction();
      const [orgRows] = await conn.execute<RowDataPacket[]>(
        'SELECT settings FROM organizations WHERE id = ? FOR UPDATE',
        [organizationId]
      );
      if (!orgRows.length) throw new NotFoundError('Restaurant not found', 'ORGANIZATION_NOT_FOUND');

      let settings: Record<string, any> = {};
      const raw = orgRows[0].settings;
      if (raw && typeof raw === 'object') settings = { ...raw };
      else if (typeof raw === 'string') {
        try { settings = JSON.parse(raw || '{}'); } catch { settings = {}; }
      }
      const starterPack = settings.starterPack && typeof settings.starterPack === 'object'
        ? settings.starterPack
        : {};
      const ids = starterPack.sampleIds && typeof starterPack.sampleIds === 'object'
        ? starterPack.sampleIds
        : {};

      const numberIds = (value: unknown): number[] =>
        Array.isArray(value)
          ? value.map(Number).filter(id => Number.isInteger(id) && id > 0)
          : [];

      const comboIds = numberIds(ids.comboItemIds);
      const menuIds = numberIds(ids.menuItemIds);
      const stockIds = numberIds(ids.stockItemIds);
      const staffIds = numberIds(ids.staffUserIds);
      const categoryIds = numberIds(ids.categoryIds);
      const departmentIds = numberIds(ids.departmentIds);

      for (const id of comboIds) {
        try {
          const [deleted] = await conn.execute<ResultSetHeader>(
            'DELETE FROM menu_items WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
          result.removedMenuItems += Number(deleted.affectedRows || 0);
        } catch {
          await conn.execute(
            'UPDATE menu_items SET is_available = FALSE, updated_at = NOW() WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
          result.archivedMenuItems += 1;
        }
      }

      for (const id of menuIds) {
        try {
          const [deleted] = await conn.execute<ResultSetHeader>(
            'DELETE FROM menu_items WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
          result.removedMenuItems += Number(deleted.affectedRows || 0);
        } catch {
          await conn.execute(
            'UPDATE menu_items SET is_available = FALSE, updated_at = NOW() WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
          result.archivedMenuItems += 1;
        }
      }

      for (const id of stockIds) {
        try {
          const [deleted] = await conn.execute<ResultSetHeader>(
            'DELETE FROM stock_items WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
          result.removedStockItems += Number(deleted.affectedRows || 0);
        } catch {
          await conn.execute(
            'UPDATE stock_items SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
          result.archivedStockItems += 1;
        }
      }

      for (const id of staffIds) {
        try {
          const [deleted] = await conn.execute<ResultSetHeader>(
            'DELETE FROM users WHERE id = ? AND organization_id = ? AND is_active = FALSE',
            [id, organizationId]
          );
          result.removedStaff += Number(deleted.affectedRows || 0);
        } catch {
          // If an example account was later used, preserve history and leave it inactive.
          await conn.execute(
            'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
        }
      }

      for (const id of categoryIds) {
        try {
          await conn.execute(
            'DELETE FROM menu_categories WHERE id = ? AND organization_id = ?',
            [id, organizationId]
          );
        } catch {
          // A restaurant may have intentionally reused a starter category for real items.
        }
      }

      for (const id of departmentIds) {
        await conn.execute(
          `DELETE FROM departments
           WHERE id = ? AND organization_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM menu_items WHERE organization_id = ? AND department_id = ?
             )`,
          [id, organizationId, organizationId, id]
        );
      }

      settings.starterPack = {
        ...starterPack,
        welcomePending: false,
        sampleDataPresent: false,
        removedAt: new Date().toISOString(),
      };
      await conn.execute(
        'UPDATE organizations SET settings = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(settings), organizationId]
      );

      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

}

export const administrationRepository = new AdministrationRepository();

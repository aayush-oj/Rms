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
import { BadRequestError, ConflictError, NotFoundError, ForbiddenError } from '../../shared/errors';

export const DEFAULT_PLATFORM_UNITS: Omit<UnitOfMeasure, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>[] = [
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

export class AdministrationMemoryStore {
  private memoryFloors = new Map<number, Floor>();
  private memorySections = new Map<number, Section>();
  private memoryTables = new Map<number, DiningTable>();
  private memoryPrinters = new Map<number, HardwarePrinter>();
  private memoryStations = new Map<number, PreparationStation>();
  private memoryBranchTaxConfigs = new Map<string, BranchTaxConfig>(); // key: `${orgId}:${branchId}`
  private memoryPaymentMethods = new Map<number, PaymentMethod>();
  private memoryUnits = new Map<number, UnitOfMeasure>();
  private memoryOperationalSettings = new Map<string, OperationalSettings>(); // key: `${orgId}:${branchId || 0}`
  private memoryMenuCategories = new Map<number, MenuCategory>();
  private memoryMenuItems = new Map<number, MenuItem>();
  private memoryMenuComboComponents = new Map<number, MenuComboComponent[]>();

  private nextFloorId = 1;
  private nextSectionId = 1;
  private nextTableId = 1;
  private nextPrinterId = 1;
  private nextStationId = 1;
  private nextBranchTaxConfigId = 1;
  private nextPaymentMethodId = 1;
  private nextUnitId = 1;
  private nextOperationalSettingsId = 1;
  private nextMenuCategoryId = 1;
  private nextMenuItemId = 1;
  private nextMenuComboComponentId = 1;

  constructor() {
    this.ensurePlatformUnits();
  }

  public ensurePlatformUnits(): void {
    if (this.memoryUnits.size === 0) {
      const now = new Date().toISOString();
      for (const u of DEFAULT_PLATFORM_UNITS) {
        const id = this.nextUnitId++;
        this.memoryUnits.set(id, {
          id,
          organizationId: null,
          name: u.name,
          symbol: u.symbol,
          dimension: u.dimension,
          baseUnitSymbol: u.baseUnitSymbol,
          conversionFactor: u.conversionFactor,
          isActive: u.isActive,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
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
    for (const f of this.memoryFloors.values()) {
      if (
        f.organizationId === data.organizationId &&
        f.branchId === data.branchId &&
        f.name.toLowerCase() === data.name.toLowerCase()
      ) {
        throw new ConflictError('Floor name already exists in this branch', 'FLOOR_DUPLICATE_NAME');
      }
    }
    const id = this.nextFloorId++;
    const now = new Date().toISOString();
    const floor: Floor = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId,
      name: data.name,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryFloors.set(id, floor);
    return { ...floor };
  }

  public async findFloorById(id: number, organizationId: number): Promise<Floor | null> {
    const f = this.memoryFloors.get(id);
    return f && f.organizationId === organizationId ? { ...f } : null;
  }

  public async listFloorsByBranch(organizationId: number, branchId: number): Promise<Floor[]> {
    return Array.from(this.memoryFloors.values())
      .filter((f) => f.organizationId === organizationId && f.branchId === branchId)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id)
      .map((f) => ({ ...f }));
  }

  public async updateFloor(
    id: number,
    organizationId: number,
    updates: Partial<Pick<Floor, 'name' | 'displayOrder' | 'isActive'>>
  ): Promise<Floor> {
    const existing = await this.findFloorById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Floor #${id} not found`, 'FLOOR_NOT_FOUND');
    }
    if (updates.name && updates.name.toLowerCase() !== existing.name.toLowerCase()) {
      for (const f of this.memoryFloors.values()) {
        if (
          f.id !== id &&
          f.organizationId === organizationId &&
          f.branchId === existing.branchId &&
          f.name.toLowerCase() === updates.name.toLowerCase()
        ) {
          throw new ConflictError('Floor name already exists in this branch', 'FLOOR_DUPLICATE_NAME');
        }
      }
    }
    const updated: Floor = {
      ...existing,
      name: updates.name ?? existing.name,
      displayOrder: updates.displayOrder ?? existing.displayOrder,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memoryFloors.set(id, updated);
    return { ...updated };
  }

  public async deleteFloor(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findFloorById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Floor #${id} not found`, 'FLOOR_NOT_FOUND');
    }
    const hasSections = Array.from(this.memorySections.values()).some((s) => s.floorId === id);
    if (hasSections) {
      throw new ConflictError('Cannot delete floor with existing sections', 'FLOOR_HAS_SECTIONS');
    }
    this.memoryFloors.delete(id);
    return true;
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
    const floor = await this.findFloorById(data.floorId, data.organizationId);
    if (!floor) {
      throw new NotFoundError(`Floor #${data.floorId} not found`, 'FLOOR_NOT_FOUND');
    }
    for (const s of this.memorySections.values()) {
      if (
        s.organizationId === data.organizationId &&
        s.floorId === data.floorId &&
        s.name.toLowerCase() === data.name.toLowerCase()
      ) {
        throw new ConflictError('Section name already exists on this floor', 'SECTION_DUPLICATE_NAME');
      }
    }
    const id = this.nextSectionId++;
    const now = new Date().toISOString();
    const section: Section = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId,
      floorId: data.floorId,
      name: data.name,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memorySections.set(id, section);
    return { ...section };
  }

  public async findSectionById(id: number, organizationId: number): Promise<Section | null> {
    const s = this.memorySections.get(id);
    return s && s.organizationId === organizationId ? { ...s } : null;
  }

  public async listSectionsByBranch(
    organizationId: number,
    branchId: number,
    floorId?: number
  ): Promise<Section[]> {
    return Array.from(this.memorySections.values())
      .filter((s) => {
        if (s.organizationId !== organizationId || s.branchId !== branchId) return false;
        if (floorId !== undefined && s.floorId !== floorId) return false;
        return true;
      })
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id)
      .map((s) => ({ ...s }));
  }

  public async updateSection(
    id: number,
    organizationId: number,
    updates: Partial<Pick<Section, 'floorId' | 'name' | 'displayOrder' | 'isActive'>>
  ): Promise<Section> {
    const existing = await this.findSectionById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Section #${id} not found`, 'SECTION_NOT_FOUND');
    }
    const targetFloorId = updates.floorId ?? existing.floorId;
    if (updates.floorId !== undefined && updates.floorId !== existing.floorId) {
      const floor = await this.findFloorById(updates.floorId, organizationId);
      if (!floor) {
        throw new NotFoundError(`Floor #${updates.floorId} not found`, 'FLOOR_NOT_FOUND');
      }
    }
    if (updates.name && updates.name.toLowerCase() !== existing.name.toLowerCase()) {
      for (const s of this.memorySections.values()) {
        if (
          s.id !== id &&
          s.organizationId === organizationId &&
          s.floorId === targetFloorId &&
          s.name.toLowerCase() === updates.name.toLowerCase()
        ) {
          throw new ConflictError('Section name already exists on this floor', 'SECTION_DUPLICATE_NAME');
        }
      }
    }
    const updated: Section = {
      ...existing,
      floorId: targetFloorId,
      name: updates.name ?? existing.name,
      displayOrder: updates.displayOrder ?? existing.displayOrder,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memorySections.set(id, updated);
    return { ...updated };
  }

  public async deleteSection(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findSectionById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Section #${id} not found`, 'SECTION_NOT_FOUND');
    }
    const hasTables = Array.from(this.memoryTables.values()).some((t) => t.sectionId === id);
    if (hasTables) {
      throw new ConflictError('Cannot delete section with existing tables', 'SECTION_HAS_TABLES');
    }
    this.memorySections.delete(id);
    return true;
  }

  // ==========================================
  // TABLES
  // ==========================================

  public async createTable(data: {
    organizationId: number;
    branchId: number;
    floorId: number;
    sectionId: number;
    tableNumber: string;
    capacity: number;
    shape?: DiningTable['shape'];
    posX?: number;
    posY?: number;
    width?: number;
    height?: number;
    isActive?: boolean;
  }): Promise<DiningTable> {
    const floor = await this.findFloorById(data.floorId, data.organizationId);
    if (!floor) {
      throw new NotFoundError(`Floor #${data.floorId} not found`, 'FLOOR_NOT_FOUND');
    }
    const section = await this.findSectionById(data.sectionId, data.organizationId);
    if (!section) {
      throw new NotFoundError(`Section #${data.sectionId} not found`, 'SECTION_NOT_FOUND');
    }
    for (const t of this.memoryTables.values()) {
      if (
        t.organizationId === data.organizationId &&
        t.branchId === data.branchId &&
        t.tableNumber.toLowerCase() === data.tableNumber.toLowerCase()
      ) {
        throw new ConflictError('Table number already exists in this branch', 'TABLE_DUPLICATE_NUMBER');
      }
    }
    const id = this.nextTableId++;
    const now = new Date().toISOString();
    const table: DiningTable = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId,
      floorId: data.floorId,
      sectionId: data.sectionId,
      tableNumber: data.tableNumber,
      capacity: data.capacity,
      status: 'available',
      assignedWaiterId: null,
      notes: null,
      shape: data.shape || 'square',
      posX: data.posX ?? 0,
      posY: data.posY ?? 0,
      width: data.width ?? 100,
      height: data.height ?? 100,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryTables.set(id, table);
    return { ...table };
  }

  public async findTableById(id: number, organizationId: number): Promise<DiningTable | null> {
    const t = this.memoryTables.get(id);
    return t && t.organizationId === organizationId ? { ...t } : null;
  }

  public async listTablesByBranch(
    organizationId: number,
    branchId: number,
    filters?: { floorId?: number; sectionId?: number; status?: DiningTable['status'] }
  ): Promise<DiningTable[]> {
    return Array.from(this.memoryTables.values())
      .filter((t) => {
        if (t.organizationId !== organizationId || t.branchId !== branchId) return false;
        if (filters?.floorId !== undefined && t.floorId !== filters.floorId) return false;
        if (filters?.sectionId !== undefined && t.sectionId !== filters.sectionId) return false;
        if (filters?.status !== undefined && t.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber) || a.id - b.id)
      .map((t) => ({ ...t }));
  }

  public async updateTable(
    id: number,
    organizationId: number,
    updates: Partial<Omit<DiningTable, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>>
  ): Promise<DiningTable> {
    const existing = await this.findTableById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Dining table #${id} not found`, 'TABLE_NOT_FOUND');
    }
    if (updates.tableNumber && updates.tableNumber.toLowerCase() !== existing.tableNumber.toLowerCase()) {
      for (const t of this.memoryTables.values()) {
        if (
          t.id !== id &&
          t.organizationId === organizationId &&
          t.branchId === existing.branchId &&
          t.tableNumber.toLowerCase() === updates.tableNumber.toLowerCase()
        ) {
          throw new ConflictError('Table number already exists in this branch', 'TABLE_DUPLICATE_NUMBER');
        }
      }
    }
    const updated: DiningTable = {
      ...existing,
      floorId: updates.floorId ?? existing.floorId,
      sectionId: updates.sectionId ?? existing.sectionId,
      tableNumber: updates.tableNumber ?? existing.tableNumber,
      capacity: updates.capacity ?? existing.capacity,
      status: updates.status ?? existing.status,
      posX: updates.posX ?? existing.posX,
      posY: updates.posY ?? existing.posY,
      width: updates.width ?? existing.width,
      height: updates.height ?? existing.height,
      shape: updates.shape ?? existing.shape,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memoryTables.set(id, updated);
    return { ...updated };
  }

  public async deleteTable(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findTableById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Dining table #${id} not found`, 'TABLE_NOT_FOUND');
    }
    this.memoryTables.delete(id);
    return true;
  }

  // ==========================================
  // HARDWARE PRINTERS
  // ==========================================

  public async createPrinter(data: {
    organizationId: number;
    branchId: number;
    name: string;
    ipAddress?: string;
    port?: number;
    paperWidth?: HardwarePrinter['paperWidth'];
    deviceType?: string;
    isActive?: boolean;
  }): Promise<HardwarePrinter> {
    for (const p of this.memoryPrinters.values()) {
      if (
        p.organizationId === data.organizationId &&
        p.branchId === data.branchId &&
        p.name.toLowerCase() === data.name.toLowerCase()
      ) {
        throw new ConflictError('Printer name already exists in this branch', 'PRINTER_DUPLICATE_NAME');
      }
    }
    const id = this.nextPrinterId++;
    const now = new Date().toISOString();
    const printer: HardwarePrinter = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId,
      name: data.name,
      ipAddress: data.ipAddress || '127.0.0.1',
      port: data.port ?? 9100,
      paperWidth: data.paperWidth || '80mm',
      deviceType: data.deviceType || 'ESC_POS',
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryPrinters.set(id, printer);
    return { ...printer };
  }

  public async findPrinterById(id: number, organizationId: number): Promise<HardwarePrinter | null> {
    const p = this.memoryPrinters.get(id);
    return p && p.organizationId === organizationId ? { ...p } : null;
  }

  public async listPrintersByBranch(organizationId: number, branchId: number): Promise<HardwarePrinter[]> {
    return Array.from(this.memoryPrinters.values())
      .filter((p) => p.organizationId === organizationId && p.branchId === branchId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
      .map((p) => ({ ...p }));
  }

  public async updatePrinter(
    id: number,
    organizationId: number,
    updates: Partial<Omit<HardwarePrinter, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>>
  ): Promise<HardwarePrinter> {
    const existing = await this.findPrinterById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Hardware printer #${id} not found`, 'PRINTER_NOT_FOUND');
    }
    if (updates.name && updates.name.toLowerCase() !== existing.name.toLowerCase()) {
      for (const p of this.memoryPrinters.values()) {
        if (
          p.id !== id &&
          p.organizationId === organizationId &&
          p.branchId === existing.branchId &&
          p.name.toLowerCase() === updates.name.toLowerCase()
        ) {
          throw new ConflictError('Printer name already exists in this branch', 'PRINTER_DUPLICATE_NAME');
        }
      }
    }
    const updated: HardwarePrinter = {
      ...existing,
      name: updates.name ?? existing.name,
      ipAddress: updates.ipAddress ?? existing.ipAddress,
      port: updates.port ?? existing.port,
      paperWidth: updates.paperWidth ?? existing.paperWidth,
      deviceType: updates.deviceType ?? existing.deviceType,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memoryPrinters.set(id, updated);
    return { ...updated };
  }

  public async deletePrinter(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findPrinterById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Hardware printer #${id} not found`, 'PRINTER_NOT_FOUND');
    }
    const isAssigned = Array.from(this.memoryStations.values()).some(
      (s) => s.organizationId === organizationId && (s.primaryPrinterId === id || s.backupPrinterId === id)
    );
    if (isAssigned) {
      throw new ConflictError('Cannot delete printer assigned to preparation stations', 'PRINTER_ASSIGNED_TO_STATION');
    }
    this.memoryPrinters.delete(id);
    return true;
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
    for (const s of this.memoryStations.values()) {
      if (
        s.organizationId === data.organizationId &&
        s.branchId === data.branchId &&
        s.name.toLowerCase() === data.name.toLowerCase()
      ) {
        throw new ConflictError('Station name already exists in this branch', 'STATION_DUPLICATE_NAME');
      }
    }
    const id = this.nextStationId++;
    const now = new Date().toISOString();
    const station: PreparationStation = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId,
      name: data.name,
      type: data.type || 'kitchen',
      primaryPrinterId: data.primaryPrinterId ?? null,
      backupPrinterId: data.backupPrinterId ?? null,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryStations.set(id, station);
    return { ...station };
  }

  public async findStationById(id: number, organizationId: number): Promise<PreparationStation | null> {
    const s = this.memoryStations.get(id);
    return s && s.organizationId === organizationId ? { ...s } : null;
  }

  public async listStationsByBranch(organizationId: number, branchId: number): Promise<PreparationStation[]> {
    return Array.from(this.memoryStations.values())
      .filter((s) => s.organizationId === organizationId && s.branchId === branchId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
      .map((s) => ({ ...s }));
  }

  public async updateStation(
    id: number,
    organizationId: number,
    updates: Partial<Omit<PreparationStation, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>>
  ): Promise<PreparationStation> {
    const existing = await this.findStationById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Preparation station #${id} not found`, 'STATION_NOT_FOUND');
    }
    if (updates.name && updates.name.toLowerCase() !== existing.name.toLowerCase()) {
      for (const s of this.memoryStations.values()) {
        if (
          s.id !== id &&
          s.organizationId === organizationId &&
          s.branchId === existing.branchId &&
          s.name.toLowerCase() === updates.name.toLowerCase()
        ) {
          throw new ConflictError('Station name already exists in this branch', 'STATION_DUPLICATE_NAME');
        }
      }
    }
    const updated: PreparationStation = {
      ...existing,
      name: updates.name ?? existing.name,
      type: updates.type ?? existing.type,
      primaryPrinterId: updates.primaryPrinterId !== undefined ? updates.primaryPrinterId : existing.primaryPrinterId,
      backupPrinterId: updates.backupPrinterId !== undefined ? updates.backupPrinterId : existing.backupPrinterId,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memoryStations.set(id, updated);
    return { ...updated };
  }

  public async deleteStation(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findStationById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Preparation station #${id} not found`, 'STATION_NOT_FOUND');
    }
    this.memoryStations.delete(id);
    return true;
  }

  // ==========================================
  // BRANCH TAX CONFIG
  // ==========================================

  public async getBranchTaxConfig(organizationId: number, branchId: number): Promise<BranchTaxConfig | null> {
    const key = `${organizationId}:${branchId}`;
    const cfg = this.memoryBranchTaxConfigs.get(key);
    return cfg ? { ...cfg } : null;
  }

  public async upsertBranchTaxConfig(data: {
    organizationId: number;
    branchId: number;
    isVatRegistered?: boolean;
    taxRegistrationNumber?: string | null;
    vatRate?: number;
    defaultPriceEntryMode?: BranchTaxConfig['defaultPriceEntryMode'];
    roundingMethod?: BranchTaxConfig['roundingMethod'];
  }): Promise<BranchTaxConfig> {
    const key = `${data.organizationId}:${data.branchId}`;
    const existing = this.memoryBranchTaxConfigs.get(key);
    const now = new Date().toISOString();
    if (existing) {
      const updated: BranchTaxConfig = {
        ...existing,
        isVatRegistered: data.isVatRegistered ?? existing.isVatRegistered,
        taxRegistrationNumber: (data.isVatRegistered ?? existing.isVatRegistered)
          ? (data.taxRegistrationNumber !== undefined ? data.taxRegistrationNumber : existing.taxRegistrationNumber)
          : null,
        vatRate: (data.isVatRegistered ?? existing.isVatRegistered) ? 0.13 : 0,
        defaultPriceEntryMode: data.defaultPriceEntryMode ?? existing.defaultPriceEntryMode,
        roundingMethod: data.roundingMethod ?? existing.roundingMethod,
        updatedAt: now,
      };
      this.memoryBranchTaxConfigs.set(key, updated);
      return { ...updated };
    }

    const id = this.nextBranchTaxConfigId++;
    const created: BranchTaxConfig = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId,
      isVatRegistered: data.isVatRegistered ?? false,
      taxRegistrationNumber: (data.isVatRegistered ?? false) ? (data.taxRegistrationNumber ?? null) : null,
      vatRate: (data.isVatRegistered ?? false) ? 0.13 : 0,
      defaultPriceEntryMode: data.defaultPriceEntryMode ?? 'VAT_INCLUDED',
      roundingMethod: data.roundingMethod || 'HALF_EVEN',
      createdAt: now,
      updatedAt: now,
    };
    this.memoryBranchTaxConfigs.set(key, created);
    return { ...created };
  }

  // ==========================================
  // PAYMENT METHODS
  // ==========================================

  public async createPaymentMethod(data: {
    organizationId: number;
    branchId?: number | null;
    name: string;
    code: string;
    type: PaymentMethod['type'];
    requiresReference?: boolean;
    isActive?: boolean;
    displayOrder?: number;
  }): Promise<PaymentMethod> {
    for (const pm of this.memoryPaymentMethods.values()) {
      if (
        pm.organizationId === data.organizationId &&
        pm.code.toLowerCase() === data.code.toLowerCase()
      ) {
        throw new ConflictError('Payment method code already exists', 'PAYMENT_DUPLICATE_CODE');
      }
    }
    const id = this.nextPaymentMethodId++;
    const now = new Date().toISOString();
    const pm: PaymentMethod = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId ?? null,
      name: data.name,
      code: data.code,
      type: data.type,
      requiresReference: data.requiresReference ?? false,
      isActive: data.isActive ?? true,
      displayOrder: data.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryPaymentMethods.set(id, pm);
    return { ...pm };
  }

  public async findPaymentMethodById(id: number, organizationId: number): Promise<PaymentMethod | null> {
    const pm = this.memoryPaymentMethods.get(id);
    return pm && pm.organizationId === organizationId ? { ...pm } : null;
  }

  public async listPaymentMethods(organizationId: number, branchId?: number): Promise<PaymentMethod[]> {
    return Array.from(this.memoryPaymentMethods.values())
      .filter((pm) => {
        if (pm.organizationId !== organizationId) return false;
        if (branchId !== undefined && pm.branchId !== null && pm.branchId !== branchId) return false;
        return true;
      })
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id)
      .map((pm) => ({ ...pm }));
  }

  public async updatePaymentMethod(
    id: number,
    organizationId: number,
    updates: Partial<Omit<PaymentMethod, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>
  ): Promise<PaymentMethod> {
    const existing = await this.findPaymentMethodById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Payment method #${id} not found`, 'PAYMENT_METHOD_NOT_FOUND');
    }
    if (updates.code && updates.code.toLowerCase() !== existing.code.toLowerCase()) {
      for (const pm of this.memoryPaymentMethods.values()) {
        if (
          pm.id !== id &&
          pm.organizationId === organizationId &&
          pm.code.toLowerCase() === updates.code.toLowerCase()
        ) {
          throw new ConflictError('Payment method code already exists', 'PAYMENT_DUPLICATE_CODE');
        }
      }
    }
    const updated: PaymentMethod = {
      ...existing,
      branchId: updates.branchId !== undefined ? updates.branchId : existing.branchId,
      name: updates.name ?? existing.name,
      code: updates.code ?? existing.code,
      type: updates.type ?? existing.type,
      requiresReference: updates.requiresReference ?? existing.requiresReference,
      isActive: updates.isActive ?? existing.isActive,
      displayOrder: updates.displayOrder ?? existing.displayOrder,
      updatedAt: new Date().toISOString(),
    };
    this.memoryPaymentMethods.set(id, updated);
    return { ...updated };
  }

  public async deletePaymentMethod(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findPaymentMethodById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Payment method #${id} not found`, 'PAYMENT_METHOD_NOT_FOUND');
    }
    this.memoryPaymentMethods.delete(id);
    return true;
  }

  // ==========================================
  // UNITS OF MEASURE
  // ==========================================

  public async createUnit(data: {
    organizationId: number;
    name: string;
    symbol: string;
    dimension: UnitDimension;
    baseUnitSymbol?: string;
    conversionFactor?: number;
    isActive?: boolean;
  }): Promise<UnitOfMeasure> {
    this.ensurePlatformUnits();
    for (const u of this.memoryUnits.values()) {
      if (
        (u.organizationId === null || u.organizationId === data.organizationId) &&
        u.symbol.toLowerCase() === data.symbol.toLowerCase()
      ) {
        throw new ConflictError('Unit symbol already exists', 'UNIT_DUPLICATE_SYMBOL');
      }
    }
    const id = this.nextUnitId++;
    const now = new Date().toISOString();
    const unit: UnitOfMeasure = {
      id,
      organizationId: data.organizationId,
      name: data.name,
      symbol: data.symbol,
      dimension: data.dimension,
      baseUnitSymbol: data.baseUnitSymbol || data.symbol,
      conversionFactor: data.conversionFactor ?? 1,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryUnits.set(id, unit);
    return { ...unit };
  }

  public async findUnitById(id: number, organizationId?: number): Promise<UnitOfMeasure | null> {
    this.ensurePlatformUnits();
    const u = this.memoryUnits.get(id);
    if (!u) return null;
    if (u.organizationId === null || organizationId === undefined || u.organizationId === organizationId) {
      return { ...u };
    }
    return null;
  }

  public async listUnits(organizationId?: number, dimension?: UnitDimension): Promise<UnitOfMeasure[]> {
    this.ensurePlatformUnits();
    return Array.from(this.memoryUnits.values())
      .filter((u) => {
        if (u.organizationId !== null && organizationId !== undefined && u.organizationId !== organizationId) {
          return false;
        }
        if (dimension !== undefined && u.dimension !== dimension) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.organizationId === null && b.organizationId !== null) return -1;
        if (a.organizationId !== null && b.organizationId === null) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((u) => ({ ...u }));
  }

  public async updateUnit(
    id: number,
    organizationId: number,
    updates: Partial<Omit<UnitOfMeasure, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UnitOfMeasure> {
    this.ensurePlatformUnits();
    const existing = this.memoryUnits.get(id);
    if (!existing || (existing.organizationId !== null && existing.organizationId !== organizationId)) {
      throw new NotFoundError(`Unit #${id} not found`, 'UNIT_NOT_FOUND');
    }
    if (existing.organizationId === null) {
      throw new ForbiddenError('Platform built-in units cannot be modified', 'PLATFORM_UNIT_PROTECTED');
    }
    if (updates.symbol && updates.symbol.toLowerCase() !== existing.symbol.toLowerCase()) {
      for (const u of this.memoryUnits.values()) {
        if (
          u.id !== id &&
          (u.organizationId === null || u.organizationId === organizationId) &&
          u.symbol.toLowerCase() === updates.symbol.toLowerCase()
        ) {
          throw new ConflictError('Unit symbol already exists', 'UNIT_DUPLICATE_SYMBOL');
        }
      }
    }
    const updated: UnitOfMeasure = {
      ...existing,
      name: updates.name ?? existing.name,
      symbol: updates.symbol ?? existing.symbol,
      dimension: updates.dimension ?? existing.dimension,
      baseUnitSymbol: updates.baseUnitSymbol ?? existing.baseUnitSymbol,
      conversionFactor: updates.conversionFactor ?? existing.conversionFactor,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memoryUnits.set(id, updated);
    return { ...updated };
  }

  public async deleteUnit(id: number, organizationId: number): Promise<boolean> {
    this.ensurePlatformUnits();
    const existing = this.memoryUnits.get(id);
    if (!existing || (existing.organizationId !== null && existing.organizationId !== organizationId)) {
      throw new NotFoundError(`Unit #${id} not found`, 'UNIT_NOT_FOUND');
    }
    if (existing.organizationId === null) {
      throw new NotFoundError('Platform built-in units cannot be deleted', 'PLATFORM_UNIT_PROTECTED');
    }
    this.memoryUnits.delete(id);
    return true;
  }

  // ==========================================
  // OPERATIONAL SETTINGS
  // ==========================================

  public async getOperationalSettings(
    organizationId: number,
    branchId?: number | null
  ): Promise<OperationalSettings> {
    const key = `${organizationId}:${branchId || 0}`;
    const existing = this.memoryOperationalSettings.get(key);
    if (existing) {
      return { ...existing };
    }
    const now = new Date().toISOString();
    return {
      id: 1,
      organizationId,
      branchId: branchId || null,
      openingTime: '08:00',
      closingTime: '23:00',
      operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      dineInEnabled: true,
      takeawayEnabled: true,
      deliveryEnabled: false,
      receiptHeader: null,
      receiptFooter: null,
      currencySymbol: 'रू',
      autoPrintKot: true,
      autoPrintBill: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async upsertOperationalSettings(data: {
    organizationId: number;
    branchId?: number | null;
    openingTime?: string;
    closingTime?: string;
    operatingDays?: string[];
    dineInEnabled?: boolean;
    takeawayEnabled?: boolean;
    deliveryEnabled?: boolean;
    receiptHeader?: string | null;
    receiptFooter?: string | null;
    currencySymbol?: string;
    autoPrintKot?: boolean;
    autoPrintBill?: boolean;
  }): Promise<OperationalSettings> {
    const key = `${data.organizationId}:${data.branchId || 0}`;
    const existing = this.memoryOperationalSettings.get(key);
    const now = new Date().toISOString();
    if (existing) {
      const updated: OperationalSettings = {
        ...existing,
        openingTime: data.openingTime ?? existing.openingTime,
        closingTime: data.closingTime ?? existing.closingTime,
        operatingDays: data.operatingDays ?? existing.operatingDays,
        dineInEnabled: data.dineInEnabled ?? existing.dineInEnabled,
        takeawayEnabled: data.takeawayEnabled ?? existing.takeawayEnabled,
        deliveryEnabled: data.deliveryEnabled ?? existing.deliveryEnabled,
        receiptHeader: data.receiptHeader !== undefined ? data.receiptHeader : existing.receiptHeader,
        receiptFooter: data.receiptFooter !== undefined ? data.receiptFooter : existing.receiptFooter,
        currencySymbol: data.currencySymbol ?? existing.currencySymbol,
        autoPrintKot: data.autoPrintKot ?? existing.autoPrintKot,
        autoPrintBill: data.autoPrintBill ?? existing.autoPrintBill,
        updatedAt: now,
      };
      this.memoryOperationalSettings.set(key, updated);
      return { ...updated };
    }

    const id = this.nextOperationalSettingsId++;
    const created: OperationalSettings = {
      id,
      organizationId: data.organizationId,
      branchId: data.branchId || null,
      openingTime: data.openingTime || '08:00',
      closingTime: data.closingTime || '23:00',
      operatingDays: data.operatingDays || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      dineInEnabled: data.dineInEnabled ?? true,
      takeawayEnabled: data.takeawayEnabled ?? true,
      deliveryEnabled: data.deliveryEnabled ?? false,
      receiptHeader: data.receiptHeader ?? null,
      receiptFooter: data.receiptFooter ?? null,
      currencySymbol: data.currencySymbol || 'रू',
      autoPrintKot: data.autoPrintKot ?? true,
      autoPrintBill: data.autoPrintBill ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryOperationalSettings.set(key, created);
    return { ...created };
  }

  // ==========================================
  // AUTOMATED BASELINE SEEDER
  // ==========================================

  public async seedOrganizationBaseline(organizationId: number, branchId: number): Promise<void> {
    this.ensurePlatformUnits();

    // 1. New branches are non-VAT until registration is explicitly configured.
    await this.upsertBranchTaxConfig({
      organizationId,
      branchId,
      isVatRegistered: false,
      taxRegistrationNumber: null,
      vatRate: 0,
      defaultPriceEntryMode: 'VAT_INCLUDED',
      roundingMethod: 'HALF_EVEN',
    });

    // 2. Standard Payment Methods
    const existingPayments = await this.listPaymentMethods(organizationId);
    if (existingPayments.length === 0) {
      await this.createPaymentMethod({
        organizationId,
        branchId: null,
        name: 'Cash',
        code: 'CASH',
        type: 'CASH',
        requiresReference: false,
        isActive: true,
        displayOrder: 1,
      });
      await this.createPaymentMethod({
        organizationId,
        branchId: null,
        name: 'Credit / Debit Card',
        code: 'CARD',
        type: 'CREDIT_CARD',
        requiresReference: true,
        isActive: true,
        displayOrder: 2,
      });
      await this.createPaymentMethod({
        organizationId,
        branchId: null,
        name: 'Fonepay QR',
        code: 'QR_FONEPAY',
        type: 'QR_CODE',
        requiresReference: true,
        isActive: true,
        displayOrder: 3,
      });
    }

    // 4. Baseline Floor, Section & Dining Tables
    const existingFloors = await this.listFloorsByBranch(organizationId, branchId);
    if (existingFloors.length === 0) {
      const floor = await this.createFloor({
        organizationId,
        branchId,
        name: 'Ground Floor',
        displayOrder: 1,
        isActive: true,
      });

      const section = await this.createSection({
        organizationId,
        branchId,
        floorId: floor.id,
        name: 'Main Dining Hall',
        displayOrder: 1,
        isActive: true,
      });

      for (let i = 1; i <= 4; i++) {
        await this.createTable({
          organizationId,
          branchId,
          floorId: floor.id,
          sectionId: section.id,
          tableNumber: `T-0${i}`,
          capacity: i === 4 ? 6 : 4,
          shape: 'square',
          posX: (i - 1) * 120 + 20,
          posY: 20,
          width: 100,
          height: 100,
          isActive: true,
        });
      }
    }

    // 5. Default Operational Settings
    await this.upsertOperationalSettings({
      organizationId,
      branchId,
      openingTime: '08:00',
      closingTime: '23:00',
      operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      dineInEnabled: true,
      takeawayEnabled: true,
      deliveryEnabled: false,
      receiptHeader: null,
      receiptFooter: null,
      currencySymbol: 'रू',
      autoPrintKot: true,
      autoPrintBill: true,
    });
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

    for (const c of this.memoryMenuCategories.values()) {
      if (
        c.organizationId === data.organizationId &&
        c.name.toLowerCase() === data.name.toLowerCase()
      ) {
        throw new ConflictError('Category name already exists in this organization', 'MENU_CATEGORY_DUPLICATE_NAME');
      }
    }

    const now = new Date().toISOString();
    const id = this.nextMenuCategoryId++;
    const cat: MenuCategory = {
      id,
      organizationId: data.organizationId,
      parentId: data.parentId ?? null,
      name: data.name,
      stationId: data.stationId ?? null,
      displayOrder: data.displayOrder ?? 0,
      imageUrl: data.imageUrl ?? null,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryMenuCategories.set(id, cat);
    return { ...cat };
  }

  public async findMenuCategoryById(id: number, organizationId: number): Promise<MenuCategory | null> {
    const c = this.memoryMenuCategories.get(id);
    return c && c.organizationId === organizationId ? { ...c } : null;
  }

  public async listMenuCategoriesByOrg(organizationId: number): Promise<MenuCategory[]> {
    return Array.from(this.memoryMenuCategories.values())
      .filter((c) => c.organizationId === organizationId)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id)
      .map((c) => ({ ...c }));
  }

  public async updateMenuCategory(
    id: number,
    organizationId: number,
    updates: Partial<Pick<MenuCategory, 'parentId' | 'name' | 'stationId' | 'displayOrder' | 'imageUrl' | 'isActive'>>
  ): Promise<MenuCategory> {
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

    if (updates.name && updates.name.toLowerCase() !== existing.name.toLowerCase()) {
      for (const c of this.memoryMenuCategories.values()) {
        if (
          c.id !== id &&
          c.organizationId === organizationId &&
          c.name.toLowerCase() === updates.name.toLowerCase()
        ) {
          throw new ConflictError('Category name already exists in this organization', 'MENU_CATEGORY_DUPLICATE_NAME');
        }
      }
    }

    const updated: MenuCategory = {
      ...existing,
      parentId: updates.parentId !== undefined ? updates.parentId : existing.parentId,
      name: updates.name ?? existing.name,
      stationId: updates.stationId !== undefined ? updates.stationId : existing.stationId,
      displayOrder: updates.displayOrder ?? existing.displayOrder,
      imageUrl: updates.imageUrl !== undefined ? updates.imageUrl : existing.imageUrl,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.memoryMenuCategories.set(id, updated);
    return { ...updated };
  }

  public async deleteMenuCategory(id: number, organizationId: number): Promise<boolean> {
    const existing = await this.findMenuCategoryById(id, organizationId);
    if (!existing) return false;

    const hasItems = Array.from(this.memoryMenuItems.values()).some((i) => i.categoryId === id);
    if (hasItems) {
      throw new ConflictError('Cannot delete category with existing menu items', 'CATEGORY_HAS_ITEMS');
    }
    const hasChildren = Array.from(this.memoryMenuCategories.values()).some((c) => c.parentId === id);
    if (hasChildren) {
      throw new ConflictError('Cannot delete category with child categories', 'CATEGORY_HAS_CHILDREN');
    }

    this.memoryMenuCategories.delete(id);
    return true;
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

    if (data.sku != null && data.sku.trim() !== '') {
      for (const item of this.memoryMenuItems.values()) {
        if (
          item.organizationId === data.organizationId &&
          item.sku &&
          item.sku.toLowerCase() === data.sku.toLowerCase()
        ) {
          throw new ConflictError('Menu item SKU already exists in this organization', 'MENU_ITEM_DUPLICATE_SKU');
        }
      }
    }

    const now = new Date().toISOString();
    const id = this.nextMenuItemId++;
    const item: MenuItem = {
      id,
      organizationId: data.organizationId,
      categoryId: data.categoryId,
      departmentId: data.departmentId ?? null,
      prepTimeMinutes: data.prepTimeMinutes ?? null,
      defaultPrepStationId: data.defaultPrepStationId ?? null,
      name: data.name,
      sku: data.sku ?? null,
      description: data.description ?? null,
      enteredPrice: data.enteredPrice ?? 0,
      priceEntryMode: data.priceEntryMode ?? 'VAT_INCLUDED',
      customerPrice: data.enteredPrice ?? 0,
      priceBeforeVat: data.enteredPrice ?? 0,
      vatAmount: 0,
      costPrice: data.costPrice ?? 0,
      imageUrl: data.imageUrl ?? null,
      isAvailable: data.isAvailable ?? true,
      isCombo: data.isCombo ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryMenuItems.set(id, item);
    return { ...item };
  }

  public async findMenuItemById(id: number, organizationId: number): Promise<MenuItem | null> {
    const item = this.memoryMenuItems.get(id);
    return item && item.organizationId === organizationId ? { ...item } : null;
  }

  public async listMenuItemsByOrg(organizationId: number): Promise<MenuItem[]> {
    return Array.from(this.memoryMenuItems.values())
      .filter((i) => i.organizationId === organizationId)
      .sort((a, b) => a.categoryId - b.categoryId || a.name.localeCompare(b.name) || a.id - b.id)
      .map((i) => ({ ...i }));
  }

  public async updateMenuItem(
    id: number,
    organizationId: number,
    updates: Partial<Pick<MenuItem, 'categoryId' | 'defaultPrepStationId' | 'departmentId' | 'prepTimeMinutes' | 'name' | 'sku' | 'description' | 'enteredPrice' | 'priceEntryMode' | 'costPrice' | 'imageUrl' | 'isAvailable' | 'isCombo'>>
  ): Promise<MenuItem> {
    const existing = await this.findMenuItemById(id, organizationId);
    if (!existing) {
      throw new NotFoundError(`Menu item #${id} not found`, 'MENU_ITEM_NOT_FOUND');
    }

    if (updates.isCombo === true && !existing.isCombo) {
      const usedByCombo = Array.from(this.memoryMenuComboComponents.values()).some((rows) =>
        rows.some((row) => row.componentMenuItemId === id)
      );
      if (usedByCombo) {
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

    if (updates.sku !== undefined && updates.sku !== null && updates.sku !== existing.sku) {
      for (const item of this.memoryMenuItems.values()) {
        if (
          item.id !== id &&
          item.organizationId === organizationId &&
          item.sku &&
          item.sku.toLowerCase() === updates.sku.toLowerCase()
        ) {
          throw new ConflictError('Menu item SKU already exists in this organization', 'MENU_ITEM_DUPLICATE_SKU');
        }
      }
    }

    const updated: MenuItem = {
      ...existing,
      categoryId: updates.categoryId ?? existing.categoryId,
      defaultPrepStationId: updates.defaultPrepStationId !== undefined ? updates.defaultPrepStationId : existing.defaultPrepStationId,
      departmentId: updates.departmentId !== undefined ? updates.departmentId : existing.departmentId,
      prepTimeMinutes: updates.prepTimeMinutes !== undefined ? updates.prepTimeMinutes : existing.prepTimeMinutes,
      name: updates.name ?? existing.name,
      sku: updates.sku !== undefined ? updates.sku : existing.sku,
      description: updates.description !== undefined ? updates.description : existing.description,
      enteredPrice: updates.enteredPrice ?? existing.enteredPrice,
      priceEntryMode: updates.priceEntryMode ?? existing.priceEntryMode,
      customerPrice: updates.enteredPrice ?? existing.enteredPrice,
      priceBeforeVat: updates.enteredPrice ?? existing.enteredPrice,
      vatAmount: 0,
      costPrice: updates.costPrice ?? existing.costPrice,
      imageUrl: updates.imageUrl !== undefined ? updates.imageUrl : existing.imageUrl,
      isAvailable: updates.isAvailable ?? existing.isAvailable,
      isCombo: updates.isCombo ?? existing.isCombo,
      updatedAt: new Date().toISOString(),
    };
    this.memoryMenuItems.set(id, updated);
    if (!updated.isCombo) this.memoryMenuComboComponents.delete(id);
    return { ...updated };
  }

  public async deleteMenuItem(id: number, organizationId: number): Promise<boolean> {
    const item = await this.findMenuItemById(id, organizationId);
    if (!item) return false;
    const usedByCombo = Array.from(this.memoryMenuComboComponents.values()).some((rows) =>
      rows.some((row) => row.componentMenuItemId === id)
    );
    if (usedByCombo) {
      throw new ConflictError('This menu item is used inside a combo. Remove it from the combo before deleting it.', 'MENU_ITEM_USED_IN_COMBO');
    }
    this.memoryMenuComboComponents.delete(id);
    this.memoryMenuItems.delete(id);
    return true;
  }

  public async getMenuComboComponents(comboMenuItemId: number, organizationId: number): Promise<MenuComboComponent[]> {
    const combo = await this.findMenuItemById(comboMenuItemId, organizationId);
    if (!combo) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
    return (this.memoryMenuComboComponents.get(comboMenuItemId) || []).map((row) => ({ ...row }));
  }

  public async setMenuComboComponents(
    comboMenuItemId: number,
    organizationId: number,
    components: Array<{ menuItemId: number; quantity: number }>
  ): Promise<MenuComboComponent[]> {
    const combo = await this.findMenuItemById(comboMenuItemId, organizationId);
    if (!combo) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
    if (!combo.isCombo) throw new BadRequestError('Enable Combo on the menu item before adding components', 'MENU_ITEM_NOT_COMBO');
    if (components.length < 2) throw new BadRequestError('A combo needs at least two menu items', 'COMBO_COMPONENTS_REQUIRED');
    const ids = components.map((component) => component.menuItemId);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('A menu item can only appear once in a combo', 'COMBO_COMPONENT_DUPLICATE');
    if (ids.includes(comboMenuItemId)) throw new BadRequestError('A combo cannot contain itself', 'COMBO_COMPONENT_SELF_REFERENCE');

    const now = new Date().toISOString();
    const rows: MenuComboComponent[] = [];
    for (let index = 0; index < components.length; index += 1) {
      const component = await this.findMenuItemById(components[index].menuItemId, organizationId);
      if (!component) throw new NotFoundError('One or more combo items were not found', 'COMBO_COMPONENT_NOT_FOUND');
      if (component.isCombo) throw new BadRequestError('Nested combos are not supported', 'COMBO_COMPONENT_NESTED_COMBO');
      rows.push({
        id: this.nextMenuComboComponentId++,
        organizationId,
        comboMenuItemId,
        componentMenuItemId: component.id,
        componentName: component.name,
        componentCategoryId: component.categoryId,
        quantity: components[index].quantity,
        displayOrder: index,
        isAvailable: component.isAvailable,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.memoryMenuComboComponents.set(comboMenuItemId, rows);
    return rows.map((row) => ({ ...row }));
  }
}

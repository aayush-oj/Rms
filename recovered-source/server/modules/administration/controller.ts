import { Request, Response, NextFunction } from 'express';
import { administrationRepository, AdministrationRepository } from './repository';
import { identityRepository } from '../identity/repository';
import { managementRepository } from '../management/repository';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { SYSTEM_ROLES } from '../identity/types';
import { calculateMenuPrice } from '../../domain/pricing';
import type { MenuItem } from './types';

export class AdministrationController {
  constructor(private repo: AdministrationRepository = administrationRepository) {}

  private getOrgId(req: Request): number {
    if (!req.user || !req.user.organizationId) {
      throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
    }
    return req.user.organizationId;
  }

  private async withCustomerPricing(req: Request, items: MenuItem[]): Promise<MenuItem[]> {
    const organizationId = this.getOrgId(req);
    const branchId = req.user?.activeBranchId;
    if (!branchId) throw new ForbiddenError('Active branch context is required', 'MISSING_TENANT_CONTEXT');
    const profile = await this.repo.getBranchTaxConfig(organizationId, branchId);
    const pricingProfile = {
      isVatRegistered: profile?.isVatRegistered ?? false,
      vatRate: profile?.vatRate ?? 0,
      roundingMethod: profile?.roundingMethod ?? 'HALF_EVEN' as const,
    };
    return items.map((item) => ({ ...item, ...calculateMenuPrice(item.enteredPrice, item.priceEntryMode, pricingProfile) }));
  }

  private async ensureBranchAccess(req: Request, branchId: number): Promise<void> {
    if (!req.user) {
      throw new ForbiddenError('Authentication required', 'AUTH_REQUIRED');
    }
    const branch = await identityRepository.findBranchById(req.user.organizationId, branchId);
    if (!branch) {
      throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    }
    if (
      req.user.role === SYSTEM_ROLES.OWNER ||
      req.user.permissions.includes('admin:all') ||
      req.user.permissions.includes('admin:branches:manage')
    ) {
      return;
    }
    if (!req.user.allowedBranchIds.includes(branchId)) {
      throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    }
  }

  // ==========================================
  // FLOORS
  // ==========================================

  public listFloors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.query.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const floors = await this.repo.listFloorsByBranch(orgId, branchId);
      const response: ApiSuccessResponse = { success: true, data: floors };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const floorId = parseInt(req.params.id, 10);
      if (isNaN(floorId)) {
        throw new BadRequestError('Invalid floor ID', 'INVALID_ID');
      }

      const floor = await this.repo.findFloorById(floorId, orgId);
      if (!floor) {
        throw new NotFoundError(`Floor #${floorId} not found`, 'FLOOR_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, floor.branchId);

      const sections = await this.repo.listSectionsByBranch(orgId, floor.branchId, floor.id);
      const response: ApiSuccessResponse = {
        success: true,
        data: { ...floor, sections },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.body.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      // Whitelist fields explicitly
      const { name, displayOrder, isActive } = req.body;
      const floor = await this.repo.createFloor({
        organizationId: orgId,
        branchId,
        name,
        displayOrder,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: floor };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const floorId = parseInt(req.params.id, 10);
      if (isNaN(floorId)) {
        throw new BadRequestError('Invalid floor ID', 'INVALID_ID');
      }

      const existing = await this.repo.findFloorById(floorId, orgId);
      if (!existing) {
        throw new NotFoundError(`Floor #${floorId} not found`, 'FLOOR_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      const { name, displayOrder, isActive } = req.body;
      const updated = await this.repo.updateFloor(floorId, orgId, {
        name,
        displayOrder,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const floorId = parseInt(req.params.id, 10);
      if (isNaN(floorId)) {
        throw new BadRequestError('Invalid floor ID', 'INVALID_ID');
      }

      const existing = await this.repo.findFloorById(floorId, orgId);
      if (!existing) {
        throw new NotFoundError(`Floor #${floorId} not found`, 'FLOOR_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      await this.repo.deleteFloor(floorId, orgId);
      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id: floorId } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // SECTIONS
  // ==========================================

  public listSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.query.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const floorId = req.query.floorId ? parseInt(req.query.floorId as string, 10) : undefined;
      const sections = await this.repo.listSectionsByBranch(orgId, branchId, floorId);
      const privileged = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:tables:manage') || req.user!.permissions.includes('admin:access:manage');
      const visibleSections = privileged ? sections : (await Promise.all(sections.map(async section => ({ section, visible: await managementRepository.canAccessSection(orgId, req.user!.id, branchId, section.id, req.user!.permissions) })))).filter(x => x.visible).map(x => x.section);

      const response: ApiSuccessResponse = { success: true, data: visibleSections };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const sectionId = parseInt(req.params.id, 10);
      if (isNaN(sectionId)) {
        throw new BadRequestError('Invalid section ID', 'INVALID_ID');
      }

      const section = await this.repo.findSectionById(sectionId, orgId);
      if (!section) {
        throw new NotFoundError(`Section #${sectionId} not found`, 'SECTION_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, section.branchId);
      const privileged = req.user!.role === SYSTEM_ROLES.OWNER || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:tables:manage') || req.user!.permissions.includes('admin:access:manage');
      if (!privileged && !(await managementRepository.canAccessSection(orgId, req.user!.id, section.branchId, section.id, req.user!.permissions))) {
        throw new ForbiddenError('You do not have access to this room/area', 'SECTION_ACCESS_FORBIDDEN');
      }

      const response: ApiSuccessResponse = { success: true, data: section };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.body.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const { floorId, name, displayOrder, isActive } = req.body;
      const section = await this.repo.createSection({
        organizationId: orgId,
        branchId,
        floorId,
        name,
        displayOrder,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: section };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const sectionId = parseInt(req.params.id, 10);
      if (isNaN(sectionId)) {
        throw new BadRequestError('Invalid section ID', 'INVALID_ID');
      }

      const existing = await this.repo.findSectionById(sectionId, orgId);
      if (!existing) {
        throw new NotFoundError(`Section #${sectionId} not found`, 'SECTION_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      const { floorId, name, displayOrder, isActive } = req.body;
      const updated = await this.repo.updateSection(sectionId, orgId, {
        floorId,
        name,
        displayOrder,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const sectionId = parseInt(req.params.id, 10);
      if (isNaN(sectionId)) {
        throw new BadRequestError('Invalid section ID', 'INVALID_ID');
      }

      const existing = await this.repo.findSectionById(sectionId, orgId);
      if (!existing) {
        throw new NotFoundError(`Section #${sectionId} not found`, 'SECTION_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      await this.repo.deleteSection(sectionId, orgId);
      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id: sectionId } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // DINING TABLES
  // ==========================================

  public listTables = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.query.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const floorId = req.query.floorId ? parseInt(req.query.floorId as string, 10) : undefined;
      const sectionId = req.query.sectionId ? parseInt(req.query.sectionId as string, 10) : undefined;
      const status = req.query.status as string | undefined;

      const tables = await this.repo.listTablesByBranch(orgId, branchId, {
        floorId,
        sectionId,
        status,
      });
      const visibleTables = await Promise.all(tables.map(async (table) => ({ table, visible: await managementRepository.canAccessTable(orgId, req.user!.id, branchId, table.id, req.user!.permissions) })));

      const response: ApiSuccessResponse = { success: true, data: visibleTables.filter(v => v.visible).map(v => v.table) };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getTable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const tableId = parseInt(req.params.id, 10);
      if (isNaN(tableId)) {
        throw new BadRequestError('Invalid table ID', 'INVALID_ID');
      }

      const table = await this.repo.findTableById(tableId, orgId);
      if (!table) {
        throw new NotFoundError(`Table #${tableId} not found`, 'TABLE_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, table.branchId);
      if (!(await managementRepository.canAccessTable(orgId, req.user!.id, table.branchId, table.id, req.user!.permissions))) {
        throw new ForbiddenError('You do not have access to this dining table', 'TABLE_ACCESS_FORBIDDEN');
      }

      const response: ApiSuccessResponse = { success: true, data: table };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createTable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.body.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const {
        floorId,
        sectionId,
        tableNumber,
        capacity,
        status,
        posX,
        posY,
        width,
        height,
        shape,
        isActive,
        assignedWaiterId,
        notes,
      } = req.body;

      const table = await this.repo.createTable({
        organizationId: orgId,
        branchId,
        floorId,
        sectionId,
        tableNumber,
        capacity,
        status,
        posX,
        posY,
        width,
        height,
        shape,
        isActive,
        assignedWaiterId,
        notes,
      });

      const response: ApiSuccessResponse = { success: true, data: table };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateTable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const tableId = parseInt(req.params.id, 10);
      if (isNaN(tableId)) {
        throw new BadRequestError('Invalid table ID', 'INVALID_ID');
      }

      const existing = await this.repo.findTableById(tableId, orgId);
      if (!existing) {
        throw new NotFoundError(`Table #${tableId} not found`, 'TABLE_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      const {
        floorId,
        sectionId,
        tableNumber,
        capacity,
        status,
        posX,
        posY,
        width,
        height,
        shape,
        isActive,
        assignedWaiterId,
        notes,
      } = req.body;

      const updated = await this.repo.updateTable(tableId, orgId, {
        floorId,
        sectionId,
        tableNumber,
        capacity,
        status,
        posX,
        posY,
        width,
        height,
        shape,
        isActive,
        assignedWaiterId,
        notes,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteTable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const tableId = parseInt(req.params.id, 10);
      if (isNaN(tableId)) {
        throw new BadRequestError('Invalid table ID', 'INVALID_ID');
      }

      const existing = await this.repo.findTableById(tableId, orgId);
      if (!existing) {
        throw new NotFoundError(`Table #${tableId} not found`, 'TABLE_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      await this.repo.deleteTable(tableId, orgId);
      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id: tableId } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // HARDWARE PRINTERS
  // ==========================================

  public listPrinters = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.query.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const printers = await this.repo.listPrintersByBranch(orgId, branchId);
      const response: ApiSuccessResponse = { success: true, data: printers };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getPrinter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const printerId = parseInt(req.params.id, 10);
      if (isNaN(printerId)) {
        throw new BadRequestError('Invalid printer ID', 'INVALID_ID');
      }

      const printer = await this.repo.findPrinterById(printerId, orgId);
      if (!printer) {
        throw new NotFoundError(`Printer #${printerId} not found`, 'PRINTER_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, printer.branchId);

      const response: ApiSuccessResponse = { success: true, data: printer };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createPrinter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.body.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const { name, ipAddress, port, paperWidth, deviceType, isActive } = req.body;
      const printer = await this.repo.createPrinter({
        organizationId: orgId,
        branchId,
        name,
        ipAddress,
        port,
        paperWidth,
        deviceType,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: printer };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updatePrinter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const printerId = parseInt(req.params.id, 10);
      if (isNaN(printerId)) {
        throw new BadRequestError('Invalid printer ID', 'INVALID_ID');
      }

      const existing = await this.repo.findPrinterById(printerId, orgId);
      if (!existing) {
        throw new NotFoundError(`Printer #${printerId} not found`, 'PRINTER_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      const { name, ipAddress, port, paperWidth, deviceType, isActive } = req.body;
      const updated = await this.repo.updatePrinter(printerId, orgId, {
        name,
        ipAddress,
        port,
        paperWidth,
        deviceType,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deletePrinter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const printerId = parseInt(req.params.id, 10);
      if (isNaN(printerId)) {
        throw new BadRequestError('Invalid printer ID', 'INVALID_ID');
      }

      const existing = await this.repo.findPrinterById(printerId, orgId);
      if (!existing) {
        throw new NotFoundError(`Printer #${printerId} not found`, 'PRINTER_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      await this.repo.deletePrinter(printerId, orgId);
      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id: printerId } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // PREPARATION STATIONS
  // ==========================================

  public listStations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.query.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const stations = await this.repo.listStationsByBranch(orgId, branchId);
      const response: ApiSuccessResponse = { success: true, data: stations };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getStation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) {
        throw new BadRequestError('Invalid station ID', 'INVALID_ID');
      }

      const station = await this.repo.findStationById(stationId, orgId);
      if (!station) {
        throw new NotFoundError(`Station #${stationId} not found`, 'STATION_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, station.branchId);

      const response: ApiSuccessResponse = { success: true, data: station };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createStation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.body.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const { name, type, primaryPrinterId, backupPrinterId, isActive } = req.body;
      const station = await this.repo.createStation({
        organizationId: orgId,
        branchId,
        name,
        type,
        primaryPrinterId,
        backupPrinterId,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: station };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateStation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) {
        throw new BadRequestError('Invalid station ID', 'INVALID_ID');
      }

      const existing = await this.repo.findStationById(stationId, orgId);
      if (!existing) {
        throw new NotFoundError(`Station #${stationId} not found`, 'STATION_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      const { name, type, primaryPrinterId, backupPrinterId, isActive } = req.body;
      const updated = await this.repo.updateStation(stationId, orgId, {
        name,
        type,
        primaryPrinterId,
        backupPrinterId,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteStation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) {
        throw new BadRequestError('Invalid station ID', 'INVALID_ID');
      }

      const existing = await this.repo.findStationById(stationId, orgId);
      if (!existing) {
        throw new NotFoundError(`Station #${stationId} not found`, 'STATION_NOT_FOUND');
      }
      await this.ensureBranchAccess(req, existing.branchId);

      await this.repo.deleteStation(stationId, orgId);
      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id: stationId } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // MENU CATEGORIES
  // ==========================================

  public listMenuCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const categories = await this.repo.listMenuCategoriesByOrg(orgId);
      const response: ApiSuccessResponse = { success: true, data: categories };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getMenuCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid menu category ID', 'INVALID_ID');
      }

      const category = await this.repo.findMenuCategoryById(id, orgId);
      if (!category) {
        throw new NotFoundError(`Menu category #${id} not found`, 'MENU_CATEGORY_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: category };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createMenuCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const { name, parentId, stationId, displayOrder, imageUrl, isActive } = req.body;

      const category = await this.repo.createMenuCategory({
        organizationId: orgId,
        name,
        parentId,
        stationId,
        displayOrder,
        imageUrl,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: category };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateMenuCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid menu category ID', 'INVALID_ID');
      }

      const { name, parentId, stationId, displayOrder, imageUrl, isActive } = req.body;
      const updated = await this.repo.updateMenuCategory(id, orgId, {
        name,
        parentId,
        stationId,
        displayOrder,
        imageUrl,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteMenuCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid menu category ID', 'INVALID_ID');
      }

      const deleted = await this.repo.deleteMenuCategory(id, orgId);
      if (!deleted) {
        throw new NotFoundError(`Menu category #${id} not found`, 'MENU_CATEGORY_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // MENU ITEMS
  // ==========================================

  public listMenuItems = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const items = await this.withCustomerPricing(req, await this.repo.listMenuItemsByOrg(orgId));
      const response: ApiSuccessResponse = { success: true, data: items };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getMenuItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid menu item ID', 'INVALID_ID');
      }

      const item = await this.repo.findMenuItemById(id, orgId);
      if (!item) {
        throw new NotFoundError(`Menu item #${id} not found`, 'MENU_ITEM_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: (await this.withCustomerPricing(req, [item]))[0] };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createMenuItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const { categoryId, defaultPrepStationId, name, sku, description, enteredPrice, priceEntryMode, costPrice, imageUrl, isAvailable, isCombo, departmentId, prepTimeMinutes } = req.body;

      const item = await this.repo.createMenuItem({
        organizationId: orgId,
        categoryId,
        defaultPrepStationId,
        name,
        sku,
        description,
        enteredPrice,
        priceEntryMode,
        costPrice,
        imageUrl,
        isAvailable,
        isCombo,
        departmentId,
        prepTimeMinutes,
      });

      const response: ApiSuccessResponse = { success: true, data: (await this.withCustomerPricing(req, [item]))[0] };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateMenuItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid menu item ID', 'INVALID_ID');
      }

      const { categoryId, defaultPrepStationId, name, sku, description, enteredPrice, priceEntryMode, costPrice, imageUrl, isAvailable, isCombo, departmentId, prepTimeMinutes } = req.body;
      const updated = await this.repo.updateMenuItem(id, orgId, {
        categoryId,
        defaultPrepStationId,
        name,
        sku,
        description,
        enteredPrice,
        priceEntryMode,
        costPrice,
        imageUrl,
        isAvailable,
        isCombo,
        departmentId,
        prepTimeMinutes,
      });

      const response: ApiSuccessResponse = { success: true, data: (await this.withCustomerPricing(req, [updated]))[0] };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getMenuComboComponents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new BadRequestError('Invalid menu item ID', 'INVALID_ID');
      const components = await this.repo.getMenuComboComponents(id, orgId);
      const response: ApiSuccessResponse = { success: true, data: components };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public setMenuComboComponents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new BadRequestError('Invalid menu item ID', 'INVALID_ID');
      const components = await this.repo.setMenuComboComponents(id, orgId, req.body.components);
      const response: ApiSuccessResponse = { success: true, data: components };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteMenuItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid menu item ID', 'INVALID_ID');
      }

      const deleted = await this.repo.deleteMenuItem(id, orgId);
      if (!deleted) {
        throw new NotFoundError(`Menu item #${id} not found`, 'MENU_ITEM_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // BRANCH TAX CONFIGURATION
  // ==========================================

  public getBranchTaxConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId, 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      let config = await this.repo.getBranchTaxConfig(orgId, branchId);
      if (!config) {
        // Return branch default configuration
        config = {
          id: 0,
          organizationId: orgId,
          branchId,
          isVatRegistered: false,
          taxRegistrationNumber: null,
          vatRate: 0,
          defaultPriceEntryMode: 'VAT_INCLUDED',
          roundingMethod: 'HALF_EVEN',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const response: ApiSuccessResponse = { success: true, data: config };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public configureBranchTax = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId, 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      const {
        isVatRegistered,
        taxRegistrationNumber,
        vatRate,
        defaultPriceEntryMode,
        roundingMethod,
      } = req.body;

      const config = await this.repo.upsertBranchTaxConfig({
        organizationId: orgId,
        branchId,
        isVatRegistered,
        taxRegistrationNumber,
        vatRate,
        defaultPriceEntryMode,
        roundingMethod,
      });

      const response: ApiSuccessResponse = { success: true, data: config };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // PAYMENT METHODS
  // ==========================================

  public listPaymentMethods = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
      if (branchId !== undefined && !isNaN(branchId)) {
        await this.ensureBranchAccess(req, branchId);
      }

      const methods = await this.repo.listPaymentMethods(orgId, branchId);
      const response: ApiSuccessResponse = { success: true, data: methods };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getPaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid payment method ID', 'INVALID_ID');
      }

      const method = await this.repo.findPaymentMethodById(id, orgId);
      if (!method) {
        throw new NotFoundError(`Payment method #${id} not found`, 'PAYMENT_METHOD_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: method };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createPaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const { branchId, name, code, type, requiresReference, isActive, displayOrder } = req.body;

      if (branchId) {
        await this.ensureBranchAccess(req, branchId);
      }

      const method = await this.repo.createPaymentMethod({
        organizationId: orgId,
        branchId,
        name,
        code,
        type,
        requiresReference,
        isActive,
        displayOrder,
      });

      const response: ApiSuccessResponse = { success: true, data: method };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updatePaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid payment method ID', 'INVALID_ID');
      }

      const { name, code, type, requiresReference, isActive, displayOrder } = req.body;
      const updated = await this.repo.updatePaymentMethod(id, orgId, {
        name,
        code,
        type,
        requiresReference,
        isActive,
        displayOrder,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deletePaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid payment method ID', 'INVALID_ID');
      }

      await this.repo.deletePaymentMethod(id, orgId);
      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // UNITS OF MEASURE
  // ==========================================

  public listUnits = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user?.organizationId;
      const dimension = req.query.dimension as any;
      const units = await this.repo.listUnits(orgId, dimension);
      const response: ApiSuccessResponse = { success: true, data: units };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public getUnit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.user?.organizationId;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid unit ID', 'INVALID_ID');
      }

      const unit = await this.repo.findUnitById(id, orgId);
      if (!unit) {
        throw new NotFoundError(`Unit #${id} not found`, 'UNIT_NOT_FOUND');
      }

      const response: ApiSuccessResponse = { success: true, data: unit };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public createUnit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const { name, symbol, dimension, baseUnitSymbol, conversionFactor, isActive } = req.body;

      const unit = await this.repo.createUnit({
        organizationId: orgId,
        name,
        symbol,
        dimension,
        baseUnitSymbol,
        conversionFactor,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: unit };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateUnit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid unit ID', 'INVALID_ID');
      }

      const { name, symbol, dimension, baseUnitSymbol, conversionFactor, isActive } = req.body;
      const updated = await this.repo.updateUnit(id, orgId, {
        name,
        symbol,
        dimension,
        baseUnitSymbol,
        conversionFactor,
        isActive,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public deleteUnit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        throw new BadRequestError('Invalid unit ID', 'INVALID_ID');
      }

      const deleted = await this.repo.deleteUnit(id, orgId);
      if (!deleted) {
        throw new NotFoundError(`Custom unit #${id} not found or cannot be deleted`, 'UNIT_CANNOT_DELETE');
      }

      const response: ApiSuccessResponse = { success: true, data: { deleted: true, id } };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // OPERATIONAL SETTINGS
  // ==========================================

  public getOperationalSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
      if (branchId) {
        await this.ensureBranchAccess(req, branchId);
      }

      const settings = await this.repo.getOperationalSettings(orgId, branchId);
      const response: ApiSuccessResponse = { success: true, data: settings };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  public updateOperationalSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = req.body.branchId !== undefined && req.body.branchId !== null
        ? parseInt(req.body.branchId, 10)
        : null;

      if (branchId) {
        await this.ensureBranchAccess(req, branchId);
      }

      const {
        openingTime,
        closingTime,
        operatingDays,
        dineInEnabled,
        takeawayEnabled,
        deliveryEnabled,
        receiptHeader,
        receiptFooter,
        currencySymbol,
        autoPrintKot,
        autoPrintBill,
      } = req.body;

      const updated = await this.repo.upsertOperationalSettings(orgId, branchId, {
        openingTime,
        closingTime,
        operatingDays,
        dineInEnabled,
        takeawayEnabled,
        deliveryEnabled,
        receiptHeader,
        receiptFooter,
        currencySymbol,
        autoPrintKot,
        autoPrintBill,
      });

      const response: ApiSuccessResponse = { success: true, data: updated };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // BASELINE SEEDER
  // ==========================================

  public seedBaseline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = parseInt(req.params.branchId || (req.body.branchId as string), 10);
      if (isNaN(branchId)) {
        throw new BadRequestError('Valid branchId is required', 'INVALID_BRANCH_ID');
      }
      await this.ensureBranchAccess(req, branchId);

      await this.repo.seedBranchDefaults(orgId, branchId, req.user!.id);
      const response: ApiSuccessResponse = {
        success: true,
        data: { message: `Baseline master data seeded for branch #${branchId}` },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };
}

export const administrationController = new AdministrationController();

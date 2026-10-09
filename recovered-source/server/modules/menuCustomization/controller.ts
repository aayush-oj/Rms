import { Request, Response, NextFunction } from 'express';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError } from '../../shared/errors';
import { menuCustomizationRepository as repo } from './repository';

function orgId(req: Request): number {
  if (!req.user?.organizationId) throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
  return req.user.organizationId;
}
function id(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new BadRequestError('Invalid identifier', 'INVALID_ID');
  return parsed;
}

export class MenuCustomizationController {
  listGroups = async (req: Request, res: Response, next: NextFunction) => {
    try { res.json({ success: true, data: await repo.listGroups(orgId(req)) } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  getForMenuItem = async (req: Request, res: Response, next: NextFunction) => {
    try { res.json({ success: true, data: await repo.listForMenuItem(id(req.params.itemId), orgId(req)) } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  createVariant = async (req: Request, res: Response, next: NextFunction) => {
    try { const data = await repo.createVariant({ ...req.body, organizationId: orgId(req) }); res.status(201).json({ success: true, data } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  updateVariant = async (req: Request, res: Response, next: NextFunction) => {
    try { const data = await repo.updateVariant(id(req.params.id), orgId(req), req.body); res.json({ success: true, data } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  createGroup = async (req: Request, res: Response, next: NextFunction) => {
    try { const data = await repo.createGroup({ ...req.body, organizationId: orgId(req) }); res.status(201).json({ success: true, data } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  updateGroup = async (req: Request, res: Response, next: NextFunction) => {
    try { const data = await repo.updateGroup(id(req.params.id), orgId(req), req.body); res.json({ success: true, data } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  createOption = async (req: Request, res: Response, next: NextFunction) => {
    try { const data = await repo.createOption({ ...req.body, organizationId: orgId(req) }); res.status(201).json({ success: true, data } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  updateOption = async (req: Request, res: Response, next: NextFunction) => {
    try { const data = await repo.updateOption(id(req.params.id), orgId(req), req.body); res.json({ success: true, data } satisfies ApiSuccessResponse); } catch (e) { next(e); }
  };
  attachGroup = async (req: Request, res: Response, next: NextFunction) => {
    try { await repo.attachGroup(id(req.params.itemId), Number(req.body.modifierGroupId), orgId(req), Number(req.body.displayOrder ?? 0)); res.status(204).send(); } catch (e) { next(e); }
  };
  detachGroup = async (req: Request, res: Response, next: NextFunction) => {
    try { await repo.detachGroup(id(req.params.itemId), id(req.params.groupId), orgId(req)); res.status(204).send(); } catch (e) { next(e); }
  };
}
export const menuCustomizationController = new MenuCustomizationController();

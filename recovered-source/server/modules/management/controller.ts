import { Request, Response, NextFunction } from 'express';
import { ApiSuccessResponse } from '../../shared/types';
import { ForbiddenError } from '../../shared/errors';
import { managementRepository } from './repository';
import { identityRepository } from '../identity/repository';

export class ManagementController {
  private isOrgAdmin(req: Request): boolean {
    return req.user!.role === 'OWNER' || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:branches:manage');
  }

  private async ensureUserScope(req: Request, targetUserId: number): Promise<void> {
    if (targetUserId === req.user!.id || this.isOrgAdmin(req)) return;
    const target = await identityRepository.findUserById(req.user!.organizationId, targetUserId);
    if (!target) throw new ForbiddenError('Staff member is outside your management scope', 'STAFF_SCOPE_FORBIDDEN');
    const allowed = await identityRepository.getUserAllowedBranchIds(targetUserId, req.user!.organizationId);
    if (!allowed.some(branchId => req.user!.allowedBranchIds.includes(branchId))) {
      throw new ForbiddenError('Staff member is outside your authorized branches', 'STAFF_SCOPE_FORBIDDEN');
    }
  }
  listDepartments = async (req: Request, res: Response, next: NextFunction) => { try { const branchId = req.query.branchId ? Number(req.query.branchId) : req.user!.activeBranchId; const privileged = req.user!.role === 'OWNER' || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:branches:manage'); if (!privileged && !req.user!.allowedBranchIds.includes(branchId)) throw new ForbiddenError('Unauthorized branch access', 'UNAUTHORIZED_BRANCH_ACCESS'); res.json({ success: true, data: await managementRepository.listDepartments(req.user!.organizationId, branchId) } as ApiSuccessResponse); } catch (e) { next(e); } };
  createDepartment = async (req: Request, res: Response, next: NextFunction) => { try { const branchId = req.body.branchId == null ? null : Number(req.body.branchId); if (branchId != null && !this.isOrgAdmin(req) && !req.user!.allowedBranchIds.includes(branchId)) throw new ForbiddenError('Unauthorized branch access', 'UNAUTHORIZED_BRANCH_ACCESS'); res.status(201).json({ success: true, data: await managementRepository.createDepartment(req.user!.organizationId, req.body) }); } catch (e) { next(e); } };
  updateDepartment = async (req: Request, res: Response, next: NextFunction) => { try { if (req.body.branchId != null && !this.isOrgAdmin(req) && !req.user!.allowedBranchIds.includes(Number(req.body.branchId))) throw new ForbiddenError('Unauthorized branch access', 'UNAUTHORIZED_BRANCH_ACCESS'); res.json({ success: true, data: await managementRepository.updateDepartment(req.user!.organizationId, Number(req.params.id), req.body) }); } catch (e) { next(e); } };
  setMenuItemDepartment = async (req: Request, res: Response, next: NextFunction) => { try { await managementRepository.setMenuItemDepartment(req.user!.organizationId, Number(req.params.id), req.body.departmentId ?? null, req.body.prepTimeMinutes); res.json({ success: true, data: { updated: true } }); } catch (e) { next(e); } };

  listCustomers = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.listCustomers(req.user!.organizationId, req.query.search as string | undefined) }); } catch (e) { next(e); } };
  createCustomer = async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ success: true, data: await managementRepository.createCustomer(req.user!.organizationId, req.body) }); } catch (e) { next(e); } };
  updateCustomer = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.updateCustomer(req.user!.organizationId, Number(req.params.id), req.body) }); } catch (e) { next(e); } };
  customerOrders = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.customerOrders(req.user!.organizationId, Number(req.params.id)) }); } catch (e) { next(e); } };
  customerMemberships = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.customerMemberships(req.user!.organizationId, Number(req.params.id)) }); } catch (e) { next(e); } };

  listMemberships = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.listMemberships(req.user!.organizationId, req.query.customerId ? Number(req.query.customerId) : undefined) }); } catch (e) { next(e); } };
  createMembership = async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ success: true, data: await managementRepository.createMembership(req.user!.organizationId, req.body) }); } catch (e) { next(e); } };
  updateMembership = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.updateMembership(req.user!.organizationId, Number(req.params.id), req.body) }); } catch (e) { next(e); } };
  listMembershipUsage = async (req: Request, res: Response, next: NextFunction) => { try { res.json({ success: true, data: await managementRepository.listMembershipUsage(req.user!.organizationId, Number(req.params.id)) }); } catch (e) { next(e); } };
  recordMembershipUsage = async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ success: true, data: await managementRepository.recordMembershipUsage(req.user!.organizationId, Number(req.params.id), { ...req.body, createdBy: req.user!.id }) }); } catch (e) { next(e); } };

  getAccess = async (req: Request, res: Response, next: NextFunction) => { try { await this.ensureUserScope(req, Number(req.params.userId)); const privileged = this.isOrgAdmin(req); const visibleBranches = privileged || Number(req.params.userId) === req.user!.id ? undefined : req.user!.allowedBranchIds; res.json({ success: true, data: await managementRepository.listAccess(req.user!.organizationId, Number(req.params.userId), undefined, visibleBranches) }); } catch (e) { next(e); } };
  setAccess = async (req: Request, res: Response, next: NextFunction) => { try { await this.ensureUserScope(req, Number(req.params.userId)); const actorIsPrivileged = req.user!.role === 'OWNER' || req.user!.permissions.includes('admin:all') || req.user!.permissions.includes('admin:branches:manage'); await managementRepository.setAccess(req.user!.organizationId, Number(req.params.userId), req.body.branchIds, req.body.sectionIds, req.body.tableIds, req.user!.id, req.user!.allowedBranchIds, actorIsPrivileged); const privileged = this.isOrgAdmin(req); const visibleBranches = privileged || Number(req.params.userId) === req.user!.id ? undefined : req.user!.allowedBranchIds; res.json({ success: true, data: await managementRepository.listAccess(req.user!.organizationId, Number(req.params.userId), undefined, visibleBranches) }); } catch (e) { next(e); } };
  assignTableWaiter = async (req: Request, res: Response, next: NextFunction) => { try { await managementRepository.assignTableWaiter(req.user!.organizationId, req.user!.activeBranchId, Number(req.params.tableId), req.body.waiterId ?? null); res.json({ success: true, data: { assigned: true } }); } catch (e) { next(e); } };
  createRole = async (req: Request, res: Response, next: NextFunction) => { try { const roleId = await managementRepository.createRole(req.user!.organizationId, req.body.name, req.body.description ?? null, req.body.permissionIds, req.user!.permissions); res.status(201).json({ success: true, data: { id: roleId } }); } catch (e) { next(e); } };
  setRolePermissions = async (req: Request, res: Response, next: NextFunction) => { try { await managementRepository.setRolePermissions(req.user!.organizationId, Number(req.params.roleId), req.body.permissionIds, req.user!.permissions); const roles = await identityRepository.getRoles(req.user!.organizationId); res.json({ success: true, data: roles.find(r => r.id === Number(req.params.roleId)) || null }); } catch (e) { next(e); } };
}
export const managementController = new ManagementController();

import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { activityLogRepository } from './repository';

export const activityLogRouter = Router();
activityLogRouter.use(authenticate());
activityLogRouter.get('/', requirePermission('admin:system:status'), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const q = req.query as Record<string, string | undefined>;
    const data = await activityLogRepository.list(orgId, {
      branchId: q.branchId ? Number(q.branchId) : undefined,
      actorUserId: q.actorUserId ? Number(q.actorUserId) : undefined,
      method: q.method || undefined,
      search: q.search?.trim() || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
    });
    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
});

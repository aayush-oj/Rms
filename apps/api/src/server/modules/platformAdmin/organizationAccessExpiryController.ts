import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationEntitlementAdjustmentService,
  platformOrganizationEntitlementAdjustmentService,
} from './organizationEntitlementAdjustmentService';

interface AccessExpiryBody {
  expectedVersion: number;
  accessEndsAt: Date | null;
  reason: string;
  customerMessage?: string | null;
}

export class PlatformOrganizationAccessExpiryController {
  constructor(
    private readonly service: PlatformOrganizationEntitlementAdjustmentService =
      platformOrganizationEntitlementAdjustmentService,
  ) {}

  public update = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as AccessExpiryBody;

      const entitlement = await this.service.changeActiveAccessExpiry({
        organizationId,
        expectedVersion: body.expectedVersion,
        accessEndsAt: body.accessEndsAt,
        reason: body.reason,
        customerMessage: body.customerMessage,
        platformAdminId: req.platformAdmin!.admin.id,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
        requestId: req.id,
      });

      const response: ApiSuccessResponse = {
        success: true,
        data: {
          organizationId,
          entitlement,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const platformOrganizationAccessExpiryController =
  new PlatformOrganizationAccessExpiryController();

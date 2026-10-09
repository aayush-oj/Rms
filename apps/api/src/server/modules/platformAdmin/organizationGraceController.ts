import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationEntitlementAdjustmentService,
  platformOrganizationEntitlementAdjustmentService,
} from './organizationEntitlementAdjustmentService';

interface ExtendGraceBody {
  expectedVersion: number;
  graceEndsAt: Date;
  reason: string;
  customerMessage?: string | null;
}

export class PlatformOrganizationGraceController {
  constructor(
    private readonly service: PlatformOrganizationEntitlementAdjustmentService =
      platformOrganizationEntitlementAdjustmentService,
  ) {}

  public extend = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ExtendGraceBody;

      const entitlement = await this.service.extendGrace({
        organizationId,
        expectedVersion: body.expectedVersion,
        graceEndsAt: body.graceEndsAt,
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

export const platformOrganizationGraceController =
  new PlatformOrganizationGraceController();

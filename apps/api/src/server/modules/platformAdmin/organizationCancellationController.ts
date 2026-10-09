import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationCancellationService,
  platformOrganizationCancellationService,
} from './organizationCancellationService';

interface CancelOrganizationBody {
  expectedVersion: number;
  confirmationText: string;
  reason: string;
  customerMessage?: string | null;
}

export class PlatformOrganizationCancellationController {
  constructor(
    private readonly service:
      PlatformOrganizationCancellationService =
      platformOrganizationCancellationService,
  ) {}

  public cancel = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as CancelOrganizationBody;

      const entitlement = await this.service.cancel({
        organizationId,
        expectedVersion: body.expectedVersion,
        confirmationText: body.confirmationText,
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

export const platformOrganizationCancellationController =
  new PlatformOrganizationCancellationController();

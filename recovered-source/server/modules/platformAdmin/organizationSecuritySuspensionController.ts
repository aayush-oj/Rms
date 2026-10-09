import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationSecuritySuspensionService,
  platformOrganizationSecuritySuspensionService,
} from './organizationSecuritySuspensionService';

interface SecuritySuspendBody {
  expectedVersion: number;
  confirmationHandle: string;
  reason: string;
  customerMessage?: string | null;
}

type ClearSecuritySuspensionBody =
  | (SecuritySuspendBody & {
      restoreTo: 'ACTIVE';
      accessEndsAt: Date | null;
    })
  | (SecuritySuspendBody & {
      restoreTo: 'SUSPENDED';
    });

export class PlatformOrganizationSecuritySuspensionController {
  constructor(
    private readonly service:
      PlatformOrganizationSecuritySuspensionService =
      platformOrganizationSecuritySuspensionService,
  ) {}

  private response(
    organizationId: number,
    entitlement: Awaited<
      ReturnType<PlatformOrganizationSecuritySuspensionService['securitySuspend']>
    >,
  ): ApiSuccessResponse {
    return {
      success: true,
      data: {
        organizationId,
        entitlement,
      },
    };
  }

  private requestMetadata(req: Request) {
    return {
      platformAdminId: req.platformAdmin!.admin.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      requestId: req.id,
    };
  }

  public securitySuspend = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as SecuritySuspendBody;

      const entitlement = await this.service.securitySuspend({
        organizationId,
        expectedVersion: body.expectedVersion,
        confirmationHandle: body.confirmationHandle,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.requestMetadata(req),
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };

  public clearSecuritySuspension = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ClearSecuritySuspensionBody;

      const entitlement = await this.service.clearSecuritySuspension({
        organizationId,
        expectedVersion: body.expectedVersion,
        confirmationHandle: body.confirmationHandle,
        restoreTo: body.restoreTo,
        accessEndsAt:
          body.restoreTo === 'ACTIVE'
            ? body.accessEndsAt
            : undefined,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.requestMetadata(req),
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };
}

export const platformOrganizationSecuritySuspensionController =
  new PlatformOrganizationSecuritySuspensionController();
